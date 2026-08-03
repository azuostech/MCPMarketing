# Multi-tenant OAuth deployment

The production connector uses two separate authorization relationships:

1. Claude authenticates to this MCP server with OAuth 2.1 and PKCE.
2. Each MCP user authorizes this application to access their Google Ads data.

The Google developer token and OAuth application credentials belong to the
Marketing Analytics service. Google refresh tokens and Ads account selections
belong to individual users and are stored encrypted in Supabase.

## 1. Create the database tables

Run the migration in:

```text
supabase/migrations/20260803160000_multi_tenant_oauth.sql
```

All tables have Row Level Security enabled and intentionally have no browser
policies. Only the server-side Supabase service role can access them.

## 2. Configure the Google OAuth application

Create an OAuth client of type **Web application** in Google Cloud and add this
authorized redirect URI exactly:

```text
https://mcp-marketing.vercel.app/oauth/google/callback
```

Enable the Google Ads API and configure the OAuth consent screen. Public use
requires the appropriate Google OAuth verification and a Google Ads developer
token approved for production access.

## 3. Configure production environment variables

```bash
MCP_PUBLIC_BASE_URL=https://mcp-marketing.vercel.app
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
TOKEN_ENCRYPTION_KEY=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_API_VERSION=v25
MCP_AUTH_REQUIRED=true
```

Generate the encryption key once and keep it stable:

```bash
openssl rand -base64 32
```

Changing this key makes stored Google refresh tokens and registered OAuth client
metadata unreadable. Store it only in the server environment.

Do not configure `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, or
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` in multi-tenant production. Those values are
resolved per authenticated user.

## 4. Enable authentication safely

Keep `MCP_AUTH_REQUIRED=false` until the migration and every required secret are
present. Then set it to `true` and redeploy. The MCP endpoint will return a
standards-compliant `401` challenge to unauthenticated clients, and Claude can
discover the authorization server through:

```text
/.well-known/oauth-protected-resource/mcp
/.well-known/oauth-authorization-server
```

During connection, Claude registers as an OAuth client, the user is redirected
to Google, and the callback stores only an AES-256-GCM encrypted Google refresh
token. MCP authorization codes and tokens are stored only as SHA-256 hashes.

## 5. Verify

After reconnecting the custom connector in Claude:

1. Complete the Google consent screen.
2. Call `google_ads_connection_status`.
3. Call `accounts_discovery` to enumerate directly accessible accounts and MCC clients.
4. Call `data_query` with one of the returned customer IDs.
5. Call `google_ads_disconnect` to revoke the Google grant and disable the stored connection.
