/** Public downloads derive from the product drawings, never hand-copied paths. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../public/', import.meta.url);
export function brandKit() {
  const html = readFileSync(new URL('index.html', publicDir), 'utf8');
  const symbol = (id) => {
    const match = html.match(new RegExp(`<symbol id="${id}"[^>]*>([\\s\\S]*?)</symbol>`));
    if (!match) throw new Error(`Missing product symbol: ${id}`);
    return match[1].replace(/<!--[\s\S]*?-->/g, '').replace(/[ \t]+$/gm, '').trim();
  };
  const mark = symbol('nota-logomark');
  const word = symbol('nota-wordmark');
  const css = readFileSync(new URL('styles.css', publicDir), 'utf8');
  const colour = (source, token) => {
    const match = source.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})\\s*;`, 'i'));
    if (!match) throw new Error(`Missing product colour: ${token}`);
    return match[1];
  };
  const darkRoot = css.match(/:root\[data-theme=['"]dark['"]\]\s*\{([\s\S]*?)\}/);
  if (!darkRoot) throw new Error('Missing product dark theme');
  const ratio = token => {
    const match = css.match(new RegExp(`${token}:\\s*calc\\(var\\(--lockup-tile\\)\\s*\\*\\s*([.\\d]+)\\)`));
    if (!match) throw new Error(`Missing product lockup ratio: ${token}`);
    return Number(match[1]);
  };
  const tile = 64;
  const cap = tile * ratio('--lockup-word');
  const scale = cap / 28;
  const wordX = tile * (1 + ratio('--lockup-gap'));
  const wordY = (tile - cap) / 2;
  const width = wordX + 91.8 * scale + 32;
  const number = value => Number(value.toFixed(10));
  const assets = {};
  for (const [theme, ink] of [['light', colour(css, '--canvas-ink')], ['dark', colour(darkRoot[1], '--ink')]]) {
    // Read the product proportions and retain 16 units of clear space on every side.
    assets[`nota-logo-${theme}.svg`] = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -16 ${number(width)} 96" role="img" aria-label="Nota"><title>Nota</title><g>${mark}</g><g transform="translate(${number(wordX)} ${number(wordY)}) scale(${number(scale)}) translate(0 -3.5)" color="${ink}">${word}</g></svg>\n`;
  }
  assets['signature-courriel.html'] = readFileSync(new URL('../../../docs/signature-courriel.html', import.meta.url), 'utf8');
  return assets;
}

export function writeBrandKit() {
  for (const [name, content] of Object.entries(brandKit())) writeFileSync(new URL(name, publicDir), content);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeBrandKit();
