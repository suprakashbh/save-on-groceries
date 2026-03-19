# retrieve-grocery-items-deals

AWS Lambda style project that queries OpenSearch for product deals. Works locally as well.

## Install
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure
Environment variables:
- `OPENSEARCH_ENDPOINT` (collection endpoint hostname or URL)
- `OPENSEARCH_REGION` (e.g. `us-east-1`)
- `OPENSEARCH_SERVICE` (`aoss` for OpenSearch Serverless, `es` for OpenSearch Service)
- `OPENSEARCH_INDEX` (default: `weekly-grocery-deals`)

Example:
```bash
export OPENSEARCH_ENDPOINT="https://613pnf5nof27de5vwftl.us-east-1.aoss.amazonaws.com"
export OPENSEARCH_REGION="us-east-1"
export OPENSEARCH_SERVICE="aoss"
export OPENSEARCH_INDEX="weekly-grocery-deals"
```

## Run locally
```bash
PRODUCT="oats" python3 main.py
```

## Lambda handler
Entry point: `main.lambda_handler`

Input event:
```json
{ "product": "oats" }
```

Response:
```json
{
  "statusCode": 200,
  "body": [
    {
      "provider": "Woolworths",
      "price": 2.25,
      "product_text": "Uncle Tobys Oats 500g ...",
      "source": "Woolworths_page_4.png",
      "week": "2026-W11"
    }
  ]
}
```
