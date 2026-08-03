export const mockDataSources = [
  {
    id: 'AW',
    name: 'Google Ads',
    description: 'Google Ads marketing data source',
    requiredConfig: ['developer_token', 'client_id', 'client_secret', 'refresh_token', 'customer_id'],
    supportsAccountDiscovery: true,
    supportsFieldDiscovery: true,
    supportsQuerying: true
  }
];

export const mockAccounts = [
  {
    account_id: '1234567890',
    name: 'Northwind Labs',
    status: 'ENABLED'
  },
  {
    account_id: '0987654321',
    name: 'Contoso Media',
    status: 'PAUSED'
  }
];

export const mockFields = [
  { name: 'date', type: 'dimension', description: 'Date of the record' },
  { name: 'campaign_name', type: 'dimension', description: 'Campaign name' },
  { name: 'clicks', type: 'metric', description: 'Total clicks' },
  { name: 'impressions', type: 'metric', description: 'Total impressions' },
  { name: 'cost', type: 'metric', description: 'Spend' }
];

export const mockQueryResult = {
  source: 'AW',
  rows: [
    {
      date: '2026-07-01',
      campaign_name: 'Summer Campaign',
      clicks: 120,
      impressions: 5400,
      cost: 180.5
    }
  ],
  summary: {
    accountsQueried: 1,
    rowCount: 1
  }
};
