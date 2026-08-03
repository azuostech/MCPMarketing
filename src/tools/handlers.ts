import { getFieldCatalog, getGoogleAdsConfig, listGoogleAdsAccounts, queryGoogleAds } from '../lib/googleAds.js';
import { mockAccounts, mockDataSources, mockFields, mockQueryResult } from '../lib/mockData.js';

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
  if (input.source === 'AW') {
    const config = getGoogleAdsConfig();
    return queryGoogleAds(config, input);
  }

  return {
    ...mockQueryResult,
    requested: {
      source: input.source,
      accounts: input.accounts,
      fields: input.fields,
      dateRange: input.dateRange,
      filters: input.filters ?? []
    }
  };
}
