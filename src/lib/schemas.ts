import { z } from 'zod';

export const DataSourceDiscoveryInputSchema = z.object({
  search: z.string().optional().describe('Keyword to filter available data sources')
});

export const AccountsDiscoveryInputSchema = z.object({
  source: z.string().optional().describe('Data source identifier, e.g. AW')
});

export const FieldDiscoveryInputSchema = z.object({
  source: z.string().optional().describe('Data source identifier, e.g. AW'),
  search: z.string().optional().describe('Keyword to filter fields')
});

export const DataQueryInputSchema = z.object({
  source: z.string().describe('Data source identifier, e.g. AW'),
  accounts: z.array(z.string()).describe('Account IDs to query'),
  fields: z.array(z.string()).describe('Fields to include, dimensions first and metrics later'),
  dateRange: z.object({
    start: z.string(),
    end: z.string()
  }).describe('Date range in YYYY-MM-DD format'),
  filters: z.array(z.string()).optional().describe('Optional filter expressions like "clicks > 10"')
});

export const GetQueryResultsInputSchema = z.object({
  scheduleId: z.string().describe('Identifier returned by the data_query tool when the query is async')
});

export const HealthCheckInputSchema = z.object({}).strict();

export const GoogleAdsConnectionStatusInputSchema = z.object({}).strict();

export const GoogleAdsDisconnectInputSchema = z.object({}).strict();
