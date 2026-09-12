import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 4175);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function safePath(url, host = '') {
  let pathname;
  try { pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname); } catch { return null; }
  if (pathname === '/') {
    // Mirror the CloudFront host rewrites locally so the shareable hostnames
    // can be exercised with a hosts-file entry and Docker Compose.
    const hostname = String(host).split(':')[0].toLowerCase();
    pathname = hostname === 'plan.gonata.ca' || hostname === 'plan.gonota.ca'
      ? '/business-plan.html' : '/pitch-deck.html';
  }
  const target = resolve(ROOT, `.${pathname}`);
  if (target !== ROOT && !target.startsWith(`${ROOT}${sep}`)) return null;
  return target;
}

const server = createServer(async (req, res) => {
  const target = safePath(req.url || '/', req.headers.host);
  if (!target || req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(target ? 405 : 400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Not available\n');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(target);
    const ext = target.slice(target.lastIndexOf('.'));
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=60',
      'x-content-type-options': 'nosniff',
      'content-length': body.length,
    });
    if (req.method === 'HEAD') res.end(); else res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : 'Not found\n');
  }
});

server.listen(PORT, () => console.log(`Nota business plan: http://localhost:${PORT}/`));
