# load-groceries-deals

Load grocery deal candidates from JSON files in S3 into AWS OpenSearch.

## Input format
Each S3 input file should be either:
- A dict with `product_candidates` array (like your `*_nova_input.json`), or
- A raw array of product candidate objects.

Each candidate is indexed as its own document.

Example candidate:
```json
{
  "anchor_price": 5.0,
  "texts": ["Varieties 288g", "Pk 6", "Balance Wrap"],
  "provider": "Woolworths",
  "source": "Woolworths_page_23.png",
  "week": "2026-W11"
}
```

## Install
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run
```bash
OPENSEARCH_URL="https://your-endpoint" \
OPENSEARCH_REGION="us-east-1" \
python3 main.py --s3-bucket supra-weekly-products-load --index weekly-grocery-deals --create-index
```

By default, the loader scans these prefixes in the bucket:
- `s3://supra-weekly-products-load/coles/`
- `s3://supra-weekly-products-load/woolworths/`

To override or add prefixes, repeat `--s3-prefix`:
```bash
python3 main.py \
  --s3-bucket supra-weekly-products-load \
  --s3-prefix coles \
  --s3-prefix woolworths
```

## Auth options
The loader supports two auth modes:

### 1) Basic auth
Set:
- `OPENSEARCH_URL` (e.g. `https://search-...`) or `OPENSEARCH_HOST`
- `OPENSEARCH_USER`
- `OPENSEARCH_PASSWORD`

### 2) AWS SigV4 (recommended for AWS OpenSearch)
Set:
- `OPENSEARCH_URL` (or `OPENSEARCH_HOST`)
- `OPENSEARCH_REGION`

Credentials are taken from the standard AWS credential chain (env vars, profile, or instance role).

## AWS access
The loader also uses the AWS credential chain to access S3. The active credentials need permission to:
- `s3:ListBucket` on `supra-weekly-products-load`
- `s3:GetObject` on the selected input prefixes
- `s3:DeleteObject` on the selected input prefixes

## Environment variables
- `OPENSEARCH_URL`: full https URL to your OpenSearch endpoint
- `OPENSEARCH_HOST`: hostname only (alternative to URL)
- `OPENSEARCH_PORT`: default `443`
- `OPENSEARCH_REGION`: required for SigV4
- `OPENSEARCH_USER`, `OPENSEARCH_PASSWORD`: for basic auth
- `OPENSEARCH_VERIFY_CERTS`: `true`/`false` (default `true`)
- `OPENSEARCH_SERVICE`: SigV4 service name (`es` for OpenSearch Service, `aoss` for OpenSearch Serverless)

## Notes
- If `--create-index` is set, the index is created if missing.
- Files are discovered from S3 under the configured prefixes.
- After a file is successfully indexed into `weekly-grocery-deals` (or the configured index), that S3 object is deleted from the input bucket.
- In `--dry-run` mode, files are only validated and are not indexed or deleted.
