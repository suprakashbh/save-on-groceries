#!/usr/bin/env python3
"""Call AWS Textract DetectDocumentText using values from config.json."""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote
from typing import Any, Iterable, Sequence

import boto3

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp", ".gif", ".webp"}
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = PROJECT_ROOT / "config.json"


def load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    with config_path.open("r", encoding="utf-8") as file:
        config = json.load(file)
    if not any(key in config for key in ("source_prefix", "source_prefixes", "image_source", "image_sources")):
        raise ValueError("Missing required 'source_prefix', 'source_prefixes', 'image_source', or 'image_sources' in config.json")
    return config


@dataclass(frozen=True)
class ImageTask:
    bucket: str
    object_key: str


def normalize_source_prefixes(config: dict[str, Any]) -> list[str]:
    if "source_prefixes" in config and config["source_prefixes"]:
        sources = config["source_prefixes"]
    elif "image_sources" in config and config["image_sources"]:
        sources = config["image_sources"]
    else:
        sources = config.get("source_prefix") or config.get("image_source")
    if isinstance(sources, str):
        return [sources]
    if isinstance(sources, Sequence):
        return [str(item) for item in sources]
    raise ValueError("source_prefix(es) must be a string or a list of strings")


def normalize_prefix(prefix: str) -> str:
    return prefix.strip().strip("/")


def list_images(s3_client, bucket: str, prefixes: Iterable[str], recursive: bool) -> list[ImageTask]:
    normalized_prefixes = [normalize_prefix(prefix) for prefix in prefixes if normalize_prefix(prefix)]
    if not normalized_prefixes:
        raise ValueError("No source prefixes provided")
    tasks: list[ImageTask] = []
    for prefix in normalized_prefixes:
        continuation_token: str | None = None
        prefix_tasks: list[ImageTask] = []
        while True:
            request: dict[str, Any] = {"Bucket": bucket, "Prefix": f"{prefix}/"}
            if continuation_token:
                request["ContinuationToken"] = continuation_token
            response = s3_client.list_objects_v2(**request)
            for item in response.get("Contents", []):
                key = item["Key"]
                if key.endswith("/"):
                    continue
                relative = key[len(prefix) + 1 :] if key.startswith(f"{prefix}/") else key
                if not recursive and "/" in relative:
                    continue
                if not any(key.lower().endswith(ext) for ext in SUPPORTED_EXTENSIONS):
                    continue
                prefix_tasks.append(ImageTask(bucket=bucket, object_key=key))
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        if not prefix_tasks:
            raise ValueError(f"No supported images found in s3://{bucket}/{prefix}/")
        tasks.extend(sorted(prefix_tasks, key=lambda task: task.object_key))

    if not tasks:
        raise ValueError("No supported images found in provided source prefixes")
    return tasks


def build_textract_client(region: str, profile: str | None):
    if profile:
        session = boto3.Session(profile_name=profile, region_name=region)
    else:
        session = boto3.Session(region_name=region)
    return session.client("textract")


def build_s3_client(region: str, profile: str | None):
    if profile:
        session = boto3.Session(profile_name=profile, region_name=region)
    else:
        session = boto3.Session(region_name=region)
    return session.client("s3")


def detect_document_text(textract_client, s3_client, task: ImageTask) -> dict[str, Any]:
    image_bytes = s3_client.get_object(Bucket=task.bucket, Key=task.object_key)["Body"].read()
    return textract_client.detect_document_text(Document={"Bytes": image_bytes})


def serialize_payload(payload: dict[str, Any], pretty_print: bool) -> str:
    return json.dumps(payload, indent=2 if pretty_print else None, default=str)


def s3_key_for_image(task: ImageTask, output_prefix: str) -> str:
    output_relative = f"{task.object_key.rsplit('.', 1)[0]}.json"
    cleaned_prefix = output_prefix.strip("/")
    return f"{cleaned_prefix}/{output_relative}" if cleaned_prefix else output_relative


def upload_output(s3_client, bucket: str, key: str, payload: dict[str, Any], pretty_print: bool) -> None:
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=serialize_payload(payload, pretty_print).encode("utf-8"),
        ContentType="application/json",
    )


def build_s3_object_url(bucket: str, region: str, key: str) -> str:
    encoded_key = quote(key, safe="/-_.~")
    if region == "us-east-1":
        return f"https://{bucket}.s3.amazonaws.com/{encoded_key}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{encoded_key}"


def provider_for_task(task: ImageTask) -> str:
    return task.object_key.split("/", 1)[0]


def build_source_url(task: ImageTask, source_bucket: str, source_url_base: str | None, region: str) -> str:
    if source_url_base:
        provider = provider_for_task(task).lower()
        filename = quote(task.object_key.rsplit("/", 1)[-1], safe="-_.~")
        return f"{source_url_base.rstrip('/')}/{provider}/{filename}"
    return build_s3_object_url(source_bucket, region, task.object_key)


def process_image(
    textract_client,
    s3_client,
    task: ImageTask,
    output_bucket: str,
    output_prefix: str,
    pretty_print: bool,
    source_bucket: str,
    source_url_base: str | None,
    region: str,
) -> tuple[str, str | None]:
    try:
        response = detect_document_text(textract_client, s3_client, task)
        provider = provider_for_task(task)
        response["provider"] = provider
        response["source"] = build_source_url(task, source_bucket, source_url_base, region)
        output_key = s3_key_for_image(task, output_prefix)
        upload_output(s3_client, output_bucket, output_key, response, pretty_print)
        return output_key, None
    except Exception as exc:  # pragma: no cover - runtime AWS errors are environment-dependent
        return task.object_key, str(exc)


def default_worker_count() -> int:
    cpu_count = os.cpu_count() or 4
    return min(16, max(2, cpu_count * 2))


def main() -> int:
    try:
        config = load_config(CONFIG_PATH)
        region = config.get("aws_region", "us-east-1")
        profile = config.get("aws_profile")
        pretty_print = bool(config.get("pretty_print", True))
        output_bucket = config.get("output_bucket", "supra-textract-output")
        output_prefix = config.get("output_prefix", "temporary")
        source_bucket = config.get("source_bucket", "supra-weekly-deals")
        source_url_base = config.get("source_url_base")
        recursive = bool(config.get("recursive", True))
        max_workers = int(config.get("max_workers", default_worker_count()))
        s3_client = build_s3_client(region=region, profile=profile)
        source_prefixes = normalize_source_prefixes(config)
        tasks = list_images(s3_client, source_bucket, source_prefixes, recursive=recursive)
        client = build_textract_client(region=region, profile=profile)

        failures: list[tuple[str, str]] = []
        processed = 0
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(
                    process_image,
                    client,
                    s3_client,
                    task,
                    output_bucket,
                    output_prefix,
                    pretty_print,
                    source_bucket,
                    source_url_base,
                    region,
                ): task
                for task in tasks
            }
            for future in as_completed(futures):
                processed += 1
                output_key, error = future.result()
                if error:
                    failures.append((output_key, error))
        print(
            json.dumps(
                {
                    "processed": processed,
                    "failed": len(failures),
                    "output_bucket": output_bucket,
                    "output_prefix": output_prefix,
                },
                indent=2,
            )
        )
        if failures:
            for path, error in failures:
                print(json.dumps({"image": str(path), "error": error}, indent=2))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
