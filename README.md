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

### How to generate a Google Ads refresh token

1. Create a Google Cloud project and enable the Google Ads API.
2. Create OAuth2 credentials for a desktop app.
3. Request the OAuth scopes needed for Google Ads access.
4. Complete the OAuth flow and store the refresh token in `GOOGLE_ADS_REFRESH_TOKEN`.
5. Add your manager/customer ID values in the corresponding environment variables.

## Notes

The current implementation uses mock responses automatically when the Google Ads credentials are missing, so the MCP structure can be exercised immediately.
