'use strict';

/**
 * brand-conformance.spec — the brand, measured on every surface Nota serves.
 *
 * The owner, 2026-09-11, after choosing the lockup through four boards:
 * « the new brand must be in each and every application — the admin interface,
 *   the app itself, whatever. Each and every interface must follow the brand
 *   we decided. » And: « it is important for our brand to live in time. »
 *
 * Living in time is what this file is for. ux-nav.test.mjs reads the REPOSITORY
 * and pins the drawing; this spec reads what is actually SERVED — the rendered
 * DOM after the page's own scripts have run, plus every SVG asset the page
 * points at — so a surface cannot drift by drawing its own mark, by shipping a
 * stale bundle, or by being deployed from an older commit.
 *
 * It runs against localhost by default and against production unchanged:
 *
 *   BRAND_WEB=https://gonota.ca BRAND_ADMIN=https://admin.gonota.ca \
 *   BRAND_DOCS=https://gonota.ca BRAND_BRAND_HOST=https://brand.gonota.ca \
 *   BRAND_PLAN_HOST=https://plan.gonota.ca \
 *   npx playwright test e2e/brand-conformance.spec.js --project=chromium
 *
 * What is checked on each surface (all failures of a surface are collected and
 * reported together, so one red run says everything that is wrong with it):
 *
 *   • the decided drawing is there — the tile (rx 7, square signal), the word
 *     (square O, bevelled T, A) and the signal period, in the page or in the
 *     SVG assets it references;
 *   • no retired drawing survives anywhere — the round signal dot, the rx 12
 *     tile, the rounded O, the straight T, the outline stroke word, the rule;
 *   • the type scale token resolves to the decided value and every visible
 *     heading computes to the display face;
 *   • the colour ramp is the ADR 0048 one, and the retired vocabulary
 *     (--nota-teal / --nota-midnight / --nota-coral / --nota-saffron) appears
 *     in no served stylesheet;
 *   • both themes answer: the page repaints when the viewer's colour scheme
 *     changes, and where the surface carries the site's switch, the switch
 *     flips the explicit theme;
 *   • the favicon resolves and carries the mark.
 *
 * Emails are the one interface a browser cannot open: their brand shell is
 * pinned by apps/api/test/emails-brand.test.mjs, not here.
 */
const { test, expect } = require('@playwright/test');

const WEB = process.env.BRAND_WEB || `http://localhost:${process.env.E2E_WEB_PORT || 4311}`;
const ADMIN = process.env.BRAND_ADMIN || `http://localhost:${process.env.E2E_ADMIN_PORT || 4312}`;
const DOCS = process.env.BRAND_DOCS || `http://localhost:${process.env.E2E_DOCS_PORT || 4313}`;
const BRAND_HOST = process.env.BRAND_BRAND_HOST || '';
const PLAN_HOST = process.env.BRAND_PLAN_HOST || '';

// ADR 0048, amendments of 2026-09-11 (01 → layout 02 → size 16 → details
// 22 + 27). Each entry is a substring that must appear SOMEWHERE in the served
// text of the surface — the rendered DOM or an SVG asset it points at.
const DECIDED = {
  'the tile is a square with a soft corner (rx 7)': 'width="64" height="64" rx="7"',
  'the N stems are square (rx 1)': 'x="16" y="15" width="7.5" height="34" rx="1"',
  'the signal is a square': 'x="40" y="8" width="16" height="16" rx="3"',
  'the O is a square portal': 'M0 8.5a5 5 0 0 1 5-5H22',
  'the T is bevelled': 'V27.3L38.05 31.5V10.8H28.4Z',
  'the A is the decided one': 'M66.5 3.5H72.5L84.1 31.5H76.3',
  'the word ends on the signal period': 'x="87.4" y="27.1" width="4.4" height="4.4"',
};

// Drawings the owner retired. None may survive anywhere on a served surface.
const RETIRED = {
  'the round signal dot': '<circle cx="48"',
  'the rx-12 tile': 'width="64" height="64" rx="12"',
  'the rounded O': 'M11 3.5H16a11',
  'the straight T': 'H45.35V31.5H38.05',
  'the outline stroke word': 'stroke-width="5.2"',
  'the signature rule under the word': 'M0.5 36.5h86',
};

// The retired colour vocabulary (ADR 0048 « a brand a visitor can repaint is
// not a brand »): no served stylesheet may still speak it.
const RETIRED_COLOURS = ['--nota-teal', '--nota-midnight', '--nota-coral', '--nota-saffron'];

const TYPE_H1 = 'clamp(30px, 2.6vw, 44px)';
const RAMP = { '--nota-blue-900': 'rgb(38, 73, 97)', '--nota-blue-500': 'rgb(64, 117, 152)' };

/**
 * Everything the surface actually serves, gathered inside the page: the
 * rendered DOM, the text of every same-origin stylesheet, and the text of
 * every SVG the page points at (an <img>, a <use href> to another file, the
 * favicon). A mark drawn in a separate file is still this surface's mark.
 */
async function served(page) {
  return page.evaluate(async () => {
    const out = { html: document.documentElement.outerHTML, assets: {}, css: {}, errors: [] };
    const grab = async (url, into) => {
      try {
        const r = await fetch(url);
        if (!r.ok) { out.errors.push(`${url} → HTTP ${r.status}`); return; }
        into[url] = await r.text();
      } catch (e) { out.errors.push(`${url} → ${String(e.message).slice(0, 80)}`); }
    };
    const urls = new Set();
    document.querySelectorAll('link[rel~="icon"]').forEach((l) => urls.add(l.href));
    document.querySelectorAll('img[src$=".svg"]').forEach((i) => urls.add(i.src));
    // A <use> can point into another document: "file.svg#id".
    document.querySelectorAll('use[href], use[*|href]').forEach((u) => {
      const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
      if (href && !href.startsWith('#')) urls.add(new URL(href.split('#')[0], location.href).href);
    });
    for (const u of urls) await grab(u, out.assets);
    for (const link of document.querySelectorAll('link[rel="stylesheet"]')) {
      if (new URL(link.href, location.href).origin === location.origin) await grab(link.href, out.css);
    }
    return out;
  });
}

/** The type scale and the display face, as the browser resolved them. */
async function typography(page) {
  return page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const heads = [...document.querySelectorAll('h1, h2')].filter((h) => {
      const cs = getComputedStyle(h);
      const r = h.getBoundingClientRect();
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
    });
    return {
      h1Token: root.getPropertyValue('--type-h1').trim(),
      ramp: {
        '--nota-blue-900': root.getPropertyValue('--nota-blue-900').trim(),
        '--nota-blue-500': root.getPropertyValue('--nota-blue-500').trim(),
      },
      faces: [...new Set(heads.map((h) => getComputedStyle(h).fontFamily.split(',')[0].replace(/['"]/g, '').trim()))],
      headings: heads.length,
    };
  });
}

/** What the page paints, and whether its own switch changes it. */
async function themes(page, url) {
  const paint = () => page.evaluate(() => {
    // The canvas is what the viewer sees: a transparent body shows the root's
    // paint, and several surfaces colour the root rather than the body.
    const transparent = (c) => !c || c === 'transparent' || /rgba\(0, 0, 0, 0\)/.test(c);
    const body = getComputedStyle(document.body);
    const root = getComputedStyle(document.documentElement);
    // A surface may paint its canvas with a gradient (the business plan does),
    // in which case the colour alone says nothing — the image is the paint.
    const image = body.backgroundImage !== 'none' ? body.backgroundImage : root.backgroundImage;
    const colour = transparent(body.backgroundColor) ? root.backgroundColor : body.backgroundColor;
    return {
      bg: image && image !== 'none' ? `${colour} ${image}` : colour,
      ink: body.color,
      theme: document.documentElement.dataset.theme || '',
    };
  });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(url);
  await page.waitForTimeout(400);
  const light = await paint();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url);
  await page.waitForTimeout(400);
  const dark = await paint();
  // The switch, where the surface carries one. Clicking it must stamp an
  // explicit choice on the root — that is how a viewer's decision survives.
  const toggle = page.locator('#theme-toggle, #admin-theme-toggle, .tswitch').first();
  let switched = null;
  if (await toggle.count()) {
    const before = await paint();
    await toggle.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const after = await paint();
    switched = { before, after };
  }
  await page.emulateMedia({ colorScheme: 'light' });
  return { light, dark, switched, hasToggle: !!(await toggle.count()) };
}

/**
 * One surface, the whole contract. `lockup: false` for a page that carries no
 * lockup of its own (none today — kept so a future surface can say so aloud).
 */
async function audit(page, surface) {
  const failures = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));

  // The carnet greets a fresh browser with its intro film and then the guide,
  // both of which cover the header. Every other spec boots past them; the
  // brand lives behind them, not in them.
  await page.addInitScript(() => {
    try { localStorage.setItem('nota.introSeen', '1'); localStorage.setItem('nota.onboarded.v1', '1'); } catch (e) { /* storage blocked */ }
  });
  await page.goto(surface.url);
  if (surface.wait) await page.waitForSelector(surface.wait, { timeout: 20_000 }).catch(() => {
    failures.push(`never showed ${surface.wait}`);
  });
  await page.waitForTimeout(surface.settle || 600);

  const s = await served(page);
  const text = [s.html, ...Object.values(s.assets)].join('\n');
  const css = Object.values(s.css).join('\n');

  for (const [what, signature] of Object.entries(DECIDED)) {
    if (!text.includes(signature)) failures.push(`the lockup is not the decided one — missing ${what}`);
  }
  // The explorations board is the one page that MUST show the retired drawings:
  // they are the alternatives the owner compared. It still has to carry the
  // decided one, and the check above is what says so.
  if (!surface.showsAlternatives) {
    for (const [what, signature] of Object.entries(RETIRED)) {
      if (text.includes(signature)) failures.push(`a retired drawing survives — ${what}`);
    }
  }
  if (/>\s*nota\.\s*</i.test(s.html)) failures.push('the word is typeset as live text « nota. » instead of the drawn wordmark');
  for (const word of RETIRED_COLOURS) {
    if (css.includes(word) || s.html.includes(word)) failures.push(`the retired colour vocabulary survives — ${word}`);
  }
  for (const e of s.errors) failures.push(`asset unreachable: ${e}`);

  const t = await typography(page);
  const tight = (v) => String(v).replace(/\s+/g, '');
  if (tight(t.h1Token) !== tight(TYPE_H1)) failures.push(`--type-h1 is « ${t.h1Token || 'undeclared'} », expected « ${TYPE_H1} »`);
  for (const [token, value] of Object.entries(RAMP)) {
    const got = t.ramp[token];
    if (!got) failures.push(`${token} is not declared`);
    else if (got.replace(/\s/g, '').toLowerCase() !== value.replace(/\s/g, '').toLowerCase() &&
             got.toLowerCase() !== (token === '--nota-blue-900' ? '#264961' : '#407598')) {
      failures.push(`${token} is « ${got} », not the ADR 0048 value`);
    }
  }
  if (!t.headings) failures.push('no visible heading to measure');
  for (const face of t.faces) if (face !== 'Sora') failures.push(`a heading is set in ${face}, not the display face`);

  // Both themes, by one road or the other: the surface either follows the
  // viewer's colour scheme, or carries the switch that changes it. A surface
  // that does neither has one theme, whatever its stylesheet declares.
  const th = await themes(page, surface.url);
  const followsSystem = th.light.bg !== th.dark.bg;
  const switchWorks = !!(th.switched && th.switched.after.bg !== th.switched.before.bg);
  if (!followsSystem && !switchWorks) {
    failures.push(th.hasToggle
      ? `one theme only: ${th.light.bg} under both colour schemes, and the switch does not change it`
      : `one theme only: ${th.light.bg} under both colour schemes, and there is no switch to change it`);
  }
  if (th.hasToggle && th.switched && !switchWorks) failures.push('the theme switch does not repaint the surface');
  if (th.hasToggle && th.switched && !th.switched.after.theme) failures.push('the theme switch does not stamp the choice on the root');

  for (const e of errors) failures.push(`page error: ${e}`);
  expect(failures, `${surface.key} carries the brand`).toEqual([]);
}

const SURFACES = [
  { key: 'carnet', url: `${WEB}/?lang=fr`, wait: 'header' },
  { key: 'espace notaire', url: `${WEB}/?lang=fr#t=notaires`, wait: '#pane-notaires' },
  { key: 'partenaires', url: `${WEB}/?lang=fr#t=partenaires`, wait: '#pane-partenaires' },
  { key: 'signature bêta', url: `${WEB}/?lang=fr#t=beta`, wait: '#pane-beta' },
  { key: 'salle de signature', url: `${WEB}/signature.html?lang=fr`, wait: '#welcome' },
  { key: 'guide de marque', url: `${WEB}/brand.html`, wait: 'h1' },
  { key: 'planche d’explorations', url: `${WEB}/brand-explorations.html`, wait: 'h1', showsAlternatives: true },
  { key: 'acquisition · refinancement (fr)', url: `${WEB}/notaire-refinancement-quebec.html`, wait: '.search-page h1' },
  { key: 'acquisition · financement (fr)', url: `${WEB}/notaire-financement-quebec.html`, wait: '.search-page h1' },
  { key: 'acquisition · refinancing (en)', url: `${WEB}/mortgage-refinancing-notary-quebec-city.html`, wait: '.search-page h1' },
  { key: 'acquisition · financing (en)', url: `${WEB}/mortgage-financing-notary-quebec-city.html`, wait: '.search-page h1' },
  { key: 'console d’administration', url: `${ADMIN}/?lang=fr`, wait: '#auth-email, .admin-rail' },
  { key: 'pitch deck', url: `${DOCS}/pitch-deck.html`, wait: '#slide' },
  { key: 'plan d’affaires', url: `${DOCS}/business-plan.html`, wait: 'h1' },
  ...(BRAND_HOST ? [{ key: 'brand.gonota.ca', url: `${BRAND_HOST}/`, wait: 'h1' }] : []),
  ...(PLAN_HOST ? [{ key: 'plan.gonota.ca', url: `${PLAN_HOST}/`, wait: 'h1' }] : []),
];

test.describe('the brand, on every surface Nota serves', () => {
  for (const surface of SURFACES) {
    test(surface.key, async ({ page }) => {
      test.setTimeout(90_000);
      await audit(page, surface);
    });
  }
});
