import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script = readFileSync(new URL('../public/analytics.js', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../public/landing.js', import.meta.url), 'utf8');

function boot({ url = 'https://gonota.ca/', referrer, storage = true } = {}) {
  const dom = new JSDOM('<html lang="fr-CA"><a data-acquisition-link href="/?lang=fr">Continuer</a></html>', { url, referrer, runScripts: 'outside-only' });
  const calls = [];
  dom.window.fetch = (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return Promise.reject(new Error('offline')); };
  if (!storage) Object.defineProperty(dom.window, 'localStorage', { get() { throw new Error('blocked'); } });
  dom.window.eval(script);
  return { dom, win: dom.window, calls };
}

test('arrival classification uses exact host boundaries and bounded campaign categories', () => {
  for (const [url, referrer, source] of [
    ['https://gonota.ca/', 'https://www.google.ca/search?q=private', 'google'],
    ['https://gonota.ca/', 'https://google.com.attacker.test/private', 'referral_other'],
    ['https://gonota.ca/?utm_source=linkedin&email=secret', undefined, 'linkedin'],
    ['https://gonota.ca/?utm_source=private-value', undefined, 'campaign_other'],
    ['https://gonota.ca/?utm_medium=email', undefined, 'email'],
    ['https://gonota.ca/', 'https://chatgpt.com/private', 'ai'],
    ['https://gonota.ca/', undefined, 'direct_unknown'],
    ['https://gonota.ca/?nota_source=google.com', undefined, 'direct_unknown'],
  ]) {
    const { win, dom } = boot({ url, referrer });
    assert.equal(win.NotaAnalytics.context().source, source);
    dom.window.close();
  }
});

test('no identifiers, referrer, errors or storage writes; blocked storage and transport remain safe', async () => {
  const { win, dom, calls } = boot({ storage: false, url: 'https://gonota.ca/?token=secret' });
  win.NotaAnalytics.send('visite');
  for (let i = 0; i < 2; i++) win.dispatchEvent(new win.ErrorEvent('error', { message: 'SECRET', filename: 'private.js' }));
  await Promise.resolve();
  assert.equal(calls.filter(c => c.body.event === 'erreur_script').length, 1);
  assert.equal(calls[0].body.context.storage, 'unavailable');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(calls[0].url, '/api/events');
  assert.ok(!JSON.stringify(calls).includes('SECRET'));
  assert.ok(!JSON.stringify(calls).includes('token'));
  dom.window.close();
});

test('service-page navigation preserves coarse source and entry without a raw referrer', () => {
  const { win, dom, calls } = boot({ url: 'https://gonota.ca/notaire-financement-quebec.html', referrer: 'https://www.google.ca/search?q=secret' });
  win.eval(landing);
  const link = new URL(win.document.querySelector('a').href);
  assert.equal(link.searchParams.get('nota_source'), 'google');
  assert.equal(link.searchParams.get('nota_entry'), 'financement');
  assert.equal(calls[0].body.event, 'page_service_vue');
  const next = boot({ url: link.href, referrer: win.location.href });
  assert.equal(next.win.NotaAnalytics.context().source, 'google');
  assert.equal(next.win.NotaAnalytics.context().entry, 'financement');
  assert.ok(!link.href.includes('secret'));
  next.dom.window.close(); dom.window.close();
});

test('load timing is bucketed once after load, without exposing exact durations', async () => {
  const { win, dom, calls } = boot();
  Object.defineProperty(win.performance, 'getEntriesByType', { value: () => [{ startTime: 0, loadEventEnd: 4501 }] });
  assert.equal(win.NotaAnalytics.context().load, 'unknown');
  win.dispatchEvent(new win.Event('load'));
  win.dispatchEvent(new win.Event('load'));
  await new Promise(resolve => setTimeout(resolve, 20));
  const measured = calls.filter(c => c.body.event === 'navigation_mesuree');
  assert.equal(measured.length, 1);
  assert.equal(measured[0].body.context.load, 'slow');
  assert.ok(!JSON.stringify(measured).includes('4501'));
  dom.window.close();
});
