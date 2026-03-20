# grocery-deals-app

React app to chat with your Bedrock Agent via API Gateway. Uses Cognito Hosted UI for login only (no sign-up).

## Setup
```bash
cd /Users/suprakashbhowmik/IdeaProjects/groceries-savings/grocery-deals-app
npm install
cp .env.example .env
```

Fill in `.env` with your Cognito Hosted UI domain and desired API request field.
Do not commit `.env`; for deployed environments prefer leaving the redirect vars unset so the app uses `window.location.origin`.

## Run (local)
```bash
npm run dev
```

Local URL: `https://localhost:5001/`

## Cognito Hosted UI
The app uses OAuth2 code flow with PKCE. The callback is:
```
https://localhost:5001/callback.html
```

Ensure this is listed in your Cognito App Client callback URLs and sign-out URLs.

## API Gateway
The app POSTs JSON to `VITE_API_BASE_URL` with payload:
```
{ "message": "user message", "sessionId": "<uuid>" }
```

## Deploy To AWS Amplify

This app is a static Vite SPA. The repo includes [amplify.yml](/Users/suprakashbhowmik/IdeaProjects/groceries-savings/grocery-deals-app/amplify.yml) for Amplify Hosting builds:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

### 1. Create the Amplify app

In AWS Amplify Hosting:

1. Choose **New app**.
2. Connect your Git repository, or use manual deploy if you only want to upload the built `dist/` output.
3. Keep the app as a **static** frontend app.
4. If the console shows build settings, keep the repo `amplify.yml`.

### 2. Add Amplify environment variables

In **Hosting > Environment variables**, add:

```bash
VITE_COGNITO_DOMAIN=us-east-1btj0kck5q.auth.us-east-1.amazoncognito.com
VITE_COGNITO_CLIENT_ID=6vt01hrj1d8u7pln5j5dpf56rp
VITE_COGNITO_SCOPES=openid email profile
VITE_API_BASE_URL=https://2xtv24ztwk.execute-api.us-east-1.amazonaws.com/poc/chat
```

Optional explicit redirects for local testing only:

```bash
VITE_DEAL_SOURCE_BASE_URL=https://supra-weekly-deals.s3.ap-southeast-2.amazonaws.com
```

If you omit the Cognito redirect vars, the app defaults to:

- sign-in: `window.location.origin/callback.html`
- sign-out: `window.location.origin/`

### 3. Add the Cognito callback URLs

After Amplify gives you a domain such as:

```text
https://main.d123abcxyz.amplifyapp.com
```

add these URLs to your Cognito app client:

```text
https://main.d123abcxyz.amplifyapp.com/callback.html
https://main.d123abcxyz.amplifyapp.com/
```

If you later attach a custom domain, add the same two paths for that custom domain too.

### 4. Add the SPA rewrite rule in Amplify

In **Hosting > Rewrites and redirects**, add this rewrite so React Router routes work:

```json
[
  {
    "source": "</^[^.]+$|\\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp)$)([^.]+$)/>",
    "target": "/index.html",
    "status": "200",
    "condition": null
  }
]
```

This is important for routes like `/callback` and `/`.

### 5. Deploy

If using Git-based deployment, push to the connected branch and Amplify will build and publish automatically.

If using manual deployment:

```bash
npm run build
```

Then upload the generated `dist/` folder to Amplify Hosting.
