/**
 * La porte d'entrée et la vie de la session — audit console admin (2026-09-03) :
 *   • P0-1  : un 429 (trop de demandes) ou un 500 ne se déguisent plus en
 *             « un lien vient d'être envoyé » ;
 *   • P1-15 : la console vise la VRAIE échéance de la session (la fenêtre
 *             d'inactivité servie par /me, pas le plafond de 12 h) et prévient
 *             deux minutes avant, avec un geste « Rester connecté » ;
 *   • P2-31 : la route demandée avant la connexion est rouverte après le lien ;
 *   • P2-36 : l'écran d'erreur fatale aligne ses deux boutons.
 * Même harnais que smoke.test.mjs.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ADMIN_SRC = readFileSync(fileURLToPath(new URL('../public/admin.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const I18N_SRC = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* déjà fermée */ } } });

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* laisser null */ } }
    calls.push({ method, url: String(url), body });
    const [status, json] = handler(method, String(url), body) || [404, null];
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  };
}

// `timers` reçoit chaque setTimeout posé par la console : { fn, ms }. Les
// minuteries réelles restent armées (délais longs, fenêtre fermée à la fin).
async function boot(handler, hash, opts = {}) {
  const calls = [];
  const timers = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (opts.lang) window.localStorage.setItem('nota.lang', opts.lang);
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
      const real = window.setTimeout;
      window.setTimeout = function (fn, ms) { timers.push({ fn, ms }); return real.call(window, fn, ms); };
    },
  });
  const win = dom.window;
  OPEN.push(win);
  if (opts.lang) win.eval(I18N_SRC);
  win.eval(ADMIN_SRC);
  await settle(win);
  return { win, calls, timers, doc: win.document };
}

async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('délai dépassé : ' + sel);
}
async function settle(win) { for (let i = 0; i < 4; i++) await wait(5); }
const text = (n) => (n ? n.textContent : '');
const click = (win, n) => n.dispatchEvent(new win.Event('click', { bubbles: true }));
const futureISO = (ms) => new Date(Date.now() + (ms || 3600000)).toISOString();

async function demanderLien(win, doc) {
  doc.querySelector('#auth-email').value = 'ops@nota.ca';
  doc.querySelector('.auth-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  await settle(win);
}

// --- P0-1 : la porte dit vrai ------------------------------------------------

test('un 429 sur la demande de lien dit « trop de demandes », jamais « un lien vient d’être envoyé »', async () => {
  const { win, doc } = await boot((m, url) => (url.includes('/auth/request') ? [429, { errors: [{ code: 'trop_de_demandes', message: 'Trop de demandes.' }] }] : [404, null]), '');
  await demanderLien(win, doc);
  const err = doc.querySelector('.auth-error');
  assert.ok(err, 'la réponse est une erreur, pas une note neutre');
  assert.match(text(err), /Trop de demandes de lien/);
  assert.match(text(err), /quinze minutes/);
  assert.equal(doc.querySelector('.auth-note'), null);
  assert.equal(err.getAttribute('role'), 'alert', 'un lecteur d’écran doit l’entendre');
});

test('un 500 sur la demande de lien dit que le service n’a pas pu envoyer le lien', async () => {
  const { win, doc } = await boot((m, url) => (url.includes('/auth/request') ? [500, null] : [404, null]), '');
  await demanderLien(win, doc);
  const err = doc.querySelector('.auth-error');
  assert.match(text(err), /n’a pas pu envoyer le lien/);
  assert.equal(doc.querySelector('.auth-note'), null);
});

test('un 200 garde la note neutre — jamais un mot sur l’existence du compte', async () => {
  const { win, doc } = await boot((m, url) => (url.includes('/auth/request') ? [200, { ok: true }] : [404, null]), '');
  await demanderLien(win, doc);
  assert.match(text(doc.querySelector('.auth-note')), /Si cette adresse est autorisée/);
  assert.equal(doc.querySelector('.auth-error'), null);
});

test('en anglais, les deux refus parlent anglais', async () => {
  const { win, doc } = await boot((m, url) => (url.includes('/auth/request') ? [429, null] : [404, null]), '', { lang: 'en' });
  await demanderLien(win, doc);
  await settle(win);
  assert.match(text(doc.querySelector('.auth-error')), /Too many link requests/);
});

// --- P2-36 : l'écran fatal ---------------------------------------------------

test('l’écran d’erreur fatale range ses boutons dans une barre d’actions', async () => {
  const handler = (m, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.endsWith('/me')) return [500, null];
    return [404, null];
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.auth-card .tpl-actions');
  const bar = doc.querySelector('.auth-card .tpl-actions');
  assert.equal(bar.querySelectorAll('button').length, 2, 'Réessayer et Se reconnecter, côte à côte');
  assert.equal(doc.querySelector('.auth-card').getAttribute('role'), 'alert');
});

// --- P2-31 : la route demandée avant la connexion ----------------------------

test('la section visée avant la connexion est rouverte une fois le lien validé', async () => {
  const handler = (m, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(), role: 'super_admin' }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: ['*'] }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/annulation')) return [200, { defaut: { paliers: [] }, override: null, effectif: { paliers: [] } }];
    return [404, null];
  };
  // Un lien profond, sans session : la porte s'affiche…
  const { win, doc } = await boot(handler, '#/annulation');
  await waitFor(win, '.auth-title');
  // …puis le lien magique arrive dans le même onglet.
  win.location.hash = '#/auth?token=T';
  await waitFor(win, '.page-title');
  await settle(win);
  assert.equal(text(doc.querySelector('.page-title')), 'Annulation', 'la console rouvre la section demandée, pas l’aperçu');
  assert.equal(win.location.hash, '#/annulation');
});

// --- P1-15 : la vraie échéance de la session ---------------------------------

function sessionApi(over = {}) {
  const idle = over.idleTtlMs === undefined ? 7 * 60 * 1000 : over.idleTtlMs;
  const abs = over.absMs || 60 * 60 * 1000;
  return (m, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 's', expiresAt: futureISO(abs), role: 'super_admin' }];
    if (url.includes('/auth/refresh')) return over.refresh ? over.refresh() : [200, { ok: true, session: 's2', expiresAt: futureISO(abs) }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role: 'super_admin', permissions: ['*'], ...(idle == null ? {} : { idleTtlMs: idle }), expiresAt: futureISO(abs) }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    return [404, null];
  };
}
const near = (ms, target, slack) => Math.abs(ms - target) <= (slack || 15000);

test('le rafraîchissement silencieux vise l’inactivité (idle − 5 min), pas le plafond de 12 h', async () => {
  const { win, timers } = await boot(sessionApi(), '#/auth?token=T');
  await waitFor(win, '.page-title');
  await settle(win);
  const refresh = timers.filter((t) => near(t.ms, 2 * 60 * 1000));
  assert.ok(refresh.length >= 1, 'une minuterie à ~2 min (7 − 5) : ' + timers.map((t) => t.ms).join(', '));
  assert.ok(!timers.some((t) => near(t.ms, 59 * 60 * 1000)), 'plus aucune minuterie calée sur le plafond absolu − 60 s');
});

test('sans fenêtre servie par /me, la console retombe sur 30 min d’inactivité', async () => {
  const { win, timers } = await boot(sessionApi({ idleTtlMs: null }), '#/auth?token=T');
  await waitFor(win, '.page-title');
  await settle(win);
  assert.ok(timers.some((t) => near(t.ms, 25 * 60 * 1000)), 'rafraîchir à 30 − 5 = 25 min : ' + timers.map((t) => t.ms).join(', '));
});

test('deux minutes avant l’échéance, un avis « Rester connecté » — et le geste rafraîchit la session', async () => {
  const { win, doc, timers, calls } = await boot(sessionApi(), '#/auth?token=T');
  await waitFor(win, '.page-title');
  await settle(win);
  const warn = timers.filter((t) => near(t.ms, 5 * 60 * 1000)); // 7 − 2
  assert.ok(warn.length >= 1, 'une minuterie d’avertissement à ~5 min : ' + timers.map((t) => t.ms).join(', '));
  warn[warn.length - 1].fn();
  const avis = await waitFor(win, '.session-warning');
  assert.equal(avis.getAttribute('role'), 'alert');
  assert.match(text(avis), /expire dans deux minutes/);
  const rester = [...avis.querySelectorAll('button')].find((b) => /Rester connecté/.test(text(b)));
  assert.ok(rester, 'le geste est offert');
  const avant = calls.filter((c) => c.url.includes('/auth/refresh')).length;
  click(win, rester);
  await settle(win);
  assert.equal(calls.filter((c) => c.url.includes('/auth/refresh')).length, avant + 1, 'le clic rafraîchit');
  assert.equal(doc.querySelector('.session-warning'), null, 'l’avis disparaît une fois la session prolongée');
});

test('quand le plafond absolu est plus proche que l’inactivité, l’avis dit de se reconnecter', async () => {
  // Plafond à 4 min, inactivité à 7 : c'est le plafond qui échoit d'abord, et
  // aucun rafraîchissement ne le repousse.
  const { win, timers } = await boot(sessionApi({ absMs: 4 * 60 * 1000 }), '#/auth?token=T');
  await waitFor(win, '.page-title');
  await settle(win);
  const warn = timers.filter((t) => near(t.ms, 2 * 60 * 1000)); // 4 − 2
  assert.ok(warn.length >= 1, 'avertissement à ~2 min : ' + timers.map((t) => t.ms).join(', '));
  warn[warn.length - 1].fn();
  const avis = await waitFor(win, '.session-warning');
  assert.match(text(avis), /durée maximale/);
  assert.ok([...avis.querySelectorAll('button')].some((b) => /Se reconnecter/.test(text(b))));
});
