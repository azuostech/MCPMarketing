import assert from 'node:assert/strict';
import test from 'node:test';

process.env.VERCEL = '1';
process.env.MCP_AUTH_REQUIRED = 'false';

test('publishes the complete Marketing Analytics tool catalog', async () => {
  const { app, tools } = await import('../dist/httpServer.js');

  assert.equal(app.get('trust proxy'), 1);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    [
      'google_ads_connection_status',
      'google_ads_reconnect',
      'google_ads_disconnect',
      'data_source_discovery',
      'accounts_discovery',
      'field_discovery',
      'data_query',
      'get_query_results',
      'health_check'
    ]
  );
  for (const tool of tools) {
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});
