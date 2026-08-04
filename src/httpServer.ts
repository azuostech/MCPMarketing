import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthRouter
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import {
  getPublicBaseUrl,
  isMcpAuthEnabled,
  MarketingOAuthProvider
} from './auth/provider.js';
import { toMcpInputSchema } from './lib/mcpSchema.js';
import {
  AccountsDiscoveryInputSchema,
  DataQueryInputSchema,
  DataSourceDiscoveryInputSchema,
  FieldDiscoveryInputSchema,
  GetQueryResultsInputSchema,
  GoogleAdsConnectionStatusInputSchema,
  GoogleAdsDisconnectInputSchema,
  GoogleAdsReconnectInputSchema,
  HealthCheckInputSchema
} from './lib/schemas.js';
import {
  handleAccountsDiscovery,
  handleDataQuery,
  handleDataSourceDiscovery,
  handleFieldDiscovery,
  handleGetQueryResults,
  handleGoogleAdsConnectionStatus,
  handleGoogleAdsDisconnect,
  handleHealthCheck
} from './tools/handlers.js';

dotenv.config();

export const app = express();
// Vercel terminates TLS and forwards the original client address. The OAuth
// router uses express-rate-limit, which must be told to trust that first proxy
// hop or it treats every forwarded request as a configuration error.
app.set('trust proxy', 1);
app.use(express.json());

const authEnabled = isMcpAuthEnabled();
const publicBaseUrl = getPublicBaseUrl();
const mcpResourceUrl = new URL('/mcp', publicBaseUrl);
const oauthProvider = authEnabled ? new MarketingOAuthProvider(publicBaseUrl) : undefined;

if (oauthProvider) {
  app.use(mcpAuthRouter({
    provider: oauthProvider,
    issuerUrl: publicBaseUrl,
    resourceServerUrl: mcpResourceUrl,
    scopesSupported: ['mcp:tools'],
    resourceName: 'Marketing Analytics MCP'
  }));

  app.get('/oauth/google/callback', async (req: any, res: any) => {
    try {
      const redirect = await oauthProvider.handleGoogleCallback(req.query);
      res.redirect(302, redirect.href);
    } catch (error) {
      console.error('Google OAuth callback failed', error);
      const missingAdsScope = error instanceof Error
        && error.message.includes('required Google Ads scope');
      res.status(400).type('text/plain').send(missingAdsScope
        ? 'Google Ads permission was not granted. Return to Claude, request a new authorization link, and approve Google Ads access.'
        : 'Google Ads authorization failed. Please return to Claude and try again.');
    }
  });
}

export const tools: Tool[] = [
  {
    name: 'google_ads_connection_status',
    description: 'Check whether Google Ads credentials are configured and, when disconnected, return a secure reconnection link without exposing secret values',
    inputSchema: toMcpInputSchema(GoogleAdsConnectionStatusInputSchema)
  },
  {
    name: 'google_ads_reconnect',
    description: 'Create a secure, short-lived Google authorization link to reconnect the current user\'s Google Ads account',
    inputSchema: toMcpInputSchema(GoogleAdsReconnectInputSchema)
  },
  {
    name: 'google_ads_disconnect',
    description: 'Revoke and disconnect the current user\'s Google Ads authorization',
    inputSchema: toMcpInputSchema(GoogleAdsDisconnectInputSchema)
  },
  {
    name: 'data_source_discovery',
    description: 'List available marketing data sources and their configuration requirements',
    inputSchema: toMcpInputSchema(DataSourceDiscoveryInputSchema)
  },
  {
    name: 'accounts_discovery',
    description: 'List connected marketing accounts for the selected data source',
    inputSchema: toMcpInputSchema(AccountsDiscoveryInputSchema)
  },
  {
    name: 'field_discovery',
    description: 'List available fields for a given marketing data source',
    inputSchema: toMcpInputSchema(FieldDiscoveryInputSchema)
  },
  {
    name: 'data_query',
    description: 'Execute a marketing analytics query using the selected source, accounts, fields, and date range',
    inputSchema: toMcpInputSchema(DataQueryInputSchema)
  },
  {
    name: 'get_query_results',
    description: 'Retrieve the result of a previously executed query by schedule ID',
    inputSchema: toMcpInputSchema(GetQueryResultsInputSchema)
  },
  {
    name: 'health_check',
    description: 'Return basic server health and capabilities information',
    inputSchema: toMcpInputSchema(HealthCheckInputSchema)
  }
];

function createServer() {
  const server = new Server(
    {
      name: process.env.MCP_SERVER_NAME ?? 'mcp-marketing-analytics',
      version: '0.1.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const userId = typeof extra.authInfo?.extra?.userId === 'string'
      ? extra.authInfo.extra.userId
      : undefined;
    const clientId = extra.authInfo?.clientId;

    try {
      switch (name) {
        case 'data_source_discovery': {
          const parsed = DataSourceDiscoveryInputSchema.parse(args ?? {});
          const result = await handleDataSourceDiscovery(parsed.search);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'accounts_discovery': {
          const parsed = AccountsDiscoveryInputSchema.parse(args ?? {});
          const result = await handleAccountsDiscovery(parsed.source, userId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'field_discovery': {
          const parsed = FieldDiscoveryInputSchema.parse(args ?? {});
          const result = await handleFieldDiscovery(parsed.source, parsed.search);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'data_query': {
          const parsed = DataQueryInputSchema.parse(args ?? {});
          const result = await handleDataQuery(parsed, userId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'get_query_results': {
          const parsed = GetQueryResultsInputSchema.parse(args ?? {});
          const result = await handleGetQueryResults(parsed.scheduleId, userId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'health_check': {
          const result = await handleHealthCheck();
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'google_ads_connection_status': {
          const result = await handleGoogleAdsConnectionStatus(userId);
          if (oauthProvider && userId && clientId && 'connected' in result && result.connected === false) {
            const authorizationUrl = await oauthProvider.createGoogleAdsReconnectUrl(clientId, userId);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  ...result,
                  reconnect: {
                    authorization_url: authorizationUrl.href,
                    expires_in_seconds: 600,
                    instructions: 'Open this URL, approve Google Ads access, then run google_ads_connection_status again.'
                  }
                }, null, 2)
              }]
            };
          }
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'google_ads_reconnect': {
          GoogleAdsReconnectInputSchema.parse(args ?? {});
          if (!oauthProvider || !userId || !clientId) {
            throw new Error('Google Ads reconnect requires an authenticated MCP user.');
          }
          const authorizationUrl = await oauthProvider.createGoogleAdsReconnectUrl(clientId, userId);
          const result = {
            authorization_url: authorizationUrl.href,
            expires_in_seconds: 600,
            instructions: 'Open the authorization URL, approve Google Ads access, then run google_ads_connection_status again.'
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'google_ads_disconnect': {
          const result = await handleGoogleAdsDisconnect(userId);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true
      };
    }
  });

  return server;
}

const mcpPostHandler = async (req: any, res: any) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      // Vercel functions cannot reliably retain or route in-memory MCP sessions.
      // Stateless mode lets every request be handled by a fresh function instance.
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to handle MCP request' });
  }
};

if (oauthProvider) {
  app.post('/mcp', requireBearerAuth({
    verifier: oauthProvider,
    requiredScopes: ['mcp:tools'],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpResourceUrl)
  }), mcpPostHandler);
} else {
  app.post('/mcp', mcpPostHandler);
}

app.get('/health', (_req: any, res: any) => {
  res.json({ ok: true, service: 'mcp-marketing-analytics' });
});

app.get('/oauth/google/complete', (_req: any, res: any) => {
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Google Ads conectado</title></head><body style="font-family:system-ui;max-width:640px;margin:64px auto;padding:0 24px">
<h1>Google Ads conectado</h1><p>A autorização foi atualizada. Você já pode fechar esta janela e voltar ao Claude.</p>
</body></html>`);
});

if (process.env.VERCEL !== '1') {
  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`MCP Marketing Analytics HTTP server listening on port ${port}`);
  });
}

export default app;
