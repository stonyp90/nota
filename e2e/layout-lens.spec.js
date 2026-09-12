'use strict';
const { test, expect } = require('@playwright/test');
const { measure, settle } = require('./layout-lens');

test('subgrid measurements ignore empty cells and still detect content collisions', async ({ page }) => {
  await page.setContent(`<!doctype html><style>
    #layout { display:grid; grid-template-columns:300px 300px; grid-template-rows:100px 100px; gap:20px; }
    h1 { grid-column:1; grid-row:1; margin:0; }
    aside { display:grid; grid-template-columns:subgrid; grid-template-rows:subgrid; grid-column:1 / -1; grid-row:1 / -1; }
    #guide { grid-column:1; grid-row:2; }
    #preview { grid-column:2; grid-row:1 / -1; }
  </style><main id="layout"><h1>Title</h1><aside><section id="guide">Instructions</section><section id="preview">Preview</section></aside></main>`);
  const options = { rootSel: '#layout', touch: false, vw: 1280, vh: 800 };
  expect((await page.evaluate(measure, options)).overlaps).toEqual([]);

  // Move real content onto the title. The same transparent wrapper must not
  // exempt this collision from the audit.
  await page.locator('#guide').evaluate(el => { el.style.gridRow = '1'; });
  expect((await page.evaluate(measure, options)).overlaps).toContainEqual(expect.stringMatching(/h1 × section#guide/));
});

test('SVG group measurements count visible content and still detect blank bands', async ({ page }) => {
  await page.setContent(`<!doctype html><body style="margin:0">
    <svg xmlns="http://www.w3.org/2000/svg" style="display:block" width="600" height="640">
      <rect width="600" height="640" fill="#123" />
      <text x="20" y="30">Top</text>
      <g id="content"><g>
        <text x="20" y="130">One</text>
        <text x="20" y="230">Two</text>
        <text x="20" y="330">Three</text>
        <text x="20" y="430">Four</text>
        <text x="20" y="530">Five</text>
      </g></g>
      <text x="20" y="630">Bottom</text>
    </svg>
  </body>`);
  const options = { rootSel: 'body', touch: false, vw: 1280, vh: 800 };
  expect((await page.evaluate(measure, options)).bands).toEqual([]);

  // Hidden ancestors must stop traversal, even when their descendants have
  // visible geometry. The full-size background must not fill the blank band.
  for (const style of ['display:none', 'visibility:hidden', 'opacity:0']) {
    await page.locator('#content').evaluate((el, value) => el.setAttribute('style', value), style);
    expect((await page.evaluate(measure, options)).bands, style).toHaveLength(1);
    await page.locator('#content').evaluate(el => el.removeAttribute('style'));
    expect((await page.evaluate(measure, options)).bands).toEqual([]);
  }
  await page.locator('#content').evaluate(el => el.remove());
  expect((await page.evaluate(measure, options)).bands).toHaveLength(1);
});

test('settle waits for delayed finite SVG animations before reading geometry', async ({ page }) => {
  await page.setContent(`<svg xmlns="http://www.w3.org/2000/svg">
    <g id="delayed"><text x="20" y="30">Delayed slide content</text></g>
  </svg>`);
  await page.locator('#delayed').evaluate(el => {
    // The business plan's final reveal starts after 2.3s and lasts 0.8s.
    el.animate([{ opacity: 0 }, { opacity: 1 }], { delay: 2300, duration: 800, fill: 'both' });
  });
  await settle(page);
  // Read immediately: an auto-waiting assertion would conceal an early return.
  const state = await page.locator('#delayed').evaluate(el => ({
    animation: el.getAnimations()[0].playState,
    opacity: getComputedStyle(el).opacity,
  }));
  expect(state).toEqual({ animation: 'finished', opacity: '1' });
});
