# MCP Marketing Analytics

A minimal MCP server for marketing analytics data discovery and querying, starting with a Google Ads integration layer.

## Features

- Data source discovery
- Google Ads account discovery
- Field discovery for metrics and dimensions
- Data query execution with mock fallback and real Google Ads support when configured

## Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
3. Build the project:
   ```bash
   npm run build
   ```
4. Start the server:
   ```bash
   npm start
   ```

## Testing with MCP Inspector

Run the inspector against the local server:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

### Example tool calls

Health check:
```json
{
  "name": "health_check",
  "arguments": {}
}
```

Discover sources:
```json
{
  "name": "data_source_discovery",
  "arguments": {
    "search": "google"
  }
}
```

Discover accounts:
```json
{
  "name": "accounts_discovery",
  "arguments": {
    "source": "AW"
  }
}
```

Discover fields:
```json
{
  "name": "field_discovery",
  "arguments": {
    "source": "AW",
    "search": "cost"
  }
}
```

Run a query:
```json
{
  "name": "data_query",
  "arguments": {
    "source": "AW",
    "accounts": ["1234567890"],
    "fields": ["date", "campaign_name", "clicks", "cost"],
    "dateRange": {
      "start": "2026-07-01",
      "end": "2026-07-07"
    },
    "filters": ["clicks > 100"]
  }
}
```

Retrieve query result:
```json
{
  "name": "get_query_results",
  "arguments": {
    "scheduleId": "schedule-123"
  }
}
```

## Google Ads configuration

To enable the real Google Ads API flow, define these environment variables in your `.env` file:

```bash
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=
```

### OAuth 2.0 setup for Google Ads

1. Create or select a Google Cloud project.
2. Enable the Google Ads API in the Google Cloud console.
3. Create OAuth 2.0 Client ID credentials for a desktop application.
4. Add the following OAuth scopes to the consent screen:
   - `https://www.googleapis.com/auth/adwords`
5. Use a redirect URI such as:
   - `http://localhost`
6. Complete the OAuth authorization flow and store the generated refresh token in `GOOGLE_ADS_REFRESH_TOKEN`.
7. Insert your Google Ads developer token and customer IDs in the environment variables above.

### Recommended values for the environment file

- `GOOGLE_ADS_DEVELOPER_TOKEN`: your Google Ads manager/developer token.
- `GOOGLE_ADS_CLIENT_ID`: OAuth client ID from Google Cloud.
- `GOOGLE_ADS_CLIENT_SECRET`: OAuth client secret from Google Cloud.
- `GOOGLE_ADS_REFRESH_TOKEN`: refresh token obtained after the OAuth flow.
- `GOOGLE_ADS_CUSTOMER_ID`: the Google Ads customer ID you want to query.
- `GOOGLE_ADS_LOGIN_CUSTOMER_ID`: the manager/customer ID used for login context, often the same as the customer ID.

### Example OAuth flow

If you want to test the flow manually, use the standard OAuth 2.0 desktop-app flow:

```bash
https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://localhost&response_type=code&access_type=offline&scope=https://www.googleapis.com/auth/adwords&prompt=consent
```

Then exchange the returned authorization code for a refresh token using a local callback or a temporary helper script.

### Important notes

- The Google Ads API requires a valid developer token and OAuth credentials.
- The current implementation uses mock data whenever the required credentials are missing.
- Once the credentials are present, the server will attempt to call the real Google Ads API endpoints.

## Notes

The current implementation uses mock responses automatically when the Google Ads credentials are missing, so the MCP structure can be exercised immediately.
