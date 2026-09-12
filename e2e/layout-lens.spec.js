'use strict';
const { test, expect } = require('@playwright/test');
const { measure } = require('./layout-lens');

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
