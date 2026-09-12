import { pages, pagePath, renderPage } from './seo-pages.mjs';
/**
 * Local dev server for the web app. Plain node:http, zero dependencies.
 * Serves public/ directly, synthesizes /domain.js from @nota/domain (so the
 * source stays single-sourced and public/ has no committed copy), and falls
 * back unknown paths to index.html — matching the CloudFront SPA behavior.
 */
import { createServer, request as httpRequest } from 'node:http';
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
  '.pdf': 'application/pdf',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

// Browsers can resume or seek the inline calendar video with a single byte
// range. Unsupported/malformed ranges fall back to the complete representation.
function serveVideo(req, res, file) {
  const bytes = readFileSync(file);
  const size = bytes.length;
  const headers = { 'content-type': TYPES['.mp4'], 'content-length': size, 'accept-ranges': 'bytes' };
  const range = req.method === 'GET' && typeof req.headers.range === 'string'
    ? /^bytes=(\d*)-(\d*)$/i.exec(req.headers.range.trim()) : null;
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || end < start) {
      res.writeHead(416, { ...headers, 'content-length': 0, 'content-range': `bytes */${size}` });
      res.end();
      return 416;
    }
    res.writeHead(206, { ...headers, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
    res.end(bytes.subarray(start, end + 1));
    return 206;
  }
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : bytes);
  return 200;
}

const server = createServer((req, res) => {
  const start = Date.now();
  let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  // OAuth requires same-origin HttpOnly cookies even when ordinary local API
  // traffic uses a different port. Never log authorization query parameters.
  if (path.startsWith('/api/auth/oauth/')) {
    const target = new URL(req.url, API_BASE || 'http://localhost:8788');
    const headers = { ...req.headers }; delete headers.host; delete headers.connection;
    const upstream = httpRequest(target, { method: req.method, headers }, apiRes => {
      res.writeHead(apiRes.statusCode, apiRes.headers); apiRes.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ code: 'oauth_unavailable' }] }));
    });
    req.pipe(upstream); return;
  }
  // Development serves mutable filenames, so reloading must see current files.
  res.setHeader('cache-control', 'no-store');
  if (path === '/') path = '/index.html';

  for (const page of pages) {
    for (const lang of ['fr', 'en']) {
      if (path === pagePath(page, lang)) {
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        let html = renderPage(page, lang);
        if (API_BASE) html = html.replace('<head>', '<head><script>window.__NOTA_API__=' + JSON.stringify(API_BASE) + ';</script>');
        res.end(html);
        return log(req, 200, start);
      }
    }
  }

  // Single-source the domain module.
  if (path === '/domain.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(readFileSync(domainSrc));
    return log(req, 200, start);
  }
  if (path === '/signing-domain.js') {
    res.writeHead(200, { 'content-type': TYPES['.js'] });
    res.end(readFileSync(join(dirname(domainSrc), 'signing.js')));
    return log(req, 200, start);
  }

  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) { res.writeHead(403); res.end('Forbidden'); return; }

  if (existsSync(file) && statSync(file).isFile()) {
    if (extname(file) === '.html') { serveHtml(res, file); return log(req, 200, start); }
    if (extname(file) === '.mp4') return log(req, serveVideo(req, res, file), start);
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
  console.log(`Nota web on http://localhost:${server.address().port}`);
});
