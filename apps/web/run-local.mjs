/**
 * Local dev server for the web app. Plain node:http, zero dependencies.
 * Serves public/ directly, synthesizes /domain.js from @nota/domain (so the
 * source stays single-sourced and public/ has no committed copy), and falls
 * back unknown paths to index.html — matching the CloudFront SPA behavior.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const domainSrc = join(here, '..', '..', 'packages', 'domain', 'index.js');
const PORT = Number(process.env.PORT || 4173);
// Optional API override: NOTA_API_BASE=http://localhost:XXXX points the served
// app at any local API instance via the app's own window.__NOTA_API__ hook
// (app.js falls back to :8788 on localhost when unset).
const API_BASE = process.env.NOTA_API_BASE || '';

function serveHtml(res, file) {
  let html = readFileSync(file, 'utf8');
  if (API_BASE) {
    html = html.replace('<head>', '<head><script>window.__NOTA_API__=' + JSON.stringify(API_BASE) + ';</script>');
  }
  res.writeHead(200, { 'content-type': TYPES['.html'] });
  res.end(html);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  const start = Date.now();
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (path === '/') path = '/index.html';

  // Single-source the domain module.
  if (path === '/domain.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(readFileSync(domainSrc));
    return log(req, 200, start);
  }

  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }

  if (existsSync(file) && statSync(file).isFile()) {
    if (extname(file) === '.html') { serveHtml(res, file); return log(req, 200, start); }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return log(req, 200, start);
  }

  // SPA fallback
  serveHtml(res, join(publicDir, 'index.html'));
  log(req, 200, start);
});

function log(req, code, start) {
  console.log(`${req.method} ${req.url} -> ${code} ${Date.now() - start}ms`);
}

server.listen(PORT, () => {
  console.log(`Nota web on http://localhost:${PORT}`);
});
