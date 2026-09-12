import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { foundationTargets, foundationsStyle, syncBrandFoundations } from '../scripts/sync-brand-foundations.mjs';

test('every shipped shell embeds the current foundation and one header', () => {
  syncBrandFoundations({ check: true });
  for (const target of foundationTargets) {
    const html = readFileSync(new URL(`../../${target}`, import.meta.url), 'utf8');
    const doc = new JSDOM(html).window.document;
    assert.equal(doc.querySelectorAll('style[data-nota-foundations]').length, 1, target);
    assert.equal(doc.querySelectorAll('header.nota-header').length, 1, target);
    assert.ok(doc.body.hasAttribute('data-nota-surface'), target);
    assert.ok(html.includes(foundationsStyle()), target);
  }
});

test('the guide documents the proportions actually used by the product', () => {
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  const doc = new JSDOM(readFileSync(new URL('../public/brand.html', import.meta.url), 'utf8')).window.document;
  const ratios = doc.querySelector('.ratios').textContent;
  for (const token of ['word', 'gap']) {
    const ratio = Number(css.match(new RegExp(`--lockup-${token}: calc\\(var\\(--lockup-tile\\) \\* ([.\\d]+)\\)`))[1]);
    assert.ok(ratios.includes(`${Math.round(ratio * 100)} %`), `guide does not describe --lockup-${token}`);
  }
});

test('deployment distributes the current PDF editions and no historical PowerPoint', () => {
  for (const file of ['ci.yml', 'deploy.yml']) {
    const workflow = readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(workflow, /nota-pitch-deck[^\s]*\.pptx/);
  }
  const build = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
  for (const name of ['business-plan.html', 'pitch-deck.html', 'nota-pitch-deck.pdf', 'nota-pitch-deck-fr.pdf']) assert.ok(build.includes(name));
});
