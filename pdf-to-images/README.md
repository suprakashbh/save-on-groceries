# PDF to Images (Python)

Simple Python project to read PDF files from S3, convert each page into an image using `pdf2image`, and upload the generated images back to S3.

## Prerequisites

`pdf2image` requires Poppler utilities on your system:

- macOS: `brew install poppler`
- Ubuntu/Debian: `sudo apt-get install poppler-utils`
- Windows: install Poppler and add `bin` folder to `PATH`

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Configure AWS credentials before running the script. Any standard `boto3` auth method works, for example:

```bash
aws configure
```

## Usage

```bash
python src/pdf_to_images.py
```

### Common options

```bash
# Process all PDFs from the default source bucket and upload to the default destination bucket
python src/pdf_to_images.py

# Override source or destination buckets
python src/pdf_to_images.py --source-bucket weekly-catalogue-deals-pdf --destination-bucket supra-weekly-deals

# Process a specific object key only
python src/pdf_to_images.py --pdf-key Coles.pdf

# Convert selected page range (1-based)
python src/pdf_to_images.py --first-page 2 --last-page 5
```

## Bucket behavior

- Source bucket default: `weekly-catalogue-deals-pdf`
- Destination bucket default: `supra-weekly-deals`
- `Coles.pdf` uploads to the `coles/` prefix in the destination bucket.
- `Woolworths.pdf` uploads to the `woolworths/` prefix in the destination bucket.
- Any other PDF filename uploads to the root of the destination bucket with no prefix.

Uploaded objects are named as:

`<prefix-if-any>/<pdf-name>_page_<page-number>.<format>`
