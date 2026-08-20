/**
 * Build the web app into dist/. No bundler, no dependencies.
 *  - copies public/* verbatim
 *  - vendors @nota/domain in as dist/domain.js (the browser global)
 *  - strips DEV-only markers between <!-- DEV:start --> and <!-- DEV:end -->
 * Fails loudly if a marker is left unbalanced, so a half-stripped build can't ship.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, 'public');
const distDir = join(here, 'dist');
const domainSrc = join(here, '..', '..', 'packages', 'domain', 'index.js');

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
writeFileSync(join(distDir, 'domain.js'), readFileSync(domainSrc));

// --- Content-hash the cacheable assets ------------------------------------
// Every deploy overwrites app.js/styles.css/domain.js in place, so a browser
// holding an old copy (max-age) would pair it with a freshly-served index.html
// and crash. Fingerprinting the filenames makes each build reference names the
// browser has never cached, so old and new can never mix — and lets the hashed
// files be cached immutably forever. index.html (and sw.js) stay unhashed and
// no-cache; they are the single source that points at the current hashes.
const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const HASHED = ['app.js', 'styles.css', 'domain.js', 'i18n.js'];
const manifest = {}; // original name -> hashed name
for (const name of HASHED) {
  const p = join(distDir, name);
  const dot = name.lastIndexOf('.');
  const hashed = `${name.slice(0, dot)}.${hash(readFileSync(p))}${name.slice(dot)}`;
  renameSync(p, join(distDir, hashed));
  manifest[name] = hashed;
}

// Rewrite index.html to point at the hashed filenames (src="app.js" etc.).
const indexPath = join(distDir, 'index.html');
let indexHtml = readFileSync(indexPath, 'utf8');
for (const [orig, hashed] of Object.entries(manifest)) {
  indexHtml = indexHtml.split(orig).join(hashed);
}
writeFileSync(indexPath, indexHtml);

// Stamp the service worker: a per-build cache name (so activate purges old
// shells) and the hashed filenames in its precache list.
const swPath = join(distDir, 'sw.js');
if (readdirSync(distDir).includes('sw.js')) {
  const buildId = hash(Buffer.from(Object.values(manifest).join('|')));
  let sw = readFileSync(swPath, 'utf8');
  sw = sw.replace('nota-shell-dev', `nota-shell-${buildId}`);
  for (const [orig, hashed] of Object.entries(manifest)) {
    sw = sw.split(`'/${orig}'`).join(`'/${hashed}'`);
  }
  writeFileSync(swPath, sw);
}

console.log('Built dist/ ->', distDir);
console.log('Hashed assets:', JSON.stringify(manifest));
console.log('Files:', readdirSync(distDir).join(', '));
