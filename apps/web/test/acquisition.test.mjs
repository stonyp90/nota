import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const src = readFileSync(new URL('../public/acquisition.js', import.meta.url), 'utf8');
async function page({ url = 'https://gonota.ca/?utm_source=linkedin&utm_campaign=launch#token=secret', consent, saved, referrer = '' } = {}) {
  const dom = new JSDOM('<meta name="nota:analytics" content="G-TEST123"><aside id="analytics-consent" hidden><button id="analytics-accept">Accept</button><button id="analytics-refuse">Decline</button></aside><button id="analytics-preferences">Preferences</button><button id="offer-submit">Secret person name</button>', { url, ...(referrer ? {referrer} : {}), runScripts: 'outside-only' });
  const w = dom.window;
  if (consent) w.localStorage.setItem('nota.analytics-consent', consent);
  if (saved) w.localStorage.setItem('nota.acquisition', JSON.stringify(saved));
  w.eval(src); await new Promise(r => w.setTimeout(r, 0)); return w;
}
test('no Google script, cookie or acquisition storage before consent; decline still attributes a submitted lead', async () => {
  const w = await page();
  assert.equal(w.document.querySelector('script'), null);
  assert.equal(w.localStorage.getItem('nota.acquisition'), null);
  w.document.getElementById('analytics-refuse').click();
  assert.equal(w.document.querySelector('script'), null);
  assert.equal(w.NotaAcquisition.snapshot().last.source, 'linkedin');
  assert.equal(w.localStorage.getItem('nota.acquisition'), null); w.close();
});
test('opt-in tracks clicks and confirmed leads without URL secrets or button text; withdrawal and regrant work', async () => {
  const w = await page();
  w.document.getElementById('analytics-accept').click();
  assert.match(w.document.querySelector('script').src, /googletagmanager/);
  w.document.getElementById('offer-submit').click();
  w.NotaAcquisition.event('generate_lead');
  const data = JSON.stringify(w.dataLayer.map(x => Array.from(x)));
  assert.match(data, /ui_click/); assert.match(data, /generate_lead/);
  assert.doesNotMatch(data, /secret|Secret person|token=/);
  assert.match(data, /https:\/\/gonota.ca\//);
  w.document.getElementById('analytics-refuse').click();
  assert.equal(w.localStorage.getItem('nota.acquisition'), null);
  const n = w.dataLayer.length;
  w.NotaAcquisition.event('generate_lead'); assert.equal(w.dataLayer.length, n);
  assert.equal(w['ga-disable-G-TEST123'], true);
  w.document.getElementById('analytics-accept').click();
  assert.equal(w['ga-disable-G-TEST123'], false); w.close();
});
test('first touch survives a campaign return; direct return preserves last non-direct source only with consent', async () => {
  const saved = { first: {source:'google'}, last:{source:'linkedin'}, expires: Date.now()+60000 };
  const w = await page({url:'https://gonota.ca/',consent:'granted',saved});
  assert.equal(w.NotaAcquisition.snapshot().first.source,'google'); assert.equal(w.NotaAcquisition.snapshot().last.source,'linkedin');w.close();
  const denied = await page({url:'https://gonota.ca/',consent:'denied',saved});
  assert.equal(denied.NotaAcquisition.snapshot().first.source,'direct');denied.close();
});
test('expired attribution resets and raw UTM emails/URLs are dropped', async () => {
  const w = await page({ url:'https://gonota.ca/?utm_source=google&utm_campaign=person%40example.com&utm_content=https%3A%2F%2Fprivate.test',consent:'granted',saved:{first:{source:'linkedin'},last:{source:'linkedin'},expires:1}});
  assert.deepEqual(JSON.parse(JSON.stringify(w.NotaAcquisition.snapshot())),{version:1,first:{source:'google',medium:'organic'},last:{source:'google',medium:'organic'}}); w.close();
});
