# AWS Textract Raw OCR (Config-Driven)

This project reads images from S3, calls AWS Textract `DetectDocumentText`, and uploads one raw API response JSON file per image to S3.

No CLI arguments are used. The script reads all values from `config.json`.

## Files

- `src/catalog_textract.py` - runner script
- `config.json` - configuration input
- `requirements.txt` - Python dependencies

## Prerequisites

- Python 3.10+
- AWS account with Textract access
- AWS credentials configured (`aws configure`) or profile available

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

Edit `config.json`:

```json
{
  "source_prefixes": ["coles", "woolworths"],
  "aws_region": "us-east-1",
  "aws_profile": null,
  "source_bucket": "supra-weekly-deals",
  "source_url_base": "https://supra-weekly-deals.s3.ap-southeast-2.amazonaws.com/",
  "output_bucket": "supra-textract-output",
  "output_prefix": "temporary",
  "pretty_print": true,
  "max_workers": 8,
  "recursive": true
}
```

Config fields:
- `source_prefix` (required if `source_prefixes` missing): one S3 prefix under `source_bucket`
- `source_prefixes` (required if `source_prefix` missing): list of S3 prefixes under `source_bucket`
- `aws_region` (optional): default `us-east-1`
- `aws_profile` (optional): AWS profile name or `null`
- `source_bucket` (optional): source image S3 bucket to scan. Default `supra-weekly-deals`
- `source_url_base` (optional): public base URL for the source images. When set, `source` becomes `{source_url_base}/{provider-lowercase}/{filename}`
- `output_bucket` (optional): S3 bucket for Textract response JSON files. Default `supra-textract-output`
- `output_prefix` (optional): S3 key prefix for uploaded response JSON files. Default `temporary`
- `pretty_print` (optional): `true`/`false`
- `max_workers` (optional): concurrent worker count (default: `min(16, max(2, cpu_count * 2))`)
- `recursive` (optional): when `true`, include nested keys under each prefix. Default `true`

Supported image types:
`.png`, `.jpg`, `.jpeg`, `.tiff`, `.tif`, `.bmp`, `.gif`, `.webp`

## Run

```bash
python src/catalog_textract.py
```

Output:
- Scans image objects from `s3://supra-weekly-deals/coles/...` and `s3://supra-weekly-deals/woolworths/...`.
- Uploads one JSON file per image into `s3://supra-textract-output/temporary/...`, preserving source key structure.
- Prints a summary with counts and the target S3 bucket/prefix.
- Adds `provider` (top-level subdirectory name) and `source` (source image S3/public URL) to each output JSON.
