import logging
import os
import boto3
from opensearchpy import OpenSearch, RequestsHttpConnection
from requests_aws4auth import AWS4Auth

# Enable detailed logging
logging.basicConfig(level=logging.DEBUG)
logging.getLogger("opensearchpy").setLevel(logging.DEBUG)
logging.getLogger("urllib3").setLevel(logging.DEBUG)

# Configuration
endpoint = os.getenv("OPENSEARCH_ENDPOINT", "613pnf5nof27de5vwftl.us-east-1.aoss.amazonaws.com")
region = os.getenv("OPENSEARCH_REGION", "us-east-1")
service = os.getenv("OPENSEARCH_SERVICE", "aoss")
index_name = os.getenv("OPENSEARCH_INDEX", "weekly-grocery-deals")

# Normalize host (strip scheme/path)
if endpoint.startswith("https://"):
    endpoint = endpoint[len("https://") :]
elif endpoint.startswith("http://"):
    endpoint = endpoint[len("http://") :]
if "/" in endpoint:
    endpoint = endpoint.split("/", 1)[0]

# Get credentials
session = boto3.Session()
credentials = session.get_credentials()

awsauth = AWS4Auth(
    credentials.access_key,
    credentials.secret_key,
    region,
    service,
    session_token=credentials.token,
)

# Create client
client = OpenSearch(
    hosts=[{"host": endpoint, "port": 443}],
    http_auth=awsauth,
    use_ssl=True,
    verify_certs=True,
    connection_class=RequestsHttpConnection,
)

# Create index if missing, then verify
try:
    exists = client.indices.exists(index=index_name)
    if not exists:
        body = {
            "mappings": {
                "properties": {
                    "anchor_price": {"type": "float"},
                    "texts": {"type": "keyword"},
                    "provider": {"type": "keyword"},
                    "source": {"type": "keyword"},
                    "week": {"type": "keyword"},
                }
            }
        }
        create_resp = client.indices.create(index=index_name, body=body)
        print("Created index:", create_resp)
    else:
        print("Index already exists:", index_name)

    exists = client.indices.exists(index=index_name)
    print(f"Index exists ({index_name}):", exists)

except Exception as e:
    print("Error type:", type(e))
    print("Error repr:", repr(e))
    print("Error str:", str(e))
