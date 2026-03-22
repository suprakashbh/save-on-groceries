# api-grocery-agent-invoke

Python AWS Lambda function that invokes a Bedrock Agent and returns the agent response to the frontend.

## Files

- `lambda_function.py`: Lambda handler
- `requirements.txt`: kept minimal because `boto3` is already available in the Lambda runtime

## Handler

Lambda handler value:

```text
lambda_function.lambda_handler
```

## Runtime

Recommended Lambda runtime:

```text
Python 3.12
```

## What the function does

1. Reads the Cognito user claims from `requestContext.authorizer.claims`
2. Accepts `message` and optional `sessionId`
3. Calls Bedrock Agent Runtime in `us-east-1`
4. Streams the Bedrock Agent response chunks into one string
5. Returns JSON with CORS headers

## Expected request shape

For API Gateway proxy integration:

```json
{
  "body": "{\"message\":\"show me tea deals\",\"sessionId\":\"abc-123\"}",
  "requestContext": {
    "authorizer": {
      "claims": {
        "email": "user@example.com",
        "sub": "user-sub-id"
      }
    }
  }
}
```

The handler also accepts direct invocation payloads shaped like:

```json
{
  "message": "show me tea deals",
  "sessionId": "abc-123"
}
```

## Deploy From AWS Console

1. Open AWS Lambda in `us-east-1`.
2. Create a new function.
3. Choose `Author from scratch`.
4. Function name: `api-grocery-agent-invoke`
5. Runtime: `Python 3.12`
6. Create or select an execution role.
7. In the function code editor, upload `lambda_function.py` or paste its contents.
8. Set the handler to:

```text
lambda_function.lambda_handler
```

## Deploy As Zip With AWS CLI

From the monorepo root:

```bash
cd /Users/suprakashbhowmik/IdeaProjects/groceries-savings/api-grocery-agent-invoke
zip function.zip lambda_function.py requirements.txt
```

Create the function:

```bash
aws lambda create-function \
  --region us-east-1 \
  --function-name api-grocery-agent-invoke \
  --runtime python3.12 \
  --handler lambda_function.lambda_handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<account-id>:role/<lambda-execution-role>
```

Update an existing function:

```bash
aws lambda update-function-code \
  --region us-east-1 \
  --function-name api-grocery-agent-invoke \
  --zip-file fileb://function.zip
```

## Required IAM Permissions

The Lambda execution role needs permission to invoke the Bedrock Agent and write logs.

Minimum permissions to add:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeAgent"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "*"
    }
  ]
}
```

If your environment uses tighter IAM scoping, restrict the Bedrock resource to the specific agent and alias resources.

## API Gateway Notes

If you expose this Lambda through API Gateway:

1. Use a `POST` method for the chat request.
2. Enable `OPTIONS` if you want browser preflight support.
3. Attach your Cognito authorizer if the frontend sends the ID token.
4. Make sure API Gateway forwards the request body and Cognito claims to Lambda.

## Test Event

Use this Lambda test event:

```json
{
  "body": "{\"message\":\"Show me the deals on tea\",\"sessionId\":\"test-session-1\"}",
  "requestContext": {
    "authorizer": {
      "claims": {
        "email": "demo@example.com",
        "sub": "12345678-demo"
      }
    }
  }
}
```

## Notes

- The code currently uses:
  - `agentId=KZVEAR8QDL`
  - `agentAliasId=UZTB6YIQWH`
- The Bedrock client region is fixed to `us-east-1`
- `boto3` does not need to be bundled for standard Lambda Python runtimes
