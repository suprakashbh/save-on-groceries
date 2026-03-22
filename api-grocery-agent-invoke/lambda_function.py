import json
import uuid

import boto3
from botocore.exceptions import ClientError


CORS_HEADERS = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
}


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def parse_body(event):
    body = event.get("body")

    if isinstance(body, str) and body:
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {}

    if isinstance(body, dict):
        return body

    return event if isinstance(event, dict) else {}


def lambda_handler(event, context):
    print(f"Received event: {json.dumps(event)}")

    if event.get("httpMethod") == "OPTIONS":
        return response(200, {"ok": True})

    try:
        user_info = event.get("requestContext", {}).get("authorizer", {}).get("claims", {})
        user_email = user_info.get("email", "unknown")
        user_id = user_info.get("sub", "unknown")

        body = parse_body(event)
        user_message = body.get("message", "")
        session_id = body.get("sessionId", str(uuid.uuid4()))
        print(f"user_message: {user_message}")

        if not user_message:
            return response(400, {"error": "Message is required"})

        bedrock_client = boto3.client("bedrock-agent-runtime", region_name="us-east-1")

        invoke_response = bedrock_client.invoke_agent(
            agentId="KZVEAR8QDL",
            agentAliasId="UZTB6YIQWH",
            sessionId=session_id,
            inputText=f"User {user_email} asks: {user_message}",
        )

        agent_response = ""
        for event_chunk in invoke_response["completion"]:
            print(f"Event chunk type: {list(event_chunk.keys())}")
            if "chunk" in event_chunk and "bytes" in event_chunk["chunk"]:
                agent_response += event_chunk["chunk"]["bytes"].decode("utf-8")
                print(f"Chunk text: {agent_response}")

        return response(
            200,
            {
                "response": agent_response,
                "sessionId": session_id,
                "userId": user_id,
            },
        )

    except ClientError as error:
        print(f"AWS Client Error: {str(error)}")
        return response(500, {"error": "Failed to invoke agent"})
    except Exception as error:
        print(f"Error: {str(error)}")
        return response(500, {"error": "Internal server error"})
