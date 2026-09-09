import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const source = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const html = source('../public/index.html'), app = source('../public/app.js'), domain = source('../../../packages/domain/index.js'), i18n = source('../public/i18n.js');
let windows = [];
afterEach(() => { windows.forEach(w => w.close()); windows = []; });
async function boot({ hash = '', reply = () => null, seed = {} } = {}) {
  const calls = [];
  const dom = new JSDOM(html, { url: 'https://nota.example/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; windows.push(w);
  w.localStorage.setItem('nota.lang', 'fr');
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  w.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options, hash: w.location.hash });
    const result = reply(String(url), options) || { body: { ok: true } };
    return { ok: !result.status || result.status < 400, status: result.status || 200, headers: { get: () => null }, json: async () => result.body };
  };
  w.eval(i18n); w.eval(domain); w.eval(app);
  await new Promise(r => setTimeout(r, 90));
  return { w, d: w.document, calls };
}
test('only configured providers become actionable; Microsoft replaces the unused Facebook placeholder', async () => {
  const { d } = await boot({ reply: url => url.endsWith('/auth/oauth/providers') ? { body: { providers: [{ id: 'google', configured: true }, { id: 'microsoft', configured: true }, { id: 'linkedin', configured: false }] } } : null });
  d.getElementById('header-login').click(); await new Promise(r => setTimeout(r, 10));
  const buttons = [...d.querySelectorAll('.auth-soc-btn')];
  assert.deepEqual(buttons.map(b => b.dataset.provider), ['google','microsoft','linkedin']);
  assert.deepEqual(buttons.map(b => b.getAttribute('aria-disabled')), ['false','false','true']);
  assert.ok(!buttons[0].textContent.includes('À venir'));
});
test('configured provider posts chosen role and cookies; provider outage remains inside modal', async () => {
  const { d, calls } = await boot({ reply: url => url.endsWith('/providers') ? { body: { providers: [{ id: 'microsoft', configured: true }] } } : url.endsWith('/microsoft/start') ? { status: 503, body: { errors: [{ code: 'oauth_unavailable' }] } } : null });
  d.getElementById('header-login').click(); await new Promise(r => setTimeout(r, 10));
  d.querySelector('[data-provider="microsoft"]').click(); await new Promise(r => setTimeout(r, 10));
  const call = calls.find(c => c.url.endsWith('/microsoft/start'));
  assert.equal(JSON.parse(call.options.body).role,'client'); assert.equal(call.options.credentials,'same-origin');
  assert.match(d.getElementById('auth-soc-live').textContent,/Connexion indisponible/);
});
test('OAuth fragment is removed before network; linked client response merges saved requests', async () => {
  const { w, calls } = await boot({ hash: '#oauth=' + 'x'.repeat(43), seed: { 'nota.myoffers.v1': [{ id: 'old', dateISO: '2026-10-01', serviceId: 'refinancement', montant: 2000 }] }, reply: url => url.endsWith('/complete') ? { body: { ok: true, role: 'client', courriel: 'verified@example.test', offres: [] } } : null });
  assert.ok(calls.every(c => !c.hash.includes('oauth=')));
  assert.equal(JSON.parse(w.localStorage.getItem('nota.profile.v1')).courriel,'verified@example.test');
  assert.equal(calls.filter(c => c.url.endsWith('/complete')).length,1);
  assert.equal(JSON.parse(w.localStorage.getItem('nota.myoffers.v1'))[0].id, 'old');
});
test('first-time identity asks for mailbox proof; does not sign in before confirmation', async () => {
  const { w, d, calls } = await boot({ hash: '#oauth=' + 'x'.repeat(43), reply: url => url.endsWith('/complete') ? { body: { linkRequired: true, ticket: 't'.repeat(43), role: 'client' } } : null });
  assert.equal(d.getElementById('oauth-link-dialog').open,true);
  assert.ok(!d.getElementById('onboarding-dialog').open, 'onboarding must not cover the OAuth callback');
  assert.ok(!w.localStorage.getItem('nota.profile.v1'));
  d.getElementById('oauth-link-email').value = 'owner@example.test';
  d.querySelector('#oauth-link-dialog form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 10));
  const call = calls.find(c => c.url.endsWith('/link/request'));
  assert.deepEqual(JSON.parse(call.options.body),{ticket:'t'.repeat(43),email:'owner@example.test'});
  assert.ok(!w.localStorage.getItem('nota.profile.v1'));
});
test('failed callback preserves local identity and sign-out confirmation failure cannot erase data', async () => {
  const { w, calls } = await boot({ hash: '#oautherror=oauth_consent_denied', seed: { 'nota.profile.v1': { courriel:'existing@example.test' } } });
  assert.ok(!calls.some(c => c.url.includes('/auth/oauth/')));
  w.confirm = () => { throw new Error('dialog unavailable'); };
  w.Nota.account.signOut();
  assert.equal(JSON.parse(w.localStorage.getItem('nota.profile.v1')).courriel,'existing@example.test');
});
