/** The film uses real Nota panels and never blanks them at scene boundaries. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const offer = JSON.parse(read('../../../demo/calendar-captures/offer.json'));
const captures = JSON.parse(read('../../../demo/calendar-captures/manifest.json'));
for (const lang of ['fr', 'en']) {
  for (const [name, capture] of Object.entries(captures[lang])) {
    // Geometry and source identity are tested without decoding media in Node.
    capture.image = `capture-${name}-${lang}`;
    capture.imageWidth = 1280;
    capture.imageHeight = 720;
  }
}
const css = read('../public/styles.css');
const token = name => css.match(new RegExp(name + ':\\s*(#[0-9a-f]{6})\\s*;', 'i'))[1];
const brand = {
  captures, demoOffer: offer, logo: 'official-nota-logo', heading: 'Sora', body: 'Inter',
  colors: {
    lightBg: token('--canvas-bg'), lightInk: token('--canvas-ink'),
    lightMuted: token('--canvas-ink-muted'), lightBorder: token('--canvas-border'),
    lightSurface: token('--canvas-surface'), paper: token('--paper'), brand: token('--nota-blue-700'),
  },
};
const context = { NotaDomain: D, NotaCalendarBrand: brand };
for (const source of ['i18n.js', 'agenda-demo-render.js']) vm.runInNewContext(read('../public/' + source), context);
const film = context.NotaCalendarFilm;

for (const lang of ['fr', 'en']) {
  test(`${lang}: real Nota sources fill the film without a repeated logo or demo label`, () => {
    for (const t of [0, 3.999, 4, 7.5, 9.5, 10.499, 10.5, 14.9, 15.499, 15.5, film.duration - .001]) {
      const svg = film.render(t, lang);
      assert.doesNotMatch(svg, /NaN|Infinity|rgba\(255,255,255/, `valid opaque frame at ${t}s`);
      const doc = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
      assert.equal(doc.documentElement.getAttribute('viewBox'), '0 0 1120 630');
      assert.equal(doc.querySelector('image[href="official-nota-logo"]'), null, 'the page header already carries the brand');
      assert.doesNotMatch(doc.documentElement.textContent, /Exemple de démonstration|Demo example/, 'no repeated demo label above the experience');
      assert.equal(doc.querySelector('rect').getAttribute('fill'), brand.colors.lightBg);
      const scene = t < 4 ? 'subscribe' : t < 10.5 ? null : t < 15.5 ? 'confirm' : 'retained';
      assert.equal(!!doc.querySelector(`image[href="capture-retained-${lang}"]`), t >= 15.5, 'show the real result after confirmation');
      if (scene) assert.ok(doc.querySelector(`image[href="capture-${scene}-${lang}"]`));
      else assert.ok(doc.querySelector('#month'), 'the connected month remains visible');
      if (t >= 8 && t < 10.5) {
        const amount = lang === 'en' ? D.moneyEn(offer.montant) : D.money(offer.montant);
        assert.ok(doc.documentElement.textContent.includes(amount), 'same domain-formatted offer');
      }
      doc.defaultView.close();
    }
  });

  test(`${lang}: the real acceptance footer stays still while the review moves`, () => {
    const footer = captures[lang].confirm.footer;
    assert.ok(footer && footer.y >= 0 && footer.height > 0);
    assert.ok(footer.y + footer.height <= captures[lang].confirm.height);
    const frames = [10.5, 13.4, 15.4].map(t => new JSDOM(film.render(t, lang), { contentType: 'image/svg+xml' }).window);
    const position = win => {
      const clip = win.document.querySelector('#shot-confirm-footer rect');
      return ['x', 'y', 'width', 'height'].map(attr => clip.getAttribute(attr));
    };
    assert.deepEqual(position(frames[0]), position(frames[1]));
    assert.deepEqual(position(frames[0]), position(frames[2]));
    assert.equal(Number(position(frames[0])[2]), 1072, 'review and footer fill the frame width');
    frames.forEach(win => win.close());
  });
}
