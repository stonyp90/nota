/**
 * Build the web app into dist/. No bundler, no dependencies.
 *  - copies public/* verbatim
 *  - vendors @nota/domain in as dist/domain.js (the browser global)
 *  - strips DEV-only markers between <!-- DEV:start --> and <!-- DEV:end -->
 * Fails loudly if a marker is left unbalanced, so a half-stripped build can't ship.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('Built dist/ ->', distDir);
console.log('Files:', readdirSync(distDir).join(', '));
