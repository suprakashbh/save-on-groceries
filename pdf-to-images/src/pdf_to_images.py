#!/usr/bin/env python3
"""Convert PDFs from S3 into page images and upload them back to S3."""

from __future__ import annotations

import argparse
import sys
import tempfile
from io import BytesIO
from pathlib import Path
from typing import Iterable

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Convert PDFs from an S3 bucket into one image per page."
    )
    parser.add_argument(
        "--source-bucket",
        default="weekly-catalogue-deals-pdf",
        help="S3 bucket containing input PDFs (default: weekly-catalogue-deals-pdf).",
    )
    parser.add_argument(
        "--source-prefix",
        default="",
        help="Optional prefix inside the source bucket to scan for PDFs.",
    )
    parser.add_argument(
        "--destination-bucket",
        default="supra-weekly-deals",
        help="S3 bucket to upload generated images to (default: supra-weekly-deals).",
    )
    parser.add_argument(
        "--aws-region",
        default=None,
        help="Optional AWS region for the S3 client.",
    )
    parser.add_argument(
        "-f",
        "--format",
        default="png",
        choices=("png", "jpeg", "jpg", "tiff", "bmp", "ppm"),
        help="Image format for output pages (default: png).",
    )
    parser.add_argument(
        "--dpi",
        type=int,
        default=200,
        help="Render DPI for conversion (default: 200).",
    )
    parser.add_argument(
        "--first-page",
        type=int,
        default=None,
        help="First page number to convert (1-based).",
    )
    parser.add_argument(
        "--last-page",
        type=int,
        default=None,
        help="Last page number to convert (1-based).",
    )
    parser.add_argument(
        "--pdf-key",
        action="append",
        default=[],
        help="Specific PDF object key to process. Repeat to process multiple keys.",
    )
    return parser.parse_args()


def normalize_format(fmt: str) -> str:
    return "jpeg" if fmt.lower() == "jpg" else fmt.lower()


def convert_pdf_to_images(
    pdf_path: Path,
    image_format: str,
    dpi: int,
    first_page: int | None,
    last_page: int | None,
) -> list[tuple[str, bytes]]:
    from pdf2image import convert_from_path

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError(f"Input file must be a PDF: {pdf_path}")
    if first_page is not None and first_page < 1:
        raise ValueError("--first-page must be >= 1")
    if last_page is not None and last_page < 1:
        raise ValueError("--last-page must be >= 1")
    if first_page and last_page and first_page > last_page:
        raise ValueError("--first-page cannot be greater than --last-page")

    fmt = normalize_format(image_format)
    stem = pdf_path.stem

    images = convert_from_path(
        pdf_path=str(pdf_path),
        dpi=dpi,
        first_page=first_page,
        last_page=last_page,
    )

    output_images: list[tuple[str, bytes]] = []
    start_page = first_page if first_page is not None else 1
    for index, image in enumerate(images, start=start_page):
        file_name = f"{stem}_page_{index}.{fmt}"
        buffer = BytesIO()
        image.save(buffer, fmt.upper())
        output_images.append((file_name, buffer.getvalue()))

    return output_images


def list_pdf_keys(
    s3_client,
    source_bucket: str,
    source_prefix: str,
) -> list[str]:
    paginator = s3_client.get_paginator("list_objects_v2")
    page_iterator = paginator.paginate(Bucket=source_bucket, Prefix=source_prefix)

    pdf_keys: list[str] = []
    for page in page_iterator:
        for item in page.get("Contents", []):
            key = item["Key"]
            if key.lower().endswith(".pdf") and not key.endswith("/"):
                pdf_keys.append(key)

    return sorted(pdf_keys)


def destination_prefix_for_pdf(pdf_key: str) -> str:
    file_name = Path(pdf_key).name.lower()
    prefix_map = {
        "coles.pdf": "coles",
        "woolworths.pdf": "woolworths",
    }
    return prefix_map.get(file_name, "")


def upload_images(
    s3_client,
    destination_bucket: str,
    destination_prefix: str,
    images: Iterable[tuple[str, bytes]],
) -> list[str]:
    uploaded_keys: list[str] = []
    for file_name, payload in images:
        object_key = f"{destination_prefix}/{file_name}" if destination_prefix else file_name
        s3_client.put_object(
            Bucket=destination_bucket,
            Key=object_key,
            Body=payload,
            ContentType=f"image/{normalize_format(Path(file_name).suffix.lstrip('.'))}",
        )
        uploaded_keys.append(object_key)
    return uploaded_keys


def process_pdf_from_s3(
    s3_client,
    source_bucket: str,
    pdf_key: str,
    destination_bucket: str,
    image_format: str,
    dpi: int,
    first_page: int | None,
    last_page: int | None,
) -> list[str]:
    with tempfile.NamedTemporaryFile(suffix=".pdf") as temp_pdf:
        s3_client.download_file(source_bucket, pdf_key, temp_pdf.name)
        images = convert_pdf_to_images(
            pdf_path=Path(temp_pdf.name),
            image_format=image_format,
            dpi=dpi,
            first_page=first_page,
            last_page=last_page,
        )

    destination_prefix = destination_prefix_for_pdf(pdf_key)
    return upload_images(
        s3_client=s3_client,
        destination_bucket=destination_bucket,
        destination_prefix=destination_prefix,
        images=images,
    )


def main() -> int:
    args = parse_args()

    if args.first_page is not None and args.first_page < 1:
        print("Error: --first-page must be >= 1", file=sys.stderr)
        return 1
    if args.last_page is not None and args.last_page < 1:
        print("Error: --last-page must be >= 1", file=sys.stderr)
        return 1
    if args.first_page and args.last_page and args.first_page > args.last_page:
        print("Error: --first-page cannot be greater than --last-page", file=sys.stderr)
        return 1

    try:
        import boto3
        from botocore.exceptions import BotoCoreError, ClientError

        session = boto3.session.Session(region_name=args.aws_region)
        s3_client = session.client("s3")

        pdf_keys = sorted(set(args.pdf_key)) if args.pdf_key else list_pdf_keys(
            s3_client=s3_client,
            source_bucket=args.source_bucket,
            source_prefix=args.source_prefix,
        )
        if not pdf_keys:
            print(
                f"No PDF files found in s3://{args.source_bucket}/{args.source_prefix}",
                file=sys.stderr,
            )
            return 1

        uploaded_keys: list[str] = []
        for pdf_key in pdf_keys:
            uploaded_keys.extend(
                process_pdf_from_s3(
                    s3_client=s3_client,
                    source_bucket=args.source_bucket,
                    pdf_key=pdf_key,
                    destination_bucket=args.destination_bucket,
                    image_format=args.format,
                    dpi=args.dpi,
                    first_page=args.first_page,
                    last_page=args.last_page,
                )
            )
    except ImportError as exc:
        print(
            f"Error: {exc}. Install dependencies with 'pip install -r requirements.txt'.",
            file=sys.stderr,
        )
        return 1
    except (ClientError, BotoCoreError, FileNotFoundError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(f"Uploaded {len(uploaded_keys)} image(s) to s3://{args.destination_bucket}:")
    for key in uploaded_keys:
        print(f"s3://{args.destination_bucket}/{key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
