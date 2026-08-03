# Google Ads OAuth setup guide

This guide collects the main steps needed to prepare the real OAuth flow for the Google Ads integration.

## 1. Google Cloud project

- Create or select a Google Cloud project.
- Enable the Google Ads API.
- Create OAuth 2.0 Client ID credentials for a desktop application.

## 2. OAuth consent screen

- Configure the OAuth consent screen.
- Add the Google Ads scope:
  - `https://www.googleapis.com/auth/adwords`

## 3. Redirect URI

The included OAuth helper uses this loopback redirect:

- `http://127.0.0.1:3000/callback`

## 4. Authorization URL

Example:

```text
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://127.0.0.1:3000/callback&response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/adwords&prompt=consent
```

## 5. Exchange code for refresh token

After the user authorizes the app, exchange the returned authorization code for tokens using the OAuth token endpoint.

## 6. Environment variables

Populate these values in the project `.env` file:

```bash
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
GOOGLE_ADS_API_VERSION=v25
GOOGLE_ADS_MOCK_MODE=false
```

For the production MCP connector, add the same variables to the Vercel project's
Production environment and redeploy. Do not commit credential values to Git.

- `GOOGLE_ADS_CUSTOMER_ID` is the default client account and may contain hyphens.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID` is the manager account ID when accessing clients through an MCC.
- `GOOGLE_ADS_API_VERSION` defaults to `v25`.
- Mock data is returned only when `GOOGLE_ADS_MOCK_MODE=true` is explicitly set.

## 7. Expected behavior

After deployment, call `google_ads_connection_status` and then `accounts_discovery`
from the MCP client. The status tool reports missing variable names without exposing
secret values.
