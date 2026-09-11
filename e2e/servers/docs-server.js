'use strict';

/**
 * E2E docs server — serves docs/ (the pitch deck, the business plan and their
 * assets) exactly as the deploy copies them into apps/web/dist: the deck at
 * /pitch-deck.html with /pitch-deck/*.png beside it, the plan at
 * /business-plan.html. Static, dependency-free, test-only — the production
 * origin is S3 + CloudFront; this lets the layout spec measure those two
 * surfaces at every size like any other page.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 4313);
const ROOT = path.join(__dirname, '..', '..', 'docs');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css',
  '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain; charset=utf-8', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const f = path.normalize(path.join(ROOT, p === '/' ? 'business-plan.html' : p));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Nota E2E docs on http://localhost:${PORT}  [serving docs/]`);
});
