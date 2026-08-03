declare const process: { env: Record<string, string | undefined>; exit: (code?: number) => never };

declare const fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/adwords';
const REDIRECT_URI = 'http://127.0.0.1:3000/callback';

export function buildGoogleAdsAuthUrl() {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  if (!clientId) {
    throw new Error('GOOGLE_ADS_CLIENT_ID is not configured.');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    scope: OAUTH_SCOPE,
    prompt: 'consent'
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeCodeForRefreshToken(code: string) {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET must be configured.');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    }).toString()
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${response.statusText} ${text}`);
  }

  const payload = await response.json() as { refresh_token?: string; access_token?: string; expires_in?: number };
  return payload;
}

export async function startLocalOAuthFlow() {
  const authUrl = buildGoogleAdsAuthUrl();
  console.log(`Open this URL in your browser:\n${authUrl}`);

  return new Promise<{ code: string; state?: string }>((resolve, reject) => {
    const server = http.createServer(async (req: any, res: any) => {
      if (!req.url) {
        res.writeHead(400);
        res.end('Missing callback URL.');
        return;
      }

      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== '/callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400);
        res.end(`OAuth error: ${error}`);
        server.close();
        reject(new Error(error));
        return;
      }

      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code.');
        server.close();
        reject(new Error('Missing authorization code.'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Authentication complete. You can return to the terminal.');
      server.close();
      resolve({ code, state: url.searchParams.get('state') ?? undefined });
    });

    server.on('error', (err: any) => {
      if (err && err.code === 'EADDRINUSE') {
        console.error('Port 3000 is busy; please stop the other process or change the redirect URI.');
      }
      reject(err);
    });

    server.listen(3000, '127.0.0.1', () => {
      console.log('Waiting for Google OAuth callback on http://127.0.0.1:3000/callback');
    });
  });
}
