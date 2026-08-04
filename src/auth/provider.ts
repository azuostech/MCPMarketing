import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens
} from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  deleteRows,
  insertRow,
  selectOne,
  updateRows,
  updateRowsWhere,
  upsertRow
} from './database.js';
import {
  assertEncryptionConfigured,
  createOpaqueToken,
  decryptSecret,
  encryptSecret,
  hashOpaqueToken
} from './crypto.js';

declare const process: { env: Record<string, string | undefined> };

const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords';
const MCP_SCOPE = 'mcp:tools';
const GOOGLE_RECONNECT_STATE_PREFIX = 'google-ads-reconnect:';
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OAuthClientRow = {
  client_id: string;
  encrypted_client_data: string;
};

type PendingAuthorizationRow = {
  state_hash: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  mcp_state?: string;
  scopes: string[];
  resource?: string;
  expires_at: string;
};

type AuthorizationCodeRow = {
  code_hash: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string[];
  resource?: string;
  expires_at: string;
  used_at?: string;
};

type TokenRow = {
  token_hash: string;
  token_type: 'access' | 'refresh';
  client_id: string;
  user_id: string;
  scopes: string[];
  resource?: string;
  expires_at?: string;
  revoked_at?: string;
};

type MarketingUserRow = {
  id: string;
  google_subject: string;
  email: string;
  display_name?: string;
};

type GoogleConnectionRow = {
  id: string;
  user_id: string;
  encrypted_refresh_token: string;
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function isExpired(value?: string) {
  return !value || new Date(value).getTime() <= Date.now();
}

function ensureRequestedScopes(scopes: string[]) {
  if (scopes.some((scope) => scope !== MCP_SCOPE)) {
    throw new InvalidRequestError('Unsupported scope requested.');
  }
  return scopes.length > 0 ? scopes : [MCP_SCOPE];
}

export class SupabaseOAuthClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string) {
    const row = await selectOne<OAuthClientRow>('mcp_oauth_clients', { client_id: clientId });
    if (!row) {
      return undefined;
    }
    return JSON.parse(decryptSecret(row.encrypted_client_data)) as OAuthClientInformationFull;
  }

  async registerClient(client: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>) {
    const registered = client as OAuthClientInformationFull;
    if (!registered.client_id) {
      throw new InvalidRequestError('OAuth client ID was not generated.');
    }
    await insertRow<OAuthClientRow>('mcp_oauth_clients', {
      client_id: registered.client_id,
      encrypted_client_data: encryptSecret(JSON.stringify(registered))
    });
    return registered;
  }
}

export class MarketingOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new SupabaseOAuthClientsStore();

  constructor(private readonly baseUrl: URL) {
    [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_ADS_DEVELOPER_TOKEN',
      'GOOGLE_ADS_CLIENT_ID',
      'GOOGLE_ADS_CLIENT_SECRET'
    ].forEach(requiredEnv);
    assertEncryptionConfigured();
  }

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: any) {
    const scopes = ensureRequestedScopes(params.scopes ?? []);
    const resource = params.resource ?? this.mcpResourceUrl;
    this.validateResource(resource);

    const googleState = createOpaqueToken();
    await insertRow<PendingAuthorizationRow>('mcp_oauth_pending', {
      state_hash: hashOpaqueToken(googleState),
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      mcp_state: params.state,
      scopes,
      resource: resource.href,
      expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString()
    });

    res.redirect(302, this.buildGoogleAuthorizationUrl(googleState).href);
  }

  async createGoogleAdsReconnectUrl(clientId: string, userId: string) {
    const [client, user] = await Promise.all([
      this.clientsStore.getClient(clientId),
      selectOne<MarketingUserRow>('marketing_users', { id: userId })
    ]);
    if (!client || !user) {
      throw new InvalidRequestError('The authenticated MCP connection could not be found.');
    }

    const googleState = createOpaqueToken();
    await insertRow<PendingAuthorizationRow>('mcp_oauth_pending', {
      state_hash: hashOpaqueToken(googleState),
      client_id: clientId,
      redirect_uri: this.googleReconnectCompleteUrl.href,
      code_challenge: 'google-ads-reconnect',
      mcp_state: `${GOOGLE_RECONNECT_STATE_PREFIX}${userId}`,
      scopes: [MCP_SCOPE],
      resource: this.mcpResourceUrl.href,
      expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString()
    });
    return this.buildGoogleAuthorizationUrl(googleState);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string) {
    const code = await this.getAuthorizationCode(client, authorizationCode);
    return code.code_challenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL
  ): Promise<OAuthTokens> {
    const code = await this.getAuthorizationCode(client, authorizationCode);
    if (redirectUri && redirectUri !== code.redirect_uri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request.');
    }
    if (resource && resource.href !== code.resource) {
      throw new InvalidGrantError('resource does not match the authorization request.');
    }
    const consumed = await updateRowsWhere<AuthorizationCodeRow>('mcp_oauth_codes', {
      code_hash: `eq.${code.code_hash}`,
      used_at: 'is.null'
    }, { used_at: new Date().toISOString() });
    if (consumed.length !== 1) {
      throw new InvalidGrantError('Authorization code has already been used.');
    }
    return this.issueTokenPair(code.client_id, code.user_id, code.scopes, code.resource);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL
  ): Promise<OAuthTokens> {
    const hash = hashOpaqueToken(refreshToken);
    const token = await selectOne<TokenRow>('mcp_oauth_tokens', { token_hash: hash, token_type: 'refresh' });
    if (!token || token.client_id !== client.client_id || token.revoked_at || isExpired(token.expires_at)) {
      throw new InvalidGrantError('Invalid or expired refresh token.');
    }
    if (resource && resource.href !== token.resource) {
      throw new InvalidGrantError('resource does not match the refresh token.');
    }
    const requestedScopes = scopes ?? token.scopes;
    if (requestedScopes.some((scope) => !token.scopes.includes(scope))) {
      throw new InvalidGrantError('Requested scope exceeds the original grant.');
    }
    const rotated = await updateRowsWhere<TokenRow>('mcp_oauth_tokens', {
      token_hash: `eq.${hash}`,
      revoked_at: 'is.null'
    }, { revoked_at: new Date().toISOString() });
    if (rotated.length !== 1) {
      throw new InvalidGrantError('Refresh token has already been used.');
    }
    return this.issueTokenPair(token.client_id, token.user_id, requestedScopes, token.resource);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await selectOne<TokenRow>('mcp_oauth_tokens', {
      token_hash: hashOpaqueToken(token),
      token_type: 'access'
    });
    if (!row || row.revoked_at || isExpired(row.expires_at)) {
      throw new InvalidTokenError('Invalid or expired access token.');
    }
    this.validateResource(row.resource ? new URL(row.resource) : undefined);
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      expiresAt: row.expires_at ? Math.floor(new Date(row.expires_at).getTime() / 1000) : undefined,
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { userId: row.user_id }
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest) {
    const hash = hashOpaqueToken(request.token);
    const token = await selectOne<TokenRow>('mcp_oauth_tokens', { token_hash: hash });
    if (token?.client_id === client.client_id && !token.revoked_at) {
      await updateRows('mcp_oauth_tokens', { token_hash: hash }, { revoked_at: new Date().toISOString() });
    }
  }

  async handleGoogleCallback(query: Record<string, unknown>) {
    const state = typeof query.state === 'string' ? query.state : undefined;
    if (!state) {
      throw new InvalidRequestError('Missing Google OAuth state.');
    }
    const pending = await selectOne<PendingAuthorizationRow>('mcp_oauth_pending', {
      state_hash: hashOpaqueToken(state)
    });
    if (!pending || isExpired(pending.expires_at)) {
      throw new InvalidRequestError('Google OAuth state is invalid or expired.');
    }
    await deleteRows('mcp_oauth_pending', { state_hash: pending.state_hash });

    if (typeof query.error === 'string') {
      return this.createClientErrorRedirect(pending, query.error);
    }
    if (typeof query.code !== 'string') {
      return this.createClientErrorRedirect(pending, 'invalid_request');
    }

    const isReconnect = pending.redirect_uri === this.googleReconnectCompleteUrl.href
      && pending.mcp_state?.startsWith(GOOGLE_RECONNECT_STATE_PREFIX);
    const reconnectUserId = isReconnect
      ? pending.mcp_state?.slice(GOOGLE_RECONNECT_STATE_PREFIX.length)
      : undefined;
    const googleTokens = await this.exchangeGoogleCode(query.code);
    const grantedScopes = await this.getGoogleGrantedScopes(googleTokens.access_token, googleTokens.scope);
    if (!grantedScopes.includes(GOOGLE_ADS_SCOPE)) {
      throw new InvalidRequestError('Google did not grant the required Google Ads scope.');
    }
    const profile = await this.getGoogleProfile(googleTokens.access_token);
    const user = reconnectUserId
      ? await selectOne<MarketingUserRow>('marketing_users', { id: reconnectUserId })
      : await upsertRow<MarketingUserRow>('marketing_users', {
          google_subject: profile.sub,
          email: profile.email,
          display_name: profile.name,
          updated_at: new Date().toISOString()
        }, 'google_subject');
    if (!user || user.google_subject !== profile.sub) {
      throw new InvalidRequestError('Authorize the same Google account previously connected to this MCP user.');
    }

    const existingConnection = await selectOne<GoogleConnectionRow>('google_ads_connections', { user_id: user.id });
    if (isReconnect && !googleTokens.refresh_token) {
      throw new InvalidRequestError('Google did not return a new refresh token. Remove the app grant and try again.');
    }
    const encryptedRefreshToken = googleTokens.refresh_token
      ? encryptSecret(googleTokens.refresh_token)
      : existingConnection?.encrypted_refresh_token;
    if (!encryptedRefreshToken) {
      throw new InvalidRequestError('Google did not return a refresh token. Revoke the app grant and authorize again.');
    }
    await upsertRow<GoogleConnectionRow>('google_ads_connections', {
      user_id: user.id,
      encrypted_refresh_token: encryptedRefreshToken,
      scopes: grantedScopes,
      status: 'active',
      updated_at: new Date().toISOString()
    }, 'user_id');

    if (isReconnect) {
      return this.googleReconnectCompleteUrl;
    }

    const authorizationCode = createOpaqueToken();
    await insertRow<AuthorizationCodeRow>('mcp_oauth_codes', {
      code_hash: hashOpaqueToken(authorizationCode),
      client_id: pending.client_id,
      user_id: user.id,
      redirect_uri: pending.redirect_uri,
      code_challenge: pending.code_challenge,
      scopes: pending.scopes,
      resource: pending.resource,
      expires_at: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString()
    });
    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set('code', authorizationCode);
    if (pending.mcp_state) {
      redirect.searchParams.set('state', pending.mcp_state);
    }
    return redirect;
  }

  private get googleCallbackUrl() {
    return new URL('/oauth/google/callback', this.baseUrl);
  }

  private get googleReconnectCompleteUrl() {
    return new URL('/oauth/google/complete', this.baseUrl);
  }

  private get mcpResourceUrl() {
    return new URL('/mcp', this.baseUrl);
  }

  private buildGoogleAuthorizationUrl(state: string) {
    const googleUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleUrl.search = new URLSearchParams({
      client_id: requiredEnv('GOOGLE_ADS_CLIENT_ID'),
      redirect_uri: this.googleCallbackUrl.href,
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      scope: `openid email profile ${GOOGLE_ADS_SCOPE}`,
      state
    }).toString();
    return googleUrl;
  }

  private validateResource(resource?: URL) {
    if (resource && resource.href !== this.mcpResourceUrl.href) {
      throw new InvalidRequestError('Invalid MCP resource.');
    }
  }

  private async getAuthorizationCode(client: OAuthClientInformationFull, rawCode: string) {
    const code = await selectOne<AuthorizationCodeRow>('mcp_oauth_codes', {
      code_hash: hashOpaqueToken(rawCode)
    });
    if (!code || code.client_id !== client.client_id || code.used_at || isExpired(code.expires_at)) {
      throw new InvalidGrantError('Invalid or expired authorization code.');
    }
    return code;
  }

  private async issueTokenPair(clientId: string, userId: string, scopes: string[], resource?: string) {
    const accessToken = createOpaqueToken();
    const refreshToken = createOpaqueToken();
    await insertRow<TokenRow>('mcp_oauth_tokens', [
      {
        token_hash: hashOpaqueToken(accessToken),
        token_type: 'access',
        client_id: clientId,
        user_id: userId,
        scopes,
        resource,
        expires_at: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString()
      },
      {
        token_hash: hashOpaqueToken(refreshToken),
        token_type: 'refresh',
        client_id: clientId,
        user_id: userId,
        scopes,
        resource,
        expires_at: new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()
      }
    ]);
    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(' ')
    };
  }

  private async exchangeGoogleCode(code: string) {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: requiredEnv('GOOGLE_ADS_CLIENT_ID'),
        client_secret: requiredEnv('GOOGLE_ADS_CLIENT_SECRET'),
        redirect_uri: this.googleCallbackUrl.href,
        grant_type: 'authorization_code'
      }).toString()
    });
    if (!response.ok) {
      throw new InvalidRequestError(`Google token exchange failed (${response.status}).`);
    }
    const payload = await response.json() as {
      access_token?: string;
      refresh_token?: string;
      scope?: string;
    };
    if (!payload.access_token) {
      throw new InvalidRequestError('Google token response did not include an access token.');
    }
    return { ...payload, access_token: payload.access_token };
  }

  private async getGoogleProfile(accessToken: string) {
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new InvalidRequestError(`Google profile request failed (${response.status}).`);
    }
    const profile = await response.json() as { sub?: string; email?: string; name?: string };
    if (!profile.sub || !profile.email) {
      throw new InvalidRequestError('Google profile response is incomplete.');
    }
    return { sub: profile.sub, email: profile.email, name: profile.name };
  }

  private async getGoogleGrantedScopes(accessToken: string, tokenResponseScope?: string) {
    if (tokenResponseScope) {
      return tokenResponseScope.split(' ').filter(Boolean);
    }
    const tokenInfoUrl = new URL('https://oauth2.googleapis.com/tokeninfo');
    tokenInfoUrl.searchParams.set('access_token', accessToken);
    const response = await fetch(tokenInfoUrl);
    if (!response.ok) {
      throw new InvalidRequestError(`Google token scope validation failed (${response.status}).`);
    }
    const payload = await response.json() as { scope?: string };
    return (payload.scope ?? '').split(' ').filter(Boolean);
  }

  private createClientErrorRedirect(pending: PendingAuthorizationRow, error: string) {
    const redirect = new URL(pending.redirect_uri);
    redirect.searchParams.set('error', error);
    if (pending.mcp_state) {
      redirect.searchParams.set('state', pending.mcp_state);
    }
    return redirect;
  }
}

export function getPublicBaseUrl() {
  const configured = process.env.MCP_PUBLIC_BASE_URL;
  if (configured) {
    return new URL(configured.endsWith('/') ? configured : `${configured}/`);
  }
  if (isMcpAuthEnabled()) {
    throw new Error('MCP_PUBLIC_BASE_URL must be configured when MCP authentication is required.');
  }
  return new URL('http://127.0.0.1:3000/');
}

export function isMcpAuthEnabled() {
  return process.env.MCP_AUTH_REQUIRED === 'true';
}
