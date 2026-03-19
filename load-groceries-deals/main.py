#!/usr/bin/env python3
import argparse
import json
import logging
import os
from dataclasses import dataclass
from typing import Iterable, List, Dict, Any, Optional

from opensearchpy import OpenSearch, RequestsHttpConnection, helpers
from opensearchpy import AWSV4SignerAuth
import boto3
from botocore.client import BaseClient


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("load-groceries-deals")


@dataclass
class Settings:
    s3_bucket: str
    s3_prefixes: List[str]
    index: str
    batch_size: int
    create_index: bool
    dry_run: bool


REQUIRED_FIELDS = {"anchor_price", "texts", "provider", "source", "week"}


def parse_args() -> Settings:
    parser = argparse.ArgumentParser(description="Load grocery deals into OpenSearch")
    parser.add_argument(
        "--s3-bucket",
        default="supra-weekly-products-load",
        help="S3 bucket containing input JSON files",
    )
    parser.add_argument(
        "--s3-prefix",
        dest="s3_prefixes",
        action="append",
        help="S3 prefix to scan for input files. Repeat to include multiple prefixes.",
    )
    parser.add_argument("--index", default="weekly-grocery-deals", help="OpenSearch index name")
    parser.add_argument("--batch-size", type=int, default=500, help="Bulk index batch size")
    parser.add_argument("--create-index", action="store_true", help="Create index if missing")
    parser.add_argument("--dry-run", action="store_true", help="Read and validate without indexing")
    args = parser.parse_args()

    return Settings(
        s3_bucket=args.s3_bucket,
        s3_prefixes=args.s3_prefixes or ["coles", "woolworths"],
        index=args.index,
        batch_size=args.batch_size,
        create_index=args.create_index,
        dry_run=args.dry_run,
    )


def get_bool_env(name: str, default: bool = True) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y"}


def build_client() -> OpenSearch:
    url = os.getenv("OPENSEARCH_URL","https://613pnf5nof27de5vwftl.us-east-1.aoss.amazonaws.com")
    host = os.getenv("OPENSEARCH_HOST")
    port = int(os.getenv("OPENSEARCH_PORT", "443"))
    verify_certs = get_bool_env("OPENSEARCH_VERIFY_CERTS", True)

    if url:
        if url.startswith("https://"):
            host = url.replace("https://", "", 1)
        elif url.startswith("http://"):
            host = url.replace("http://", "", 1)
        if "/" in host:
            host = host.split("/", 1)[0]

    if not host:
        raise SystemExit("OPENSEARCH_URL or OPENSEARCH_HOST is required")

    user = os.getenv("OPENSEARCH_USER")
    password = os.getenv("OPENSEARCH_PASSWORD")
    region = os.getenv("OPENSEARCH_REGION","us-east-1")
    service = os.getenv("OPENSEARCH_SERVICE", "es")

    if user and password:
        auth = (user, password)
    else:
        if not region:
            raise SystemExit("OPENSEARCH_REGION is required for SigV4 auth")
        session = boto3.Session()
        credentials = session.get_credentials()
        if credentials is None:
            raise SystemExit("No AWS credentials found for SigV4 auth")
        auth = AWSV4SignerAuth(credentials, region, service)

    client = OpenSearch(
        hosts=[{"host": host, "port": port}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=verify_certs,
        connection_class=RequestsHttpConnection,
    )

    return client


def build_s3_client() -> BaseClient:
    return boto3.client("s3")


def normalize_prefix(prefix: str) -> str:
    return prefix.strip().strip("/")


def iter_s3_keys(s3_client: BaseClient, bucket: str, prefix: str) -> Iterable[str]:
    paginator = s3_client.get_paginator("list_objects_v2")
    prefix_with_slash = f"{normalize_prefix(prefix)}/"
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix_with_slash):
        for item in page.get("Contents", []):
            key = item["Key"]
            if key.endswith(".json"):
                yield key


def load_candidates(
    s3_client: BaseClient,
    bucket: str,
    key: str,
) -> List[Dict[str, Any]]:
    response = s3_client.get_object(Bucket=bucket, Key=key)
    body = response["Body"].read().decode("utf-8")
    data = json.loads(body)

    if isinstance(data, dict) and "product_candidates" in data:
        candidates = data["product_candidates"]
    elif isinstance(data, list):
        candidates = data
    else:
        raise ValueError(f"Unsupported JSON structure in s3://{bucket}/{key}")

    if not isinstance(candidates, list):
        raise ValueError(f"product_candidates must be a list in s3://{bucket}/{key}")

    return candidates


def validate_candidate(c: Dict[str, Any], source_name: str) -> None:
    missing = REQUIRED_FIELDS - c.keys()
    if missing:
        raise ValueError(f"Missing fields {sorted(missing)} in {source_name}")


def ensure_index(client: OpenSearch, index: str) -> None:
    if client.indices.exists(index=index):
        return
    body = {
        "settings": {
            "number_of_shards": 1,
            "number_of_replicas": 1,
        },
        "mappings": {
            "properties": {
                "anchor_price": {"type": "float"},
                "texts": {"type": "keyword"},
                "provider": {"type": "keyword"},
                "source": {"type": "keyword"},
                "week": {"type": "keyword"},
            }
        },
    }
    client.indices.create(index=index, body=body)
    logger.info("Created index %s", index)


def build_actions(index: str, candidates: List[Dict[str, Any]]) -> Iterable[Dict[str, Any]]:
    for c in candidates:
        yield {"_op_type": "index", "_index": index, "_source": c}


def delete_s3_object(s3_client: BaseClient, bucket: str, key: str) -> None:
    s3_client.delete_object(Bucket=bucket, Key=key)


def main() -> None:
    settings = parse_args()
    s3_client = build_s3_client()

    s3_keys: List[str] = []
    for prefix in settings.s3_prefixes:
        s3_keys.extend(iter_s3_keys(s3_client, settings.s3_bucket, prefix))

    s3_keys = sorted(set(s3_keys))
    if not s3_keys:
        raise SystemExit(
            f"No .json files found in s3://{settings.s3_bucket} under prefixes {settings.s3_prefixes}"
        )

    logger.info("Found %d input file(s) in s3://%s", len(s3_keys), settings.s3_bucket)

    total_candidates = 0

    if settings.dry_run:
        client: Optional[OpenSearch] = None
    else:
        client = build_client()
        if settings.create_index:
            ensure_index(client, settings.index)

    for key in s3_keys:
        source_name = f"s3://{settings.s3_bucket}/{key}"
        candidates = load_candidates(s3_client, settings.s3_bucket, key)
        for c in candidates:
            validate_candidate(c, source_name)
        total_candidates += len(candidates)

        if settings.dry_run:
            logger.info("Validated %s (%d candidates)", source_name, len(candidates))
            continue

        actions = build_actions(settings.index, candidates)
        success, _ = helpers.bulk(client, actions, chunk_size=settings.batch_size)
        logger.info("Indexed %s (%d candidates)", source_name, success)

        delete_s3_object(s3_client, settings.s3_bucket, key)
        logger.info("Deleted %s after successful indexing", source_name)

    logger.info("Done. Total candidates processed: %d", total_candidates)


if __name__ == "__main__":
    main()
