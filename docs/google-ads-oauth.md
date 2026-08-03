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

Use a simple local redirect such as:

- `http://localhost`

## 4. Authorization URL

Example:

```text
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/adwords&prompt=consent
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
```

## 7. Expected behavior

Once the values are present, the server will switch from mock data to live Google Ads API calls for discovery and queries.
