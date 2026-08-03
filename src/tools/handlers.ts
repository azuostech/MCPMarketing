import { getFieldCatalog, getGoogleAdsConfig, listGoogleAdsAccounts, queryGoogleAds } from '../lib/googleAds.js';
import { mockAccounts, mockDataSources, mockFields, mockQueryResult } from '../lib/mockData.js';

const pendingResults = new Map<string, unknown>();

export async function handleDataSourceDiscovery(search?: string) {
  const filtered = !search
    ? mockDataSources
    : mockDataSources.filter((source) =>
        source.name.toLowerCase().includes(search.toLowerCase()) || source.id.toLowerCase().includes(search.toLowerCase())
      );

  return {
    source: 'AW',
    data_sources: filtered
  };
}

export async function handleAccountsDiscovery(source?: string) {
  const config = getGoogleAdsConfig();
  const accounts = source === 'AW'
    ? await listGoogleAdsAccounts(config)
    : mockAccounts;

  return {
    source: source ?? 'AW',
    accounts
  };
}

export async function handleFieldDiscovery(source?: string, search?: string) {
  const fields = source === 'AW' ? getFieldCatalog(search) : mockFields;

  return {
    source: source ?? 'AW',
    fields
  };
}

export async function handleDataQuery(input: {
  source: string;
  accounts: string[];
  fields: string[];
  dateRange: { start: string; end: string };
  filters?: string[];
}) {
  const result = input.source === 'AW'
    ? await queryGoogleAds(getGoogleAdsConfig(), input)
    : {
        ...mockQueryResult,
        requested: {
          source: input.source,
          accounts: input.accounts,
          fields: input.fields,
          dateRange: input.dateRange,
          filters: input.filters ?? []
        }
      };

  const scheduleId = `schedule-${Date.now()}`;
  pendingResults.set(scheduleId, result);

  return {
    ...result,
    scheduleId,
    status: 'completed'
  };
}

export async function handleGetQueryResults(scheduleId: string) {
  const cached = pendingResults.get(scheduleId);

  if (!cached) {
    return {
      scheduleId,
      status: 'not_found',
      message: 'No query result found for this schedule ID.'
    };
  }

  return {
    scheduleId,
    status: 'completed',
    result: cached
  };
}
