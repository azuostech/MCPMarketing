declare const process: { env: Record<string, string | undefined>; exit: (code?: number) => never };

import { exchangeCodeForRefreshToken, startLocalOAuthFlow } from './googleAdsOAuth.js';

async function main() {
  const callback = await startLocalOAuthFlow();
  const payload = await exchangeCodeForRefreshToken(callback.code);

  console.log('OAuth exchange complete.');
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
