/** Embed one shared foundation in every independently served application. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../', import.meta.url);
export const foundationTargets = [
  'web/public/index.html', 'web/public/brand.html', 'web/public/signature.html',
  'admin/public/index.html', '../docs/business-plan.html', '../docs/pitch-deck.html',
];
export function foundationsStyle() {
  // Typography and the spacing scale remain owned by the public product.
  const source = readFileSync(new URL('web/public/styles.css', root), 'utf8');
  const tokens = [...source.matchAll(/(--(?:type-[\w-]+|font-(?:sans|display|mono)|weight-display|space-\d+)):\s*([^;{}]+);/g)];
  const first = new Map();
  for (const [, name, value] of tokens) if (!first.has(name)) first.set(name, value.trim());
  for (const token of ['word', 'gap', 'badge-gap']) {
    const value = source.match(new RegExp(`--lockup-${token}: calc\\(var\\(--lockup-tile\\) \\* ([.\\d]+)\\)`));
    if (!value) throw new Error(`Missing lockup ratio: ${token}`);
    first.set(`--logo-${token}-ratio`, value[1]);
  }
  first.set('--logo-tile', source.match(/--lockup-tile:\s*(\d+px)/)[1]);
  const badge = source.match(/\.brand-sub\s*\{([^}]+)\}/)[1];
  first.set('--logo-badge-bg', badge.match(/background:\s*([^;]+);/)[1]);
  const scale = ':root {\n' + [...first].map(([name, value]) => `  ${name}: ${value};`).join('\n') + '\n}\n';
  const chrome = readFileSync(new URL('web/brand-foundations.css', root), 'utf8');
  return `<style data-nota-foundations>\n${scale}${chrome}</style>`;
}
export function syncBrandFoundations({ check = false } = {}) {
  const style = foundationsStyle();
  const navigation = `<script data-nota-navigation>
(() => {
  const menu = document.querySelector('.nota-menu');
  if (!menu) return;
  const mobile = matchMedia('(max-width: 700px)');
  const sync = () => { menu.open = !mobile.matches; };
  sync();
  mobile.addEventListener('change', sync);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  document.addEventListener('click', event => {
    if (mobile.matches && menu.open && !menu.contains(event.target)) menu.open = false;
  });
})();
</script>`;
  for (const target of foundationTargets) {
    const path = new URL(target, root);
    const before = readFileSync(path, 'utf8');
    const clean = before.replace(/<style data-nota-foundations>[\s\S]*?<\/style>\s*/g, '').replace(/<script data-nota-navigation>[\s\S]*?<\/script>\s*/g, '');
    let after = clean.replace('</head>', `${style}\n</head>`);
    if (clean.includes('class="nota-menu"')) after = after.replace('</body>', `${navigation}\n</body>`);
    if (before === after) continue;
    if (check) throw new Error(`${target}: run npm run brand:generate`);
    writeFileSync(path, after);
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) syncBrandFoundations({ check: process.argv.includes('--check') });
