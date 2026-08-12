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
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return log(req, 200, start);
  }

  // SPA fallback
  res.writeHead(200, { 'content-type': TYPES['.html'] });
  res.end(readFileSync(join(publicDir, 'index.html')));
  log(req, 200, start);
});

function log(req, code, start) {
  console.log(`${req.method} ${req.url} -> ${code} ${Date.now() - start}ms`);
}

server.listen(PORT, () => {
  console.log(`Nota web on http://localhost:${PORT}`);
});
