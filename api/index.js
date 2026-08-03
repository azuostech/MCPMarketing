let cachedApp = null;

async function getApp() {
  if (cachedApp) {
    return cachedApp;
  }

  try {
    const mod = await import('../dist/httpServer.js');
    cachedApp = mod.default;
    return cachedApp;
  } catch (error) {
    console.error('Failed to load MCP HTTP app', error);
    return null;
  }
}

export default async function handler(req, res) {
  const url = new URL(req.url ?? '/', `https://${req.headers.host ?? 'localhost'}`);

  if (url.pathname === '/health') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'mcp-marketing-analytics' }));
    return;
  }

  const app = await getApp();

  if (!app) {
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'MCP runtime unavailable' }));
    return;
  }

  return app(req, res);
}
