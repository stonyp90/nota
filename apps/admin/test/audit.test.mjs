/**
 * Headless DOM tests for the « Audit » section — le journal append-only, pièce
 * SOC 2. Même harnais que notaires.test.mjs. Couvre : le sélecteur de jour (qui
 * part sur aujourd'hui), la ligne d'argent lisible sans JSON pour un acte
 * réglé, le changement de jour, le 422 d'une date illisible, la porte fermée à
 * l'analyste, le jour vide, et la traversée en anglais.
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

function makeFetch(handler, calls) {
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) { /* leave null */ } }
    calls.push({ method, url: String(url), body });
    const out = handler(method, String(url), body) || [404, null];
    const [status, json] = out;
    if (status === 0) return Promise.reject(new Error('network'));
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(json),
    });
  };
}

const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* already gone */ } } });

async function boot(handler, hash, lang) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/' + (hash || ''),
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch(handler, calls);
      window.scrollTo = () => {};
      if (lang) window.localStorage.setItem('nota.lang', lang);
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  if (lang) win.eval(I18N_SRC);
  win.eval(ADMIN_SRC);
  await settle(win);
  return { win, calls, doc: win.document };
}

async function waitFor(win, sel, timeout = 1500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (win.document.querySelector(sel)) return win.document.querySelector(sel);
    await wait(5);
  }
  throw new Error('timeout waiting for ' + sel);
}
async function settle(win) { for (let i = 0; i < 3; i++) await wait(5); }

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
};
// « Aujourd'hui » est le jour ouvrable québécois (America/Toronto), jamais la
// tranche UTC : un soir d'été à Montréal, UTC est déjà demain.
const TZ = 'America/Toronto';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hhmm = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

// Une journée : un acte réglé (la pièce financière) et un geste d'admin.
function sampleDay(jour) {
  return {
    jour: jour,
    entrees: [
      { id: 'a2', ts: jour + 'T18:11:03.000Z', day: jour, action: 'prix_nota_updated',
        adminId: 'ad1', email: 'ops@nota.ca', ip: '24.201.10.4',
        meta: { before: { prixCents: 40000 }, after: { prixCents: 25000 } } },
      // ADR 0031 — un acte réglé porte DEUX lignes : les honoraires du notaire,
      // entiers, et le prix de Nota à côté. Ni taux, ni cote, ni « net ».
      { id: 'a1', ts: jour + 'T14:02:00.000Z', day: jour, action: 'acte_regle',
        adminId: null, email: null, ip: null,
        meta: { bidId: 'b1', dateISO: '2026-08-20', notaryId: 'n1', serviceId: 'refinancement',
                montant: 2800, honoraires: 2800, prixNota: 400,
                chargeId: 'ch_1', transferId: 'tr_1' } },
    ],
  };
}

function api(opts = {}) {
  const role = opts.role || 'super_admin';
  // La porte du journal est `audit:read` — celle que l'API applique (P0-2) —
  // et non `pii:read` : lire le journal et lever l'anonymat d'un client sont
  // deux capacités distinctes.
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'audit:read', 'moderation:write', 'settings:write', 'notifications:write']
    : ['analytics:read']);
  const state = { days: opts.days || null, status: opts.status || 200, error: opts.error || null };
  const handler = (method, url) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/audit')) {
      if (state.status !== 200) return [state.status, state.error];
      var jour = (/[?&]jour=([^&]*)/.exec(url) || [])[1] || '';
      if (state.days) return [200, state.days[jour] || { jour: jour, entrees: [] }];
      return [200, sampleDay(jour)];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// ---------------------------------------------------------------------------

test('the rail carries an Audit entry; the journal opens on today', async () => {
  const { win, doc, calls } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b) .includes('Audit'));
  assert.ok(entry, 'rail entry « Audit » is missing');
  assert.equal(entry.disabled, false);

  click(win, entry);
  await waitFor(win, '.audit-entry');
  assert.equal(win.location.hash, '#/audit');
  assert.equal(text(doc.querySelector('.page-title')), 'Audit');

  const day = doc.querySelector('.audit-day');
  assert.ok(day, 'the day picker is there');
  assert.equal(day.type, 'date');
  assert.equal(day.value, today(), 'it starts on today');
  const asked = calls.filter((c) => c.url.includes('/audit'));
  assert.equal(asked.length, 1);
  assert.match(asked[0].url, new RegExp('/audit\\?jour=' + today() + '$'));
});

test('a settled act reads as a sentence, newest first, without ever showing JSON', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');

  const entries = [...doc.querySelectorAll('.audit-entry')];
  assert.equal(entries.length, 2, 'both entries render, in the order served (newest first)');
  assert.match(text(entries[0].querySelector('.audit-action')), /Prix de Nota modifié/,
    'a known action reads in French, never as its raw code');
  assert.match(text(entries[0]), /ops@nota\.ca/);
  assert.match(text(entries[0]), /24\.201\.10\.4/);
  // L'heure est celle de Québec (P2-27), et l'entrée le dit plutôt que de
  // laisser deviner un fuseau.
  assert.equal(text(entries[0].querySelector('.audit-ts')), hhmm(today() + 'T18:11:03.000Z'));
  assert.match(entries[0].querySelector('.audit-ts').getAttribute('title') || '', /America\/Toronto/);

  const acte = entries[1];
  assert.match(text(acte.querySelector('.audit-action')), /Acte réglé/);
  assert.equal(
    text(acte.querySelector('.audit-money')),
    '2 800 $ au notaire · 400 $ à Nota',
    'the money line is the disclosure — it must read on its own');
  // Les identifiants restent lisibles à côté, sans noyer la phrase.
  const facts = text(acte.querySelector('.audit-facts'));
  assert.match(facts, /refinancement/);
  assert.match(facts, /2026-08-20/);
  assert.match(facts, /b1/);
  assert.ok(!/\{|\}/.test(text(acte.querySelector('.audit-money'))), 'no JSON in the sentence');
});

test('picking another day refetches that day and nothing else', async () => {
  const days = {
    '2026-08-30': sampleDay('2026-08-30'),
    '2026-08-29': { jour: '2026-08-29', entrees: [] },
  };
  const { win, doc, calls } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-day');

  change(win, doc.querySelector('.audit-day'), '2026-08-30');
  await waitFor(win, '.audit-entry');
  const urls = calls.filter((c) => c.url.includes('/audit')).map((c) => c.url);
  assert.equal(urls.length, 2);
  assert.match(urls[1], /jour=2026-08-30$/);
  assert.equal(doc.querySelectorAll('.audit-entry').length, 2);

  change(win, doc.querySelector('.audit-day'), '2026-08-29');
  await waitFor(win, '.empty-state');
  assert.equal(doc.querySelectorAll('.audit-entry').length, 0, 'an empty day says so instead of keeping the old one');
});

test('an unreadable date is answered by the API message, inline', async () => {
  const handler = api({ status: 422, error: { errors: [{ code: 'jour_invalide', message: 'Le jour doit être une date ISO (AAAA-MM-JJ).' }] } });
  const { win, doc, calls } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  const err = await waitFor(win, '.tpl-error');
  assert.match(text(err), /Le jour doit être une date ISO/);
  assert.equal(doc.querySelector('.error-banner'), null, 'a validation answer is not a technical failure');
  assert.ok(doc.querySelector('.audit-day'), 'the picker survives, so the operator can correct the day');
  assert.equal(calls.filter((c) => c.url.includes('/audit')).length, 1);
});

test('an analyst never reaches the journal: rail entry reserved, route closed, no request', async () => {
  const { win, doc, calls } = await boot(api({ role: 'analyst' }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const entry = [...doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Audit'));
  assert.equal(entry.disabled, true);
  assert.match(text(entry), /Réservé/);

  win.location.hash = '#/audit';
  await waitFor(win, '.admin-denied');
  assert.equal(doc.querySelector('.audit-entry'), null);
  assert.equal(calls.filter((c) => c.url.includes('/audit')).length, 0);
});

test('a failed journal fetch shows the retry banner, and retry recovers', async () => {
  let fail = true;
  const base = api();
  const handler = (method, url, body) => {
    if (url.includes('/audit')) return fail ? [500, null] : [200, sampleDay(today())];
    return base(method, url, body);
  };
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  const banner = await waitFor(win, '.error-banner');
  fail = false;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.audit-entry');
  assert.ok(!doc.querySelector('.error-banner'));
});

test('the money line crosses into English with the money reformatted', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  await settle(win);

  const money = [...doc.querySelectorAll('.audit-money')][0];
  assert.equal(text(money), '$2,800 to the notary · $400 to Nota');
  assert.match(text(doc.querySelector('.audit-action')), /Nota’s price updated/);
});

// ---------------------------------------------------------------------------
// Audit console admin (2026-09-03)
// ---------------------------------------------------------------------------

test('P0-2 — la porte du journal est « audit:read » : un lecteur sans pii:read y entre, un pii:read sans audit:read reste dehors', async () => {
  const lecteur = await boot(api({ permissions: ['audit:read'] }), '#/auth?token=T');
  await waitFor(lecteur.win, '.admin-rail');
  const entree = [...lecteur.doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Audit'));
  assert.equal(entree.disabled, false, 'audit:read suffit');
  lecteur.win.location.hash = '#/audit';
  await waitFor(lecteur.win, '.audit-entry');
  assert.equal(lecteur.calls.filter((c) => c.url.includes('/audit')).length, 1);

  const curieux = await boot(api({ permissions: ['pii:read'] }), '#/auth?token=T');
  await waitFor(curieux.win, '.admin-rail');
  const fermee = [...curieux.doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Audit'));
  assert.equal(fermee.disabled, true, 'pii:read n’ouvre pas le journal');
  // …et le bottin, lui, reste ouvert à pii:read : les deux portes sont distinctes.
  const bottin = [...curieux.doc.querySelectorAll('.admin-rail-link')].find((b) => text(b).includes('Notaires'));
  assert.equal(bottin.disabled, false);
});

test('P0-3 — un acte réglé HORS plateforme se lit « dû à Nota — non encaissé », jamais comme un encaissement', async () => {
  const jour = today();
  const days = {};
  days[jour] = { jour, entrees: [
    { id: 'd1', ts: jour + 'T14:02:00.000Z', day: jour, action: 'acte_regle', adminId: null, email: null, ip: null,
      meta: { bidId: 'b7', dateISO: '2026-08-20', notaryId: 'n1', serviceId: 'refinancement',
              montant: 2800, honoraires: 2800, prixNota: 400, chargeId: null, transferId: null,
              paye: false, commissionCentsDue: 40000 } },
    { id: 'd2', ts: jour + 'T13:00:00.000Z', day: jour, action: 'acte_regle', adminId: null, email: null, ip: null,
      meta: { bidId: 'b8', dateISO: '2026-08-21', notaryId: 'n1', serviceId: 'refinancement',
              montant: 2000, honoraires: 2000, prixNota: 400, chargeId: 'ch_8', transferId: 'tr_8', paye: true, commissionCentsDue: 0 } },
  ] };
  const { win, doc } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  const [du, paye] = [...doc.querySelectorAll('.audit-entry')];
  assert.equal(text(du.querySelector('.audit-money')), '2 800 $ au notaire · 400 $ dû à Nota — non encaissé');
  assert.match(text(du.querySelector('.audit-badge')), /Non encaissé/, 'le badge se voit avant de lire la phrase');
  assert.equal(text(paye.querySelector('.audit-money')), '2 000 $ au notaire · 400 $ à Nota');
  assert.equal(paye.querySelector('.audit-badge'), null, 'un acte encaissé ne porte aucun badge');
});

test('P0-3 (EN) — la créance se dit en anglais', async () => {
  const jour = today();
  const days = {};
  days[jour] = { jour, entrees: [
    { id: 'd1', ts: jour + 'T14:02:00.000Z', day: jour, action: 'acte_regle', adminId: null, email: null, ip: null,
      meta: { bidId: 'b7', dateISO: '2026-08-20', notaryId: 'n1', serviceId: 'refinancement',
              montant: 2800, honoraires: 2800, prixNota: 400, paye: false, commissionCentsDue: 40000 } },
  ] };
  const { win, doc } = await boot(api({ days }), '#/auth?token=T', 'en');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  await settle(win);
  assert.equal(text(doc.querySelector('.audit-money')), '$2,800 to the notary · $400 owed to Nota — not collected');
  assert.match(text(doc.querySelector('.audit-badge')), /Not collected/);
});

test('P0-4 — « aujourd’hui » est le jour ouvrable québécois : à 22 h 30 à Montréal, UTC est déjà demain', async () => {
  // 2026-09-03T02:30Z = 2026-09-02 22:30 à Montréal (EDT).
  const FIXED = Date.parse('2026-09-03T02:30:00.000Z');
  const calls = [];
  const handler = api();
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://admin.nota.example/#/auth?token=T',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = makeFetch((m, url) => {
        if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: new Date(FIXED + 3600000).toISOString(), role: 'super_admin' }];
        return handler(m, url);
      }, calls);
      window.scrollTo = () => {};
      if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      }
      const Real = window.Date;
      class FakeDate extends Real {
        constructor(...a) { super(...(a.length ? a : [FIXED])); }
        static now() { return FIXED; }
      }
      window.Date = FakeDate;
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(ADMIN_SRC);
  await settle(win);
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-day');
  assert.equal(win.document.querySelector('.audit-day').value, '2026-09-02');
  assert.equal(win.document.querySelector('.audit-day').max, '2026-09-02');
  assert.match(calls.find((c) => c.url.includes('/audit')).url, /jour=2026-09-02$/);
});

test('P1-16 — chaque geste connu a un libellé, et l’argent des annulations et des rétentions se lit en phrase', async () => {
  const jour = today();
  const mk = (id, action, meta) => ({ id, ts: jour + 'T12:00:00.000Z', day: jour, action, adminId: null, email: 'ops@nota.ca', ip: null, meta });
  const days = {};
  days[jour] = { jour, entrees: [
    mk('e1', 'annulation_frais', { bidId: 'b1', dateISO: '2026-09-10', notaryId: 'n1', montant: 2800, taux: 0.3, frais: 840, joursAvant: 3, chargeId: 'ch_1', transferId: 'tr_1', verse: true }),
    mk('e2', 'annulation_frais', { bidId: 'b2', dateISO: '2026-09-12', notaryId: 'n2', montant: 2000, taux: 0.1, frais: 200, joursAvant: 10, chargeId: 'ch_2', transferId: null, verse: false }),
    mk('e3', 'acte_retenu', { bidId: 'b3', dateISO: '2026-09-15', notaryId: 'n1', serviceId: 'refinancement', montant: 2800, etude: 'Étude Tremblay' }),
    mk('e4', 'acces_modifie', { cible: 'support@nota.ca' }),
    mk('e5', 'groupe_modifie', { groupeId: 'soutien' }),
    mk('e6', 'groupe_supprime', { groupeId: 'soutien' }),
    mk('e7', 'campagne_envoyee', { campagneId: 'c1', envoyes: 34 }),
    mk('e8', 'campagne_refusee', { motif: 'envoi_indisponible' }),
    mk('e9', 'document_depose', { bidId: 'b3', documentId: 'd1', de: 'client' }),
    mk('e10', 'document_lu', { bidId: 'b3', documentId: 'd1', par: 'notaire' }),
    mk('e11', 'notary_activated', { notaryId: 'n9' }),
  ] };
  const { win, doc } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  const entries = [...doc.querySelectorAll('.audit-entry')];
  entries.forEach((e) => {
    const a = e.querySelector('.audit-action');
    assert.ok(!/_/.test(text(a)), 'un geste connu ne sort jamais comme un code brut : ' + text(a));
    assert.equal(a.hasAttribute('data-i18n-skip'), false, 'et il se traduit');
  });
  assert.equal(text(entries[0].querySelector('.audit-money')), '840 $ retenus au client · versés au notaire');
  assert.equal(text(entries[1].querySelector('.audit-money')), '200 $ retenus au client · dus au notaire');
  assert.equal(text(entries[2].querySelector('.audit-money')), '2 800 $ offerts au notaire');
  assert.match(text(entries[2].querySelector('.audit-facts')), /Étude Tremblay/);
  assert.equal(entries[3].querySelector('.audit-money'), null, 'les autres gestes gardent leur meta telle quelle');
});

// ---------------------------------------------------------------------------
// La chaîne d'ACCÈS écrite par la porte publique (ADR 0036)
// ---------------------------------------------------------------------------
// Ces trois tests ferment le trou trouvé le 2026-09-04 : le chantier d'audit
// avait promis que le journal « nomme son acteur », et la console ne lisait
// toujours pas `acteur` — elle affichait « système » pour TOUTES les entrées
// publiques, y compris `document_lu`, qui nomme enfin le notaire. Les six
// actions neuves, elles, sortaient en code brut, avec `data-i18n-skip` : donc
// invisibles au test i18n, qui ne marche que les littéraux passés à `el()`.

// Le vocabulaire est lu dans la SOURCE de l'API, pas recopié : deux listes qui
// doivent s'accorder finissent toujours par diverger. Ajouter un `appendAudit`
// côté serveur fait rougir ce test tant que la console n'a pas son libellé.
//
// LES DEUX PORTES, ET NON UNE. La garde ne lisait que `handler.js` : les actions
// écrites par la CONSOLE elle-même (`admin.js`) passaient donc au travers, et
// c'est exactement ainsi que `dossier_usager_exporte` et `dossier_usager_efface`
// ont été livrés le 2026-09-05 sans libellé — donc affichés en code brut, avec
// `data-i18n-skip`, invisibles au test i18n.
const HANDLER_SRC = readFileSync(fileURLToPath(new URL('../../api/src/handler.js', import.meta.url)), 'utf8');
const ADMIN_API_SRC = readFileSync(fileURLToPath(new URL('../../api/src/admin.js', import.meta.url)), 'utf8');
const ACTIONS_API = [...new Set(
  [...(HANDLER_SRC + '\n' + ADMIN_API_SRC).matchAll(/\bappendAudit\(\s*'([a-z_]+)'/g)].map((m) => m[1])
)].sort();

test('ADR 0036 — chaque action que l’API écrit a un libellé dans la console, et son anglais', () => {
  assert.ok(ACTIONS_API.length >= 10, 'le vocabulaire a bien été lu dans handler.js : ' + ACTIONS_API.join(', '));

  // Les libellés, lus dans la source de la console — la table n'est pas exportée.
  const bloc = /var AUDIT_LABELS = \{([\s\S]*?)\n  \};/.exec(ADMIN_SRC);
  assert.ok(bloc, 'AUDIT_LABELS introuvable dans admin.js');
  const libelles = new Map(
    [...bloc[1].matchAll(/^\s{4}([a-z_]+):\s*'((?:[^'\\]|\\.)*)',/gm)]
      .map((m) => [m[1], m[2].replace(/\\'/g, "'")])
  );

  const sansLibelle = ACTIONS_API.filter((a) => !libelles.has(a));
  assert.deepEqual(sansLibelle, [], 'actions écrites par l’API que la console afficherait en code brut');

  // Et chaque libellé se traduit : un administrateur anglophone lit un journal,
  // pas un dictionnaire français.
  const I18N = (() => {
    const mod = { exports: {} };
    new Function('module', 'exports', I18N_SRC)(mod, mod.exports);
    return mod.exports;
  })();
  const sansAnglais = [...libelles.values()].filter((v) => !I18N.covered(v));
  assert.deepEqual(sansAnglais, [], 'libellés d’audit sans entrée anglaise');
});

test('ADR 0036 — une entrée publique NOMME son acteur : « système » était la réponse à tout', async () => {
  const jour = today();
  const mk = (id, action, acteur, meta) =>
    ({ id, ts: jour + 'T12:00:00.000Z', day: jour, action, adminId: null, email: null, ip: null, acteur, meta: meta || {} });
  const days = {};
  days[jour] = { jour, entrees: [
    mk('p1', 'document_lu', { type: 'notaire', id: 'me-tremblay' }, { bidId: 'b1', documentId: 'd1', par: 'notaire' }),
    mk('p2', 'client_jeton_emis', { type: 'client', id: 'b1' }, { bidId: 'b1', dateISO: '2026-09-20' }),
    mk('p3', 'partenaire_confirme', { type: 'partenaire', id: 'EVEROY' }, { code: 'EVEROY' }),
    // Un refus anonyme : le type se dit, l'identifiant n'existe pas.
    mk('p4', 'notaire_connexion_refusee', { type: 'notaire', id: null }, { raison: 'jeton_invalide' }),
  ] };
  const { win, doc } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  const entries = [...doc.querySelectorAll('.audit-entry')];
  assert.equal(entries.length, 4);

  // C'EST la régression : avant le correctif, ces quatre lignes disaient toutes
  // « système », parce que la console lisait `e.email` et rien d'autre.
  entries.forEach((e) => {
    assert.ok(!/système/.test(text(e.querySelector('.audit-who'))),
      'une entrée qui porte un acteur ne doit plus se dire « système » : ' + text(e.querySelector('.audit-who')));
  });

  assert.match(text(entries[0].querySelector('.audit-who')), /Notaire/);
  assert.equal(text(entries[0].querySelector('.audit-acteur-id')), 'me-tremblay');
  assert.match(text(entries[1].querySelector('.audit-who')), /Client/);
  assert.equal(text(entries[1].querySelector('.audit-acteur-id')), 'b1');
  assert.match(text(entries[2].querySelector('.audit-who')), /Partenaire/);
  assert.equal(text(entries[2].querySelector('.audit-acteur-id')), 'EVEROY');
  // L'acteur sans identifiant nomme son type et s'arrête là — il n'invente rien.
  assert.match(text(entries[3].querySelector('.audit-who')), /Notaire/);
  assert.equal(entries[3].querySelector('.audit-acteur-id'), null);

  // Et les six actions neuves ne sortent plus en code brut.
  entries.forEach((e) => {
    const a = e.querySelector('.audit-action');
    assert.ok(!/_/.test(text(a)), 'code brut affiché : ' + text(a));
    assert.equal(a.hasAttribute('data-i18n-skip'), false, 'et il se traduit');
  });
});

test('ADR 0036 — un geste d’administration continue de porter son courriel et son IP', async () => {
  // Le correctif ne devait pas régresser l'autre journal : un administrateur
  // est une personne nommée, et son adresse d'origine reste consignée.
  const jour = today();
  const days = {};
  days[jour] = { jour, entrees: [
    { id: 'a1', ts: jour + 'T12:00:00.000Z', day: jour, action: 'acces_modifie',
      adminId: 'ad1', email: 'ops@nota.ca', ip: '24.201.10.4', meta: { cible: 'support@nota.ca' } },
  ] };
  const { win, doc } = await boot(api({ days }), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/audit';
  await waitFor(win, '.audit-entry');
  const who = doc.querySelector('.audit-entry .audit-who');
  assert.match(text(who), /ops@nota\.ca/);
  assert.match(text(who), /24\.201\.10\.4/);
});
