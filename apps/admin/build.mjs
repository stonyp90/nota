/**
 * Build the admin console into dist/. No bundler, no dependencies.
 * Mirrors apps/web/build.mjs:
 *   - copies public/* verbatim (stripping any <!-- DEV:start --> … DEV:end --> block)
 *   - content-hashes the cacheable assets and rewrites every reference to them
 *
 * Reference graph handled here:
 *   index.html  -> admin-theme.js, admin.css, admin.js
 *   admin.css   -> tokens.css   (via @import)
 * tokens.css is hashed first and its new name patched into admin.css BEFORE
 * admin.css is itself hashed, so the hash covers the final content. index.html
 * (unhashed, no-cache) is the single source that points at the current hashes,
 * so a browser can never pair a stale asset with a fresh shell.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const distDir = join(here, 'dist');

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

function stripDev(html) {
  const out = html.replace(/<!--\s*DEV:start\s*-->[\s\S]*?<!--\s*DEV:end\s*-->/g, '');
  if (/DEV:start|DEV:end/.test(out)) throw new Error('Unbalanced DEV marker left in output');
  return out;
}

function copyTree(src, dst) {
  for (const name of readdirSync(src)) {
    const s = join(src, name);
    const d = join(dst, name);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d); continue; }
    let data = readFileSync(s);
    if (name.endsWith('.html')) data = Buffer.from(stripDev(data.toString('utf8')), 'utf8');
    writeFileSync(d, data);
  }
}

copyTree(publicDir, distDir);

// --- Content-hash the cacheable assets ------------------------------------
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);

function hashRename(name) {
  const p = join(distDir, name);
  const dot = name.lastIndexOf('.');
  const hashed = `${name.slice(0, dot)}.${hash(readFileSync(p))}${name.slice(dot)}`;
  renameSync(p, join(distDir, hashed));
  return hashed;
}
function patch(file, replacements) {
  const p = join(distDir, file);
  let text = readFileSync(p, 'utf8');
  for (const [orig, next] of Object.entries(replacements)) text = text.split(orig).join(next);
  writeFileSync(p, text);
}

// 1) Hash tokens.css and rewrite the @import inside admin.css first.
const manifest = {};
manifest['tokens.css'] = hashRename('tokens.css');
patch('admin.css', { 'tokens.css': manifest['tokens.css'] });

// 2) Hash the assets index.html references directly.
for (const name of ['admin-theme.js', 'admin.css', 'admin.js', 'i18n.js']) manifest[name] = hashRename(name);

// 3) Rewrite index.html to the hashed filenames.
patch('index.html', {
  'admin-theme.js': manifest['admin-theme.js'],
  'admin.css': manifest['admin.css'],
  'admin.js': manifest['admin.js'],
  'i18n.js': manifest['i18n.js'],
});

console.log('Built dist/ ->', distDir);
console.log('Hashed assets:', JSON.stringify(manifest));
console.log('Files:', readdirSync(distDir).join(', '));
