import json
from datetime import date

import boto3

from src.load_textract import load_textract_content
from src.clean_lines import extract_lines
from src.column_layout import group_by_columns
from src.product_candidates import find_price_anchors, build_candidate, dedupe_candidates
from src.build_nova_input import build_nova_input

SOURCE_BUCKET = "supra-textract-output"
SOURCE_PREFIXES = {
    "coles": "temporary/coles/",
    "woolworths": "temporary/woolworths/",
}
DESTINATION_BUCKET = "supra-weekly-products-load"


def iter_source_objects(s3_client, bucket: str, prefix: str):
    paginator = s3_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for item in page.get("Contents", []):
            key = item["Key"]
            if not key.endswith(".json"):
                continue
            yield key


def build_destination_key(retailer: str, source_key: str) -> str:
    source_prefix = SOURCE_PREFIXES[retailer]
    relative_key = source_key[len(source_prefix):]
    stem, _, _ = relative_key.rpartition(".")
    if not stem:
        stem = relative_key
    return f"{retailer}/{stem}_nova_input.json"


def delete_objects(s3_client, bucket: str, keys: list[str]) -> None:
    for start in range(0, len(keys), 1000):
        chunk = keys[start:start + 1000]
        s3_client.delete_objects(
            Bucket=bucket,
            Delete={"Objects": [{"Key": key} for key in chunk]},
        )


def main() -> None:
    s3_client = boto3.client("s3")
    iso_year, iso_week, _ = date.today().isocalendar()
    week = f"{iso_year}-W{iso_week:02d}"

    total_files = 0
    total_candidates = 0
    processed_source_keys: list[str] = []

    for retailer, source_prefix in SOURCE_PREFIXES.items():
        for source_key in iter_source_objects(s3_client, SOURCE_BUCKET, source_prefix):
            response = s3_client.get_object(Bucket=SOURCE_BUCKET, Key=source_key)
            textract = load_textract_content(response["Body"].read().decode("utf-8"))

            provider = textract.get("provider")
            source = textract.get("source")

            lines = extract_lines(textract)
            columns = group_by_columns(lines)

            candidates = []
            for col in columns:
                anchors = find_price_anchors(col)
                for anchor in anchors:
                    candidate = build_candidate(anchor, col)
                    if candidate:
                        candidates.append(candidate)

            candidates = dedupe_candidates(candidates)
            total_candidates += len(candidates)

            for candidate in candidates:
                candidate["provider"] = provider
                candidate["source"] = source
                candidate["week"] = week

            nova_input = build_nova_input(candidates, page_number=25)
            destination_key = build_destination_key(retailer, source_key)
            s3_client.put_object(
                Bucket=DESTINATION_BUCKET,
                Key=destination_key,
                Body=json.dumps(nova_input, indent=2).encode("utf-8"),
                ContentType="application/json",
            )

            processed_source_keys.append(source_key)
            total_files += 1
            print(
                f"s3://{SOURCE_BUCKET}/{source_key} -> "
                f"s3://{DESTINATION_BUCKET}/{destination_key} "
                f"({len(candidates)} candidates)"
            )

    if not processed_source_keys:
        raise SystemExit(
            "No input files found under "
            f"s3://{SOURCE_BUCKET}/temporary/coles/ or "
            f"s3://{SOURCE_BUCKET}/temporary/woolworths/"
        )

    delete_objects(s3_client, SOURCE_BUCKET, processed_source_keys)
    print(f"Processed {total_files} file(s), total candidates: {total_candidates}")
    print(
        "Deleted processed source files from "
        f"s3://{SOURCE_BUCKET}/temporary/coles/ and "
        f"s3://{SOURCE_BUCKET}/temporary/woolworths/"
    )


if __name__ == "__main__":
    main()
