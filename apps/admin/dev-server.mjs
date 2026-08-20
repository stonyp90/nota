/**
 * The admin dev server, as a factory so tests can wire it to a stub API.
 * Serves public/ directly, falls unknown paths back to index.html, and — like
 * CloudFront on admin.nota.ca — hands every /api/* request to the admin API,
 * same-origin. The path is forwarded verbatim: the admin API strips the /api
 * prefix itself, so dev and production see the exact same routes.
 */
import { createServer, request as httpRequest } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function createDevServer({ apiOrigin, publicDir = join(here, 'public') } = {}) {
  return createServer((req, res) => {
    const start = Date.now();
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

    if (path === '/api' || path.startsWith('/api/')) {
      proxy(req, res, apiOrigin, start);
      return;
    }

    serveStatic(req, res, publicDir, path === '/' ? '/index.html' : path, start);
  });
}

function serveStatic(req, res, publicDir, path, start) {
  const file = normalize(join(publicDir, path));
  if (!file.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (existsSync(file) && statSync(file).isFile()) {
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return log(req, 200, start);
  }

  // SPA fallback
  res.writeHead(200, { 'content-type': TYPES['.html'] });
  res.end(readFileSync(join(publicDir, 'index.html')));
  log(req, 200, start);
}

// Streamed pass-through to the admin API. Hop-by-hop headers stay per-leg
// (node manages connection/content-length on each side); everything else —
// method, path, auth and content headers, status, body — crosses untouched.
function proxy(req, res, apiOrigin, start) {
  let upstreamUrl;
  try {
    upstreamUrl = new URL(req.url, apiOrigin);
  } catch {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ errors: [{ code: 'api_locale_invalide', message: 'Origine API locale invalide.' }] }));
    return;
  }

  const headers = { ...req.headers };
  delete headers.host; // the upstream sets its own
  delete headers.connection;

  const upstream = httpRequest(
    upstreamUrl,
    { method: req.method, headers },
    (apiRes) => {
      res.writeHead(apiRes.statusCode, apiRes.headers);
      apiRes.pipe(res);
      apiRes.on('end', () => log(req, apiRes.statusCode, start));
    }
  );

  upstream.on('error', () => {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        errors: [
          {
            code: 'api_locale_indisponible',
            message: `API admin locale injoignable (${apiOrigin}). Démarrez-la : npm run admin:local`,
          },
        ],
      })
    );
    log(req, 502, start);
  });

  req.pipe(upstream);
}

function log(req, code, start) {
  console.log(`${req.method} ${req.url} -> ${code} ${Date.now() - start}ms`);
}
