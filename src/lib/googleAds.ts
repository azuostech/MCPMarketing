declare const process: { env: Record<string, string | undefined> };

import { mockAccounts, mockQueryResult } from './mockData.js';

export type GoogleAdsConfig = {
  developerToken?: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  customerId?: string;
  loginCustomerId?: string;
};

export type GoogleAdsAccount = {
  account_id: string;
  name: string;
  status: string;
};

const FIELD_CATALOG = [
  { name: 'date', type: 'dimension', description: 'Date of the record', googleAdsField: 'segments.date' },
  { name: 'campaign_name', type: 'dimension', description: 'Campaign name', googleAdsField: 'campaign.name' },
  { name: 'campaign_id', type: 'dimension', description: 'Campaign identifier', googleAdsField: 'campaign.id' },
  { name: 'clicks', type: 'metric', description: 'Total clicks', googleAdsField: 'metrics.clicks' },
  { name: 'impressions', type: 'metric', description: 'Total impressions', googleAdsField: 'metrics.impressions' },
  { name: 'cost', type: 'metric', description: 'Spend in USD', googleAdsField: 'metrics.cost_micros' }
];

const FIELD_MAP: Record<string, string> = Object.fromEntries(
  FIELD_CATALOG.map((field) => [field.name, field.googleAdsField])
);

function getEnvValue(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function getGoogleAdsConfig(): GoogleAdsConfig {
  return {
    developerToken: getEnvValue('GOOGLE_ADS_DEVELOPER_TOKEN'),
    clientId: getEnvValue('GOOGLE_ADS_CLIENT_ID'),
    clientSecret: getEnvValue('GOOGLE_ADS_CLIENT_SECRET'),
    refreshToken: getEnvValue('GOOGLE_ADS_REFRESH_TOKEN'),
    customerId: getEnvValue('GOOGLE_ADS_CUSTOMER_ID'),
    loginCustomerId: getEnvValue('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
  };
}

export function hasGoogleAdsConfig(config: GoogleAdsConfig): boolean {
  return Boolean(
    config.developerToken &&
      config.clientId &&
      config.clientSecret &&
      config.refreshToken &&
      config.customerId
  );
}

export async function listGoogleAdsAccounts(config: GoogleAdsConfig): Promise<GoogleAdsAccount[]> {
  if (!hasGoogleAdsConfig(config)) {
    return mockAccounts;
  }

  const token = await getAccessToken(config);
  const response = await fetch('https://googleads.googleapis.com/v18/customers:listAccessibleCustomers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': config.developerToken ?? '',
      'Content-Type': 'application/json'
    },
    body: '{}'
  });

  if (!response.ok) {
    throw new Error(`Google Ads account discovery failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    resourceNames?: string[];
    customerClientLinks?: Array<{ customerClient?: { customerId?: string; descriptiveName?: string; status?: string } }>;
  };

  if (Array.isArray(data.customerClientLinks)) {
    return data.customerClientLinks
      .map((item) => item.customerClient)
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((account) => ({
        account_id: account.customerId ?? 'unknown',
        name: account.descriptiveName ?? 'Unnamed account',
        status: account.status ?? 'UNKNOWN'
      }));
  }

  return mockAccounts;
}

export async function queryGoogleAds(config: GoogleAdsConfig, input: {
  accounts: string[];
  fields: string[];
  dateRange: { start: string; end: string };
  filters?: string[];
}) {
  if (!hasGoogleAdsConfig(config)) {
    return {
      ...mockQueryResult,
      mode: 'mock',
      warning: 'Google Ads credentials are not configured. Returning mock data.'
    };
  }

  const token = await getAccessToken(config);
  const customerId = input.accounts[0] ?? config.customerId;
  const query = buildGoogleAdsQuery(input.fields, input.dateRange, input.filters);

  const response = await fetch(`https://googleads.googleapis.com/v18/customers/${customerId}/googleAds:searchStream`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'developer-token': config.developerToken ?? '',
      'login-customer-id': config.loginCustomerId ?? config.customerId ?? '',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`Google Ads query failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results?: Array<Record<string, unknown>>;
  };

  const rows = (data.results ?? []).map((result) => normalizeGoogleAdsResult(result, input.fields));

  return {
    source: 'AW',
    mode: 'real',
    rows,
    summary: {
      accountsQueried: input.accounts.length,
      rowCount: rows.length
    },
    requested: {
      source: 'AW',
      accounts: input.accounts,
      fields: input.fields,
      dateRange: input.dateRange,
      filters: input.filters ?? []
    }
  };
}

function normalizeGoogleAdsResult(result: Record<string, unknown>, requestedFields: string[]) {
  const normalized: Record<string, unknown> = {};

  for (const fieldName of requestedFields) {
    const googleAdsField = FIELD_MAP[fieldName];
    if (!googleAdsField) {
      normalized[fieldName] = null;
      continue;
    }

    const value = extractValueFromResult(result, googleAdsField);
    if (typeof value === 'number' && googleAdsField === 'metrics.cost_micros') {
      normalized[fieldName] = Number((value / 1_000_000).toFixed(2));
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
  const selectClause = fields.map((field) => FIELD_MAP[field] ?? field).join(', ');
  const baseQuery = `SELECT ${selectClause} FROM campaign DURING ${dateRange.start},${dateRange.end}`;

  if (!filters?.length) {
    return baseQuery;
  }

  const whereClause = filters
    .map((filter) => {
      const match = filter.match(/^([a-zA-Z0-9_.]+)\s*(>=|<=|>|<|=|!=)\s*(.+)$/);
      if (!match) {
        return null;
      }
      const [, fieldName, operator, value] = match;
      const mappedField = FIELD_MAP[fieldName] ?? fieldName;
      return `${mappedField} ${operator} ${value}`;
    })
    .filter(Boolean)
    .join(' AND ');

  return whereClause ? `${baseQuery} WHERE ${whereClause}` : baseQuery;
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
