export function getServerHealth() {
  return {
    status: 'ok',
    name: 'mcp-marketing-analytics',
    version: '0.1.0',
    capabilities: ['data_source_discovery', 'accounts_discovery', 'field_discovery', 'data_query', 'get_query_results']
  };
}
