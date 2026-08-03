import {
  disconnectGoogleAdsForUser,
  getFieldCatalog,
  getGoogleAdsConfig,
  getGoogleAdsConfigForUser,
  getGoogleAdsConnectionStatus,
  getGoogleAdsConnectionStatusForUser,
  listGoogleAdsAccounts,
  queryGoogleAds,
  saveGoogleAdsAccountsForUser
} from '../lib/googleAds.js';
import { getServerHealth } from '../lib/health.js';
import { mockDataSources } from '../lib/mockData.js';
import { createOpaqueToken } from '../auth/crypto.js';

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

async function resolveGoogleAdsConfig(userId?: string) {
  return userId ? getGoogleAdsConfigForUser(userId) : getGoogleAdsConfig();
}

export async function handleAccountsDiscovery(source?: string, userId?: string) {
  const normalizedSource = source ?? 'AW';
  if (normalizedSource !== 'AW') {
    throw new Error(`Unsupported marketing data source: ${normalizedSource}`);
  }
  const config = await resolveGoogleAdsConfig(userId);
  const accounts = await listGoogleAdsAccounts(config);
  if (userId) {
    await saveGoogleAdsAccountsForUser(userId, accounts);
  }

  return {
    source: normalizedSource,
    accounts
  };
}

export async function handleFieldDiscovery(source?: string, search?: string) {
  const normalizedSource = source ?? 'AW';
  if (normalizedSource !== 'AW') {
    throw new Error(`Unsupported marketing data source: ${normalizedSource}`);
  }
  const fields = getFieldCatalog(search);

  return {
    source: normalizedSource,
    fields
  };
}

export async function handleDataQuery(input: {
  source: string;
  accounts: string[];
  fields: string[];
  dateRange: { start: string; end: string };
  filters?: string[];
}, userId?: string) {
  if (input.source !== 'AW') {
    throw new Error(`Unsupported marketing data source: ${input.source}`);
  }
  const result = await queryGoogleAds(await resolveGoogleAdsConfig(userId), input);

  const scheduleId = `schedule-${createOpaqueToken(12)}`;
  pendingResults.set(`${userId ?? 'local'}:${scheduleId}`, result);

  return {
    ...result,
    scheduleId,
    status: 'completed'
  };
}

export async function handleGetQueryResults(scheduleId: string, userId?: string) {
  const cached = pendingResults.get(`${userId ?? 'local'}:${scheduleId}`);

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

export async function handleHealthCheck() {
  return getServerHealth();
}

export async function handleGoogleAdsConnectionStatus(userId?: string) {
  return userId ? getGoogleAdsConnectionStatusForUser(userId) : getGoogleAdsConnectionStatus();
}

export async function handleGoogleAdsDisconnect(userId?: string) {
  if (!userId) {
    throw new Error('Google Ads disconnect requires an authenticated MCP user.');
  }
  return disconnectGoogleAdsForUser(userId);
}
