'use strict';

/**
 * A content fingerprint of the source a dev server actually loaded.
 *
 * WHY THIS EXISTS. The docker services run plain `node`, so a container keeps
 * serving whatever it required at boot. On 2026-09-04 the running stack was
 * answering with two-day-old code while the tree had moved on — with no error,
 * no warning, and no way to tell from the response. Every local verification
 * made against it was worthless, and *silently* worthless, which is worse than
 * a crash.
 *
 * So each dev server hashes its own source at boot and stamps the digest on
 * every response (`x-nota-source`). Anyone can then compare that digest with
 * the tree in front of them — `npm run local:check` does exactly that — and a
 * mismatch is a fact, not a suspicion. `dev-watch.js` polls the same digest to
 * decide when to restart, so the freshness signal and the reload trigger are
 * the same number and cannot disagree.
 *
 * Contents, not mtimes: the digest must be identical computed on the host and
 * inside the container over the same bind mount, and mtime granularity is not.
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Everything whose edit changes what an API dev server answers. The static web
// and admin servers re-read `public/` on every request, so their assets are
// deliberately absent — only their own server files matter, and those services
// pass their own list through NOTA_WATCH_PATHS.
const DEFAULT_PATHS = [
  'packages/domain/index.js',
  'apps/api/src',
  'apps/api/local-server.js',
  'apps/api/admin-local-server.js',
  'apps/api/scripts',
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage']);

function collect(root, rel, out) {
  const abs = path.join(root, rel);
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return; // a path that does not exist is simply not part of the digest
  }
  if (st.isFile()) {
    out.push(rel);
    return;
  }
  if (!st.isDirectory()) return;
  for (const entry of fs.readdirSync(abs)) {
    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
    collect(root, path.posix.join(rel.split(path.sep).join('/'), entry), out);
  }
}

/** The paths this process watches: NOTA_WATCH_PATHS overrides the default set. */
function watchPaths(env = process.env) {
  const raw = String(env.NOTA_WATCH_PATHS || '').trim();
  if (!raw) return DEFAULT_PATHS.slice();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * `{ hash, files, paths }` — a short hex digest over the contents of every file
 * under `paths`, plus how many files went into it.
 */
function sourceFingerprint({ root = REPO_ROOT, paths = watchPaths() } = {}) {
  const files = [];
  for (const p of paths) collect(root, p, files);
  files.sort();
  const h = createHash('sha256');
  for (const rel of files) {
    h.update(rel);
    h.update('\0');
    try {
      h.update(fs.readFileSync(path.join(root, rel)));
    } catch {
      h.update('<unreadable>');
    }
    h.update('\0');
  }
  return { hash: h.digest('hex').slice(0, 12), files: files.length, paths };
}

module.exports = { sourceFingerprint, watchPaths, REPO_ROOT, DEFAULT_PATHS };
