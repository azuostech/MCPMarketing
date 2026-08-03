declare const process: { env: Record<string, string | undefined> };

import { mockAccounts, mockQueryResult } from './mockData.js';

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
  const missing = REQUIRED_AUTH_ENV.filter((name) => !getEnvValue(name));

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

  if (config.loginCustomerId) {
    const managerId = normalizeCustomerId(config.loginCustomerId);
    const query = [
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.status,',
      'customer_client.manager, customer_client.level',
      'FROM customer_client',
      'WHERE customer_client.level <= 1',
      'ORDER BY customer_client.level, customer_client.id'
    ].join(' ');
    const chunks = await searchGoogleAds(config, token, managerId, query);
    const accounts = flattenSearchResults(chunks)
      .map((result) => result.customerClient)
      .filter((account): account is Record<string, unknown> => Boolean(account && typeof account === 'object'))
      .map((account) => ({
        account_id: normalizeCustomerId(String(account.id ?? '')),
        name: String(account.descriptiveName ?? account.id ?? 'Unnamed account'),
        status: String(account.status ?? 'UNKNOWN'),
        manager: Boolean(account.manager),
        level: Number(account.level ?? 0)
      }))
      .filter((account) => Boolean(account.account_id));

    if (accounts.length > 0) {
      return accounts;
    }
  }

  return accessibleIds.map((accountId) => ({
    account_id: accountId,
    name: `Google Ads account ${accountId}`,
    status: 'ACCESSIBLE'
  }));
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
