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


def _search_deals(product: str):
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
                "texts": item.get("texts"),
                "product_text": " ".join(item.get("texts", [])),
                "source": item.get("source"),
                "week": item.get("week"),
            }
        )

    return {"statusCode": 200, "body": deals}


def _extract_bedrock_product(event):
    product_query = None
        
    # Method 1: Check parameters array (old format)
    parameters = event.get('parameters', [])
    if parameters:
        for param in parameters:
            if param.get('name') == 'product':
                product_query = param.get('value')
                break
    
    # Method 2: Check requestBody.content.application/json.properties (new format)
    if not product_query:
        request_body = event.get('requestBody', {})
        if request_body:
            print(f"Checking request body - {json.dumps(request_body, indent=2)}")
            content = request_body.get('content', {})
            app_json = content.get('application/json', {})
            properties = app_json.get('properties', [])
            
            if properties:
                for prop in properties:
                    if prop.get('name') == 'product':
                        product_query = prop.get('value')
                        print(f"=== product in properties - {product_query}")
                        break
    
    # Method 3: Check if it's directly in the application/json body
    if not product_query:
        request_body = event.get('requestBody', {})
        content = request_body.get('content', {})
        app_json = content.get('application/json', {})
        
        # Sometimes it might be a direct object
        if isinstance(app_json, dict) and 'product' in app_json:
            product_query = app_json.get('product')
            
        
    return product_query


def handle_bedrock_agent_request(event, context):
    print(f"=== ACTION GROUP LAMBDA BEDROCK INVOKED ===")
    product = _extract_bedrock_product(event)
    print(f"=== product - {product}")
    result = _search_deals(product or "")
    print(f"=== result - {result}")
    response_body = {
        "application/json": {
            "body": result,
        }
    }

    return {
        "messageVersion": "1.0",
        "response": {
            "actionGroup": event.get("actionGroup"),
            "apiPath": event.get("apiPath"),
            "httpMethod": event.get("httpMethod"),
            "httpStatusCode": result.get("statusCode", 200),
            "responseBody": response_body,
        },
    }


def handle_regular_request(event, context):
    product = event.get("product")
    if not product:
        return {"statusCode": 400, "body": {"error": "'product' is required"}}

    return _search_deals(product)


def lambda_handler(event, context):
    print(f"Full event: {json.dumps(event, indent=2)}")
    # Check if this is a Bedrock Agent request
    if "agent" in event and "actionGroup" in event:
        return handle_bedrock_agent_request(event, context)
    else:
        # Handle regular Lambda invocation
        return handle_regular_request(event, context)


if __name__ == "__main__":
    # Local test
    event = {"product": os.getenv("PRODUCT", "oats")}
    print(json.dumps(lambda_handler(event, None), indent=2))
