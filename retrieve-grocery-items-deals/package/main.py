import json
import os
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth

INDEX_NAME = os.getenv("OPENSEARCH_INDEX", "weekly-grocery-deals")
ENDPOINT = os.getenv("OPENSEARCH_ENDPOINT", "613pnf5nof27de5vwftl.us-east-1.aoss.amazonaws.com")
REGION = os.getenv("OPENSEARCH_REGION", "us-east-1")
SERVICE = os.getenv("OPENSEARCH_SERVICE", "aoss")


def _normalize_host(url_or_host: str) -> str:
    host = url_or_host.strip()
    if host.startswith("https://"):
        host = host[len("https://") :]
    elif host.startswith("http://"):
        host = host[len("http://") :]
    if "/" in host:
        host = host.split("/", 1)[0]
    return host


def _get_client() -> OpenSearch:
    session = boto3.Session()
    credentials = session.get_credentials()
    auth = AWSV4SignerAuth(credentials, REGION, SERVICE)

    client = OpenSearch(
        hosts=[{"host": _normalize_host(ENDPOINT), "port": 443}],
        http_auth=auth,
        use_ssl=True,
        verify_certs=True,
        connection_class=RequestsHttpConnection,
    )

    return client


def _extract_bedrock_product(event):
    params = event.get("parameters") or []
    for p in params:
        if p.get("name") == "product":
            return p.get("value")

    content = event.get("content", {})
    app_json = content.get("application/json", {})
    properties = app_json.get("properties", [])

    if isinstance(properties, dict):
        product = properties.get("product")
        if isinstance(product, dict):
            return product.get("value") or product.get("default")
        return product

    for prop in properties:
        if prop.get("name") == "product":
            return prop.get("value") or prop.get("default")

    return None


def lambda_handler(event, context):
    product = event.get("product") or _extract_bedrock_product(event)
    if not product:
        return {"statusCode": 400, "body": {"error": "'product' is required"}}

    product = product.strip()
    if not product:
        return {"statusCode": 400, "body": {"error": "'product' is required"}}

    text_query = {
        "wildcard": {
            "texts": {
                "value": f"*{product}*",
                "case_insensitive": True,
            }
        }
    }

    query = {
        "size": 20,
        "query": text_query,
        "sort": [{"anchor_price": {"order": "asc"}}],
    }

    client = _get_client()
    response = client.search(body=query, index=INDEX_NAME)

    deals = []
    for hit in response.get("hits", {}).get("hits", []):
        item = hit.get("_source", {})
        deals.append(
            {
                "provider": item.get("provider"),
                "price": item.get("anchor_price"),
                "product_text": " ".join(item.get("texts", [])),
                "source": item.get("source"),
                "week": item.get("week"),
            }
        )

    return {"statusCode": 200, "body": deals}


if __name__ == "__main__":
    # Local test
    event = {"product": os.getenv("PRODUCT", "oats")}
    print(json.dumps(lambda_handler(event, None), indent=2))
