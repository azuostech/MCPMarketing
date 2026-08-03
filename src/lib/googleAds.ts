declare const process: { env: Record<string, string | undefined> };

import { mockAccounts, mockQueryResult } from './mockData.js';
import { selectOne, updateRows, upsertRow } from '../auth/database.js';
import { decryptSecret } from '../auth/crypto.js';

export type GoogleAdsConfig = {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
  apiVersion: string;
  mockMode: boolean;
};

export type GoogleAdsAccount = {
  account_id: string;
  name: string;
  status: string;
  manager?: boolean;
  level?: number;
  login_customer_id?: string;
};

const DEFAULT_API_VERSION = 'v25';
const REQUIRED_AUTH_ENV = [
  'GOOGLE_ADS_DEVELOPER_TOKEN',
  'GOOGLE_ADS_CLIENT_ID',
  'GOOGLE_ADS_CLIENT_SECRET',
  'GOOGLE_ADS_REFRESH_TOKEN'
] as const;

const FIELD_CATALOG = [
  { name: 'date', type: 'dimension', description: 'Date of the record', googleAdsField: 'segments.date', responsePath: 'segments.date' },
  { name: 'campaign_name', type: 'dimension', description: 'Campaign name', googleAdsField: 'campaign.name', responsePath: 'campaign.name' },
  { name: 'campaign_id', type: 'dimension', description: 'Campaign identifier', googleAdsField: 'campaign.id', responsePath: 'campaign.id' },
  { name: 'campaign_status', type: 'dimension', description: 'Campaign status', googleAdsField: 'campaign.status', responsePath: 'campaign.status' },
  { name: 'channel_type', type: 'dimension', description: 'Campaign advertising channel type', googleAdsField: 'campaign.advertising_channel_type', responsePath: 'campaign.advertisingChannelType' },
  { name: 'clicks', type: 'metric', description: 'Total clicks', googleAdsField: 'metrics.clicks', responsePath: 'metrics.clicks' },
  { name: 'impressions', type: 'metric', description: 'Total impressions', googleAdsField: 'metrics.impressions', responsePath: 'metrics.impressions' },
  { name: 'ctr', type: 'metric', description: 'Click-through rate', googleAdsField: 'metrics.ctr', responsePath: 'metrics.ctr' },
  { name: 'cost', type: 'metric', description: 'Spend in the account currency', googleAdsField: 'metrics.cost_micros', responsePath: 'metrics.costMicros', micros: true },
  { name: 'conversions', type: 'metric', description: 'Conversions attributed by Google Ads', googleAdsField: 'metrics.conversions', responsePath: 'metrics.conversions' },
  { name: 'conversion_value', type: 'metric', description: 'Total conversion value', googleAdsField: 'metrics.conversions_value', responsePath: 'metrics.conversionsValue' }
] as const;

const FIELD_MAP = Object.fromEntries(
  FIELD_CATALOG.map((field) => [field.name, field])
);

function getEnvValue(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function getGoogleAdsConfig(): GoogleAdsConfig {
  const configuredVersion = getEnvValue('GOOGLE_ADS_API_VERSION') ?? DEFAULT_API_VERSION;

  return {
    developerToken: getEnvValue('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: getEnvValue('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: getEnvValue('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: getEnvValue('GOOGLE_ADS_REFRESH_TOKEN'),
    customerId: getEnvValue('GOOGLE_ADS_CUSTOMER_ID'),
    loginCustomerId: getEnvValue('GOOGLE_ADS_LOGIN_CUSTOMER_ID'),
    apiVersion: /^v\d+$/.test(configuredVersion) ? configuredVersion : DEFAULT_API_VERSION,
    mockMode: getEnvValue('GOOGLE_ADS_MOCK_MODE') === 'true'
  };
}

export function hasGoogleAdsConfig(config: GoogleAdsConfig): boolean {
  return Boolean(
    config.developerToken &&
      config.clientId &&
      config.clientSecret &&
      config.refreshToken
  );
}

export function getGoogleAdsConnectionStatus(config = getGoogleAdsConfig()) {
  const values: Record<(typeof REQUIRED_AUTH_ENV)[number], string | undefined> = {
    GOOGLE_ADS_DEVELOPER_TOKEN: config.developerToken,
    GOOGLE_ADS_CLIENT_ID: config.clientId,
    GOOGLE_ADS_CLIENT_SECRET: config.clientSecret,
    GOOGLE_ADS_REFRESH_TOKEN: config.refreshToken
  };
  const missing = REQUIRED_AUTH_ENV.filter((name) => !values[name]);

  return {
    provider: 'google_ads',
    configured: missing.length === 0,
    mode: config.mockMode ? 'mock' : missing.length === 0 ? 'real' : 'unconfigured',
    apiVersion: config.apiVersion,
    customerIdConfigured: Boolean(config.customerId),
    loginCustomerIdConfigured: Boolean(config.loginCustomerId),
    missing
  };
}

type StoredGoogleAdsConnection = {
  encrypted_refresh_token: string;
  selected_customer_id?: string;
  login_customer_id?: string;
  status: string;
};

export async function getGoogleAdsConfigForUser(userId: string): Promise<GoogleAdsConfig> {
  const connection = await selectOne<StoredGoogleAdsConnection>('google_ads_connections', {
    user_id: userId,
    status: 'active'
  });
  if (!connection) {
    throw new Error('No active Google Ads connection exists for this user. Reconnect the MCP connector.');
  }
  const base = getGoogleAdsConfig();
  return {
    ...base,
    refreshToken: decryptSecret(connection.encrypted_refresh_token),
    customerId: connection.selected_customer_id,
    loginCustomerId: connection.login_customer_id,
    mockMode: false
  };
}

export async function getGoogleAdsConnectionStatusForUser(userId: string) {
  const connection = await selectOne<StoredGoogleAdsConnection>('google_ads_connections', { user_id: userId });
  if (!connection) {
    const base = getGoogleAdsConnectionStatus({ ...getGoogleAdsConfig(), refreshToken: undefined, mockMode: false });
    return { ...base, connected: false, mode: 'unconfigured' };
  }
  const config: GoogleAdsConfig = {
    ...getGoogleAdsConfig(),
    refreshToken: 'stored',
    customerId: connection.selected_customer_id,
    loginCustomerId: connection.login_customer_id,
    mockMode: false
  };
  return {
    ...getGoogleAdsConnectionStatus(config),
    connected: connection.status === 'active',
    connectionStatus: connection.status
  };
}

export async function disconnectGoogleAdsForUser(userId: string) {
  const connection = await selectOne<StoredGoogleAdsConnection>('google_ads_connections', { user_id: userId });
  if (!connection) {
    return { disconnected: true, alreadyDisconnected: true };
  }
  let googleRevocationAccepted = false;
  try {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: decryptSecret(connection.encrypted_refresh_token) }).toString()
    });
    googleRevocationAccepted = response.ok;
  } finally {
    await updateRows('google_ads_connections', { user_id: userId }, {
      status: 'revoked',
      updated_at: new Date().toISOString()
    });
  }
  return { disconnected: true, googleRevocationAccepted };
}

export async function listGoogleAdsAccounts(config: GoogleAdsConfig): Promise<GoogleAdsAccount[]> {
  if (config.mockMode) {
    return mockAccounts;
  }

  assertGoogleAdsConfigured(config);

  const token = await getAccessToken(config);
  const response = await fetch(`${getApiBaseUrl(config)}/customers:listAccessibleCustomers`, {
    method: 'GET',
    headers: buildGoogleAdsHeaders(config, token, false)
  });

  if (!response.ok) {
    throw await createGoogleAdsError(response, 'Google Ads account discovery failed');
  }

  const data = (await response.json()) as { resourceNames?: string[] };
  const accessibleIds = (data.resourceNames ?? [])
    .map((resourceName) => normalizeCustomerId(resourceName.replace('customers/', '')))
    .filter(Boolean);

  const discoveryRoots = config.loginCustomerId
    ? [normalizeCustomerId(config.loginCustomerId)]
    : accessibleIds;
  const discoveredAccounts: GoogleAdsAccount[] = [];
  for (const managerId of discoveryRoots) {
    const query = [
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.status,',
      'customer_client.manager, customer_client.level',
      'FROM customer_client',
      'WHERE customer_client.level <= 1',
      'ORDER BY customer_client.level, customer_client.id'
    ].join(' ');
    try {
      const chunks = await searchGoogleAds({ ...config, loginCustomerId: managerId }, token, managerId, query);
      discoveredAccounts.push(...flattenSearchResults(chunks)
        .map((result) => result.customerClient)
        .filter((account): account is Record<string, unknown> => Boolean(account && typeof account === 'object'))
        .map((account) => ({
          account_id: normalizeCustomerId(String(account.id ?? '')),
          name: String(account.descriptiveName ?? account.id ?? 'Unnamed account'),
          status: String(account.status ?? 'UNKNOWN'),
          manager: Boolean(account.manager),
          level: Number(account.level ?? 0),
          login_customer_id: managerId
        }))
        .filter((account) => Boolean(account.account_id)));
    } catch (error) {
      console.warn(`Unable to enumerate customer clients through ${managerId}`, error);
    }
  }

  if (discoveredAccounts.length > 0) {
    return Array.from(new Map(discoveredAccounts.map((account) => [account.account_id, account])).values());
  }

  return accessibleIds.map((accountId) => ({
    account_id: accountId,
    name: `Google Ads account ${accountId}`,
    status: 'ACCESSIBLE'
  }));
}

export async function saveGoogleAdsAccountsForUser(userId: string, accounts: GoogleAdsAccount[]) {
  const connection = await selectOne<{ id: string; login_customer_id?: string }>('google_ads_connections', {
    user_id: userId
  });
  if (!connection) {
    throw new Error('Google Ads connection was not found for this user.');
  }
  for (const account of accounts) {
    await upsertRow('google_ads_accounts', {
      connection_id: connection.id,
      customer_id: account.account_id,
      descriptive_name: account.name,
      status: account.status,
      manager: account.manager ?? false,
      level: account.level,
      updated_at: new Date().toISOString()
    }, 'connection_id,customer_id');
  }
  if (!connection.login_customer_id) {
    const manager = accounts.find((account) => account.manager && account.level === 0)
      ?? accounts.find((account) => account.login_customer_id);
    if (manager?.login_customer_id) {
      await updateRows('google_ads_connections', { user_id: userId }, {
        login_customer_id: manager.login_customer_id,
        updated_at: new Date().toISOString()
      });
    }
  }
}

export async function queryGoogleAds(config: GoogleAdsConfig, input: {
  accounts: string[];
  fields: string[];
  dateRange: { start: string; end: string };
  filters?: string[];
}) {
  if (config.mockMode) {
    return {
      ...mockQueryResult,
      mode: 'mock',
      warning: 'Google Ads credentials are not configured. Returning mock data.'
    };
  }

  assertGoogleAdsConfigured(config);

  const token = await getAccessToken(config);
  const query = buildGoogleAdsQuery(input.fields, input.dateRange, input.filters);
  const accountIds = (input.accounts.length > 0 ? input.accounts : [config.customerId ?? ''])
    .map(normalizeCustomerId)
    .filter(Boolean);

  if (accountIds.length === 0) {
    throw new Error('Provide at least one Google Ads account ID or configure GOOGLE_ADS_CUSTOMER_ID.');
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const customerId of accountIds) {
    const chunks = await searchGoogleAds(config, token, customerId, query);
    rows.push(...flattenSearchResults(chunks).map((result) => ({
      account_id: customerId,
      ...normalizeGoogleAdsResult(result, input.fields)
    })));
  }

  return {
    source: 'AW',
    mode: 'real',
    rows,
    summary: {
      accountsQueried: accountIds.length,
      rowCount: rows.length
    },
    requested: {
      source: 'AW',
      accounts: accountIds,
      fields: input.fields,
      dateRange: input.dateRange,
      filters: input.filters ?? []
    }
  };
}

function normalizeGoogleAdsResult(result: Record<string, unknown>, requestedFields: string[]) {
  const normalized: Record<string, unknown> = {};

  for (const fieldName of requestedFields) {
    const field = FIELD_MAP[fieldName];
    if (!field) {
      normalized[fieldName] = null;
      continue;
    }

    const value = extractValueFromResult(result, field.responsePath);
    if ('micros' in field && field.micros && (typeof value === 'number' || typeof value === 'string')) {
      normalized[fieldName] = Number((Number(value) / 1_000_000).toFixed(2));
    } else {
      normalized[fieldName] = value;
    }
  }

  return normalized;
}

function extractValueFromResult(result: Record<string, unknown>, fieldPath: string) {
  const path = fieldPath.split('.');
  let current: unknown = result;

  for (const segment of path) {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return null;
    }
  }

  return current;
}

function buildGoogleAdsQuery(fields: string[], dateRange: { start: string; end: string }, filters?: string[]) {
  const unknownFields = fields.filter((field) => !FIELD_MAP[field]);
  if (unknownFields.length > 0) {
    throw new Error(`Unsupported Google Ads fields: ${unknownFields.join(', ')}`);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRange.start) || !/^\d{4}-\d{2}-\d{2}$/.test(dateRange.end)) {
    throw new Error('Google Ads date range must use YYYY-MM-DD.');
  }

  const selectClause = fields.map((field) => FIELD_MAP[field].googleAdsField).join(', ');
  const conditions = [`segments.date BETWEEN '${dateRange.start}' AND '${dateRange.end}'`];

  const filterConditions = (filters ?? [])
    .map((filter) => {
      const match = filter.match(/^([a-zA-Z0-9_.]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
      if (!match) {
        throw new Error(`Invalid Google Ads filter: ${filter}`);
      }
      const [, fieldName, operator, value] = match;
      const mappedField = FIELD_MAP[fieldName];
      if (!mappedField) {
        throw new Error(`Unsupported Google Ads filter field: ${fieldName}`);
      }
      return `${mappedField.googleAdsField} ${operator} ${normalizeFilterValue(value)}`;
    });

  conditions.push(...filterConditions);
  return `SELECT ${selectClause} FROM campaign WHERE ${conditions.join(' AND ')}`;
}

function normalizeFilterValue(rawValue: string) {
  const value = rawValue.trim();
  if (/^-?\d+(\.\d+)?$/.test(value) || /^(TRUE|FALSE|NULL)$/i.test(value) || /^'[^']*'$/.test(value)) {
    return value;
  }
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function normalizeCustomerId(customerId: string) {
  return customerId.replace(/[^0-9]/g, '');
}

function getApiBaseUrl(config: GoogleAdsConfig) {
  return `https://googleads.googleapis.com/${config.apiVersion}`;
}

function buildGoogleAdsHeaders(config: GoogleAdsConfig, accessToken: string, includeLoginCustomer = true) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': config.developerToken ?? '',
    'Content-Type': 'application/json'
  };
  if (includeLoginCustomer && config.loginCustomerId) {
    headers['login-customer-id'] = normalizeCustomerId(config.loginCustomerId);
  }
  return headers;
}

async function searchGoogleAds(
  config: GoogleAdsConfig,
  token: string,
  customerId: string,
  query: string
): Promise<Array<{ results?: Array<Record<string, unknown>> }>> {
  const response = await fetch(`${getApiBaseUrl(config)}/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: buildGoogleAdsHeaders(config, token),
    body: JSON.stringify({ query })
  });
  if (!response.ok) {
    throw await createGoogleAdsError(response, `Google Ads query failed for customer ${customerId}`);
  }
  const payload = await response.json() as unknown;
  return Array.isArray(payload) ? payload : [payload as { results?: Array<Record<string, unknown>> }];
}

function flattenSearchResults(chunks: Array<{ results?: Array<Record<string, unknown>> }>) {
  return chunks.flatMap((chunk) => chunk.results ?? []);
}

function assertGoogleAdsConfigured(config: GoogleAdsConfig) {
  if (!hasGoogleAdsConfig(config)) {
    const status = getGoogleAdsConnectionStatus(config);
    throw new Error(`Google Ads is not configured. Missing: ${status.missing.join(', ')}`);
  }
}

async function createGoogleAdsError(response: Response, prefix: string) {
  const requestId = response.headers.get('request-id');
  const body = (await response.text()).slice(0, 1500);
  return new Error(`${prefix}: ${response.status} ${response.statusText}${requestId ? ` (request-id: ${requestId})` : ''}${body ? ` - ${body}` : ''}`);
}

async function getAccessToken(config: GoogleAdsConfig): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: config.clientId ?? '',
      client_secret: config.clientSecret ?? '',
      refresh_token: config.refreshToken ?? '',
      grant_type: 'refresh_token'
    }).toString()
  });

  if (!response.ok) {
    throw new Error(`Unable to refresh Google OAuth token: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Google OAuth token response did not include an access token.');
  }

  return data.access_token;
}

export function getFieldCatalog(search?: string) {
  const term = (search ?? '').toLowerCase();
  return FIELD_CATALOG.filter((field) => {
    if (!term) {
      return true;
    }
    return field.name.toLowerCase().includes(term) || field.description.toLowerCase().includes(term);
  });
}
