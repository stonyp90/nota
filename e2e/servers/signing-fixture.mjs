import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createApp } = require('../../apps/api/src/handler');
const { createMemoryRepo } = require('../../apps/api/src/repo-memory');
const { activeNotary } = require('../../apps/api/test-support/notary-fixture');
const D = require('@nota/domain');

// Synthetic, in-memory fixtures only. Real single-use mailbox challenges are
// redeemed through the application's development echo; no email is sent.
export async function startSigningFixture(options = {}) {
  const release = process.env.NOTA_SIGNING_RELEASE_DIR;
  const buildApp = release ? require(resolve(release, 'api-patched/src/handler.js')).createApp : createApp;
  const buildRepo = release ? require(resolve(release, 'api-patched/src/repo-memory.js')).createMemoryRepo : createMemoryRepo;
  const notary = activeNotary('notaire@example.test', { nom: 'Me Camille — démonstration' });
  const bid = { id: 'signature-demo', dateISO: '2026-09-18', notaryId: notary.id,
    status: D.STATUS.RETENUE, nom: 'Alex — démonstration', courriel: 'client@example.test',
    serviceId: 'refinancement', montant: 2000 };
  const repo = buildRepo([bid]);
  await repo.putNotary(notary);
  await repo.indexClientBid({ courriel: bid.courriel, bidId: bid.id, dateISO: bid.dateISO, at: new Date().toISOString() });
  const app = buildApp(repo, { notaryLoginDevEcho: true, clientLoginDevEcho: true,
    notaryConsoleUrl: 'http://localhost', clientEspaceUrl: 'http://localhost',
    env: { NOTA_SIGNING_BETA_ENABLED: 'true', ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('NOTA_SIGNING_TURN_'))), ...options.env } });
  async function call(path, body) {
    const response = await app.handle({ path, method: 'POST', headers: {}, sourceIp: '127.0.0.1', body });
    if (response.statusCode !== 200) throw new Error('Fixture authentication failed: ' + response.statusCode);
    return JSON.parse(response.body);
  }
  const nRequest = await call('/notary/session/request', { email: notary.email });
  const nSession = await call('/notary/session/verify', { token: nRequest.devToken });
  const cRequest = await call('/client/session/request', { courriel: bid.courriel });
  const cSession = await call('/client/session/verify', { token: cRequest.devToken });
  const root = resolve(import.meta.dirname, '../../apps/web/public');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const result = await app.handle({ path: url.pathname.slice(4), method: req.method,
          query: Object.fromEntries(url.searchParams), headers: req.headers, body,
          sourceIp: '127.0.0.1' });
        res.writeHead(result.statusCode, result.headers); res.end(result.body); return;
      }
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      let file = resolve(root, '.' + path);
      if (!file.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
      if (path === '/domain.js') file = resolve(import.meta.dirname, '../../packages/domain/index.js');
      if (path === '/signing-domain.js') file = resolve(import.meta.dirname, '../../packages/domain/signing.js');
      let content;
      if (release) {
        try { content = await readFile(resolve(release, 'web-patched', '.' + path)); } catch { /* Shared icon fallback only. */ }
      }
      if (!content) content = await readFile(file);
      // The ordinary development server also provides this same API hook.
      if (extname(file) === '.html') content = content.toString().replace('<head>', '<head><script>window.__NOTA_API__="/api";</script>');
      res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store',
        'permissions-policy': 'camera=(self), microphone=(self), fullscreen=(self)' });
      res.end(content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { app, repo, bid, baseURL: 'http://127.0.0.1:' + server.address().port,
    tokens: { notary: nSession.token, client: cSession.offres[0].clientToken },
    async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
