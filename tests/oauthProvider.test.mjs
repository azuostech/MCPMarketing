import assert from 'node:assert/strict';
import test from 'node:test';

process.env.SUPABASE_URL = 'https://database.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.GOOGLE_ADS_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_ADS_CLIENT_SECRET = 'google-client-secret';
process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'developer-token';

const tables = new Map();
let sequence = 0;

function table(name) {
  if (!tables.has(name)) tables.set(name, []);
  return tables.get(name);
}

function matches(row, searchParams) {
  for (const [key, filter] of searchParams.entries()) {
    if (key === 'select' || key === 'on_conflict') continue;
    if (filter === 'is.null') {
      if (row[key] !== null && row[key] !== undefined) return false;
      continue;
    }
    const expected = filter.startsWith('eq.') ? filter.slice(3) : filter;
    if (String(row[key]) !== expected) return false;
  }
  return true;
}

function withDefaults(name, row) {
  const result = { ...row };
  if ((name === 'marketing_users' || name === 'google_ads_connections') && !result.id) {
    result.id = `${name}-${++sequence}`;
  }
  return result;
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === 'oauth2.googleapis.com') {
    const code = new URLSearchParams(init.body).get('code');
    return Response.json({
      access_token: `google-access-${code}`,
      refresh_token: `google-refresh-${code}`,
      scope: 'openid email profile https://www.googleapis.com/auth/adwords'
    });
  }
  if (url.hostname === 'openidconnect.googleapis.com') {
    const secondUser = init.headers.Authorization.endsWith('google-code-2');
    return Response.json(secondUser
      ? { sub: 'google-user-456', email: 'second@example.com', name: 'Second User' }
      : { sub: 'google-user-123', email: 'user@example.com', name: 'Test User' });
  }
  if (url.hostname !== 'database.example.test') {
    throw new Error(`Unexpected request: ${url}`);
  }

  const name = url.pathname.split('/').pop();
  const rows = table(name);
  const method = init.method ?? 'GET';
  if (method === 'GET') {
    return Response.json(rows.filter((row) => matches(row, url.searchParams)));
  }
  if (method === 'POST') {
    const values = JSON.parse(init.body);
    const incoming = Array.isArray(values) ? values : [values];
    const conflictKey = url.searchParams.get('on_conflict');
    const saved = incoming.map((value) => {
      if (conflictKey) {
        const existing = rows.find((row) => row[conflictKey] === value[conflictKey]);
        if (existing) {
          Object.assign(existing, value);
          return existing;
        }
      }
      const created = withDefaults(name, value);
      rows.push(created);
      return created;
    });
    return Response.json(saved, { status: 201 });
  }
  if (method === 'PATCH') {
    const updates = JSON.parse(init.body);
    const updated = rows.filter((row) => matches(row, url.searchParams));
    updated.forEach((row) => Object.assign(row, updates));
    return Response.json(updated);
  }
  if (method === 'DELETE') {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (matches(rows[index], url.searchParams)) rows.splice(index, 1);
    }
    return new Response(null, { status: 204 });
  }
  throw new Error(`Unexpected method: ${method}`);
};

test('completes MCP OAuth through Google and isolates a user connection', async () => {
  const { MarketingOAuthProvider } = await import('../dist/auth/provider.js');
  const { getGoogleAdsConfigForUser } = await import('../dist/lib/googleAds.js');
  const provider = new MarketingOAuthProvider(new URL('https://mcp.example.com/'));
  const client = {
    client_id: 'claude-client',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: ['https://claude.example.com/oauth/callback'],
    token_endpoint_auth_method: 'none'
  };
  await provider.clientsStore.registerClient(client);

  let googleRedirect;
  await provider.authorize(client, {
    state: 'claude-state',
    scopes: ['mcp:tools'],
    codeChallenge: 'pkce-challenge',
    redirectUri: client.redirect_uris[0],
    resource: new URL('https://mcp.example.com/mcp')
  }, {
    redirect(_status, location) { googleRedirect = location; }
  });
  assert.ok(googleRedirect?.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
  const googleState = new URL(googleRedirect).searchParams.get('state');
  assert.ok(googleState);

  const clientRedirect = await provider.handleGoogleCallback({ state: googleState, code: 'google-code' });
  assert.equal(clientRedirect.origin, 'https://claude.example.com');
  assert.equal(clientRedirect.searchParams.get('state'), 'claude-state');
  const authorizationCode = clientRedirect.searchParams.get('code');
  assert.ok(authorizationCode);
  assert.equal(await provider.challengeForAuthorizationCode(client, authorizationCode), 'pkce-challenge');

  const tokens = await provider.exchangeAuthorizationCode(
    client,
    authorizationCode,
    undefined,
    client.redirect_uris[0],
    new URL('https://mcp.example.com/mcp')
  );
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);
  const authInfo = await provider.verifyAccessToken(tokens.access_token);
  assert.equal(authInfo.clientId, client.client_id);
  assert.equal(authInfo.resource?.href, 'https://mcp.example.com/mcp');
  assert.equal(typeof authInfo.extra?.userId, 'string');

  const googleConfig = await getGoogleAdsConfigForUser(authInfo.extra.userId);
  assert.equal(googleConfig.refreshToken, 'google-refresh-google-code');
  assert.equal(googleConfig.developerToken, 'developer-token');
  assert.notEqual(table('google_ads_connections')[0].encrypted_refresh_token, googleConfig.refreshToken);

  const reconnectUrl = await provider.createGoogleAdsReconnectUrl(client.client_id, authInfo.extra.userId);
  assert.equal(reconnectUrl.origin, 'https://accounts.google.com');
  assert.match(reconnectUrl.searchParams.get('scope'), /googleapis\.com\/auth\/adwords/);
  const reconnectRedirect = await provider.handleGoogleCallback({
    state: reconnectUrl.searchParams.get('state'),
    code: 'google-reconnect-code'
  });
  assert.equal(reconnectRedirect.href, 'https://mcp.example.com/oauth/google/complete');
  const reconnectedGoogleConfig = await getGoogleAdsConfigForUser(authInfo.extra.userId);
  assert.equal(reconnectedGoogleConfig.refreshToken, 'google-refresh-google-reconnect-code');
  assert.equal(table('google_ads_connections')[0].status, 'active');

  await assert.rejects(
    provider.exchangeAuthorizationCode(client, authorizationCode),
    /Invalid or expired authorization code/
  );

  let secondGoogleRedirect;
  await provider.authorize(client, {
    state: 'second-claude-state',
    scopes: ['mcp:tools'],
    codeChallenge: 'second-pkce-challenge',
    redirectUri: client.redirect_uris[0],
    resource: new URL('https://mcp.example.com/mcp')
  }, {
    redirect(_status, location) { secondGoogleRedirect = location; }
  });
  const secondGoogleState = new URL(secondGoogleRedirect).searchParams.get('state');
  const secondClientRedirect = await provider.handleGoogleCallback({
    state: secondGoogleState,
    code: 'google-code-2'
  });
  const secondAuthorizationCode = secondClientRedirect.searchParams.get('code');
  const secondTokens = await provider.exchangeAuthorizationCode(
    client,
    secondAuthorizationCode,
    undefined,
    client.redirect_uris[0],
    new URL('https://mcp.example.com/mcp')
  );
  const secondAuthInfo = await provider.verifyAccessToken(secondTokens.access_token);
  assert.notEqual(secondAuthInfo.extra.userId, authInfo.extra.userId);
  const secondGoogleConfig = await getGoogleAdsConfigForUser(secondAuthInfo.extra.userId);
  assert.equal(secondGoogleConfig.refreshToken, 'google-refresh-google-code-2');
  assert.equal(googleConfig.refreshToken, 'google-refresh-google-code');
});
