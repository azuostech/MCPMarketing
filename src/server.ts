declare const process: { env: Record<string, string | undefined>; exit: (code?: number) => never };

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { z } from 'zod';
import {
  AccountsDiscoveryInputSchema,
  DataQueryInputSchema,
  DataSourceDiscoveryInputSchema,
  FieldDiscoveryInputSchema,
  GetQueryResultsInputSchema
} from './lib/schemas.js';
import {
  handleAccountsDiscovery,
  handleDataQuery,
  handleDataSourceDiscovery,
  handleFieldDiscovery,
  handleGetQueryResults
} from './tools/handlers.js';

dotenv.config();

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

const toMcpInputSchema = (schema: z.ZodTypeAny) => {
  const shape = schema instanceof z.ZodObject ? schema.shape : {};
  const properties: Record<string, { type: string }> = {};

  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof z.ZodString) {
      properties[key] = { type: 'string' };
    } else if (value instanceof z.ZodArray) {
      properties[key] = { type: 'array' };
    } else if (value instanceof z.ZodNumber) {
      properties[key] = { type: 'number' };
    } else if (value instanceof z.ZodBoolean) {
      properties[key] = { type: 'boolean' };
    } else {
      properties[key] = { type: 'object' };
    }
  }

  return {
    type: 'object' as const,
    properties,
    required: Object.keys(shape).filter((key) => !(shape[key] instanceof z.ZodOptional))
  };
};

const tools: Tool[] = [
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
  }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'data_source_discovery': {
        const parsed = DataSourceDiscoveryInputSchema.parse(args ?? {});
        const result = await handleDataSourceDiscovery(parsed.search);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'accounts_discovery': {
        const parsed = AccountsDiscoveryInputSchema.parse(args ?? {});
        const result = await handleAccountsDiscovery(parsed.source);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'field_discovery': {
        const parsed = FieldDiscoveryInputSchema.parse(args ?? {});
        const result = await handleFieldDiscovery(parsed.source, parsed.search);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'data_query': {
        const parsed = DataQueryInputSchema.parse(args ?? {});
        const result = await handleDataQuery(parsed);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
      case 'get_query_results': {
        const parsed = GetQueryResultsInputSchema.parse(args ?? {});
        const result = await handleGetQueryResults(parsed.scheduleId);
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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('MCP Marketing Analytics server running on stdio');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
