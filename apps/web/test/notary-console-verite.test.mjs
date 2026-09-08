/**
 * La console notaire doit dire la VÉRITÉ, et s'ouvrir sur le bon geste.
 *
 * Deux défauts, trouvés à l'audit du 2026-09-05 :
 *
 *   1. « Vos revenus » se calculait depuis le localStorage
 *      (`nota.notary.retained.v1`), lui-même semé par la liste `retained` du
 *      serveur — qui ne couvre qu'une fenêtre de QUATRE MOIS VERS L'AVANT.
 *      Conséquence : un notaire chevronné qui ouvre la console sur un
 *      navigateur neuf lisait « 0 $ », pendant que `GET /notary/acts` — le
 *      relevé faisant foi, écrit une fois pour toutes dans le registre ACT# —
 *      rendait son historique complet. De l'argent faux à l'écran.
 *
 *   2. À la PREMIÈRE connexion, `rayonKm` vaut 0 par défaut : `notaryCanServe`
 *      ne montre alors que les clients qui se déplacent, donc un fil quasi
 *      vide. Or le panneau de profil est replié, en 8e position, et le film
 *      d'accueil est inatteignable une fois connecté (`maybeShowOnboarding`
 *      sort dès que le rôle n'est plus « anon »). Le notaire arrivait donc
 *      devant un écran vide sans savoir que c'est SON profil qui le vide.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const srcOf = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const DOMAIN_SRC = srcOf('../../../packages/domain/index.js');
const APP_SRC = srcOf('../public/app.js');
const HTML_SRC = srcOf('../public/index.html');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch { /* déjà fermée */ } } });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const firstOfMonth = (iso) => iso.slice(0, 7) + '-01';
const $ = (doc, id) => doc.getElementById(id);
const txt = (n) => (n ? n.textContent : '');

const COTE = {
  cote: 87,
  axes: [
    { id: 'satisfaction', nom: 'Satisfaction des clients', nomEn: 'Client satisfaction', points: 35.6, max: 40, detail: { note: 4.7, avis: 30, notePonderee: 4.6, cible: 4.8 } },
    { id: 'services', nom: 'Services rendus', nomEn: 'Acts delivered', points: 18.1, max: 25, detail: { actes: 40, cible: 50, servicesRendus: 2, catalogue: 2 } },
    { id: 'disponibilite', nom: 'Disponibilité', nomEn: 'Availability', points: 19.2, max: 20, detail: { repondu: 14, declinees: 3, reponses: 17, cibleReponses: 20, rayonKm: 50, urgences: true } },
    { id: 'presence', nom: 'Présence sur Nota', nomEn: 'Presence on Nota', points: 14.1, max: 15, detail: { fiche: true, secteur: true, joursDepuisActivite: 1, joursMembre: 457 } },
  ],
};

// Le relevé faisant foi : deux actes réglés, dont un hors plateforme (une
// CRÉANCE, jamais une part — ADR 0029).
const ACTS = {
  actes: [
    { id: 'a1', dateISO: '2026-06-02', service: 'Refinancement', montant: 2000, honoraires: 1600, prixNota: 400, net: 1600, completedAt: '2026-06-03T12:00:00.000Z', paye: true, du: 0 },
    { id: 'a2', dateISO: '2026-07-14', service: 'Financement', montant: 1800, honoraires: 1400, prixNota: 400, net: 1400, completedAt: '2026-07-15T12:00:00.000Z', paye: false, du: 400 },
  ],
  totaux: { actes: 2, montant: 3800, honoraires: 3000, prixNota: 800, net: 3000, du: 400 },
};

// Un profil COMPLET : ADR 0033 exige nom / téléphone / adresse pour retenir.
const PROFIL_COMPLET = {
  lienCNQ: 'https://www.cnq.org/fiche/x', nom: 'Me Roy', etude: 'Étude Roy',
  telephone: '418 555-0100', adresse: '1 rue Test, Québec', rayonKm: 50, prefixe: 'G1R',
  urgences: true, complet: true, manquants: [],
};
// Un profil NEUF : rien de rempli, rayon 0 — le fil sera vide et c'est pourquoi.
const PROFIL_NEUF = {
  lienCNQ: null, nom: null, etude: null, telephone: null, adresse: null,
  rayonKm: 0, prefixe: null, urgences: false, complet: false,
  manquants: ['nom', 'telephone', 'adresse'],
};

async function boot() {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      // These tests isolate profile completion; the account tour has its own suite.
      window.localStorage.setItem('nota.account-tour.v1.notary.demo%40etude.ca', 'done');
      window.fetch = () => Promise.reject(new Error('offline'));
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  const D = win.NotaDomain;
  win.localStorage.setItem('nota.bids.v1', JSON.stringify(D.makeFixtures(firstOfMonth(todayISO()))));
  win.localStorage.setItem('nota.bids.sig.v1', D.seedSignature());
  win.eval(APP_SRC);
  await wait(50);
  return { win, doc: win.document, D, Nota: win.Nota };
}

function stub(win, { acts = ACTS, actsStatus = 200, profil = PROFIL_COMPLET, bids = [], retained = [] } = {}) {
  const calls = { acts: [], bids: [] };
  win.fetch = (url, init = {}) => {
    const path = String(url);
    const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
    if (path.includes('/notary/session/request')) return json({ ok: true, devToken: 'chal.tok' });
    if (path.includes('/notary/session/verify')) return json({ token: 'sess.tok', feedToken: 'feed.tok', email: 'demo@etude.ca' });
    if (path.includes('/notary/evaluations')) return json({ rating: null, cote: COTE, services: [], evaluations: [] });
    if (path.includes('/notary/acts')) {
      calls.acts.push({ path, headers: init.headers || {} });
      if (actsStatus !== 200) return json({ errors: [{ message: 'nope' }] }, actsStatus);
      return json(acts);
    }
    if (path.includes('/notary/bids')) {
      calls.bids.push({ path });
      return json({ bids, retained, rating: null, profil, cote: COTE });
    }
    return Promise.reject(new Error('offline'));
  };
  return calls;
}

async function signedIn(opts) {
  const ctx = await boot();
  const calls = stub(ctx.win, opts);
  await ctx.Nota.notary.signIn('demo@etude.ca');
  await wait(60);
  return { ...ctx, calls };
}

// ===========================================================================
// 1. « Vos revenus » lit le relevé faisant foi, pas le cache de l'appareil
// ===========================================================================

test('sur un navigateur NEUF, les honoraires viennent du relevé — jamais 0 $', async () => {
  // Rien dans `nota.notary.retained.v1` : exactement un appareil neuf.
  const { doc } = await signedIn();
  await wait(60);

  const box = $(doc, 'notary-earnings');
  const t = txt(box);
  assert.ok(!/Vos honoraires s’afficheront ici/.test(t), 'l’état vide est faux : le serveur a un historique');

  // On lit les TUILES, pas le texte concaténé : « …honoraires2Actes… » colle
  // les valeurs aux libellés, et un test sur la chaîne entière passerait pour
  // de mauvaises raisons.
  const tuiles = {};
  box.querySelectorAll('.nc-stat').forEach((n) => {
    tuiles[txt(n.querySelector('.nc-stat-k'))] = txt(n.querySelector('.nc-stat-v'));
  });
  assert.match(tuiles['Vos honoraires'] || '', /3\s*000/, 'les honoraires du relevé, pas le cache local');
  assert.equal(tuiles['Actes complétés'], '2', 'les deux actes réglés sont comptés');
});

test('le relevé est demandé dès l’ouverture de la console, pas seulement au dépli', async () => {
  // Le panneau « Votre relevé d'actes » est replié ; s'il fallait l'ouvrir pour
  // que les tuiles soient justes, elles seraient fausses jusqu'au clic.
  const { calls } = await signedIn();
  await wait(60);
  assert.ok(calls.acts.length >= 1, 'GET /notary/acts part au chargement');
  assert.match(String(calls.acts[0].headers.authorization || ''), /^Bearer /, 'porté par la session');
});

test('la créance hors plateforme est nommée, jamais fondue dans les honoraires', async () => {
  const { doc } = await signedIn();
  await wait(60);
  const t = txt($(doc, 'notary-earnings')).replace(/ /g, ' ');
  // 3 000 $ d'honoraires : ce que le notaire garde. 800 $ payés à Nota par les
  // clients. Les deux sont des faits distincts et doivent le rester.
  assert.ok(/3 000/.test(t), 'ce qu’il garde');
  assert.ok(/800/.test(t), 'ce que ses clients ont payé à Nota');
});

test('si le relevé est indisponible, l’écran ne CLAME pas zéro', async () => {
  // 500 = panne. Une panne n'est pas « vous n'avez rien gagné » : c'est le
  // défaut qu'on vient de corriger, il ne doit pas revenir par la porte
  // d'erreur (cf. « un test qui affirme ce que le code rend bénit le bogue »).
  const { doc } = await signedIn({ actsStatus: 500 });
  await wait(60);
  const t = txt($(doc, 'notary-earnings'));
  assert.ok(!/^\s*0\s*\$/.test(t), 'aucun zéro inventé');
  assert.ok(/indisponible|Réessayez|impossible/i.test(t), 'la panne se dit');
});

// ===========================================================================
// 2. La première connexion ouvre sur le geste qui débloque le fil
// ===========================================================================

test('profil incomplet : le panneau s’ouvre tout seul et la bannière dit pourquoi le fil est vide', async () => {
  const { doc } = await signedIn({ profil: PROFIL_NEUF, bids: [] });
  await wait(60);

  const panel = $(doc, 'notary-profil');
  assert.equal(panel.open, true, 'le profil s’ouvre : c’est le geste qui débloque tout');

  const banner = $(doc, 'nc-profil-banner');
  assert.equal(banner.hidden, false, 'la bannière est là');
  // Le lien de causalité est CE qui manquait : un fil vide sans explication se
  // lit comme « Nota n'a pas de clients », pas comme « mon profil est vide ».
  assert.ok(/demandes|fil|vide/i.test(txt(banner)), 'elle relie le profil à ce qu’il voit');
});

test('profil complet : rien ne s’ouvre de force — on ne rouvre pas un panneau réglé', async () => {
  const { doc } = await signedIn({ profil: PROFIL_COMPLET });
  await wait(60);
  assert.notEqual($(doc, 'notary-profil').open, true, 'le panneau reste replié');
  assert.equal($(doc, 'nc-profil-banner').hidden, true, 'et la bannière se tait');
});

test('le rayon à 0 est nommé comme la cause du fil vide, même profil complet par ailleurs', async () => {
  // `notaryCanServe` : rayon 0 = « je ne me déplace pas », donc seuls les
  // clients qui viennent à l'étude apparaissent. C'est un réglage légitime,
  // mais il doit être DIT quand le fil est vide, sinon il se lit comme une
  // panne de la plateforme.
  const profil = { ...PROFIL_COMPLET, rayonKm: 0 };
  const { doc } = await signedIn({ profil, bids: [] });
  await wait(60);
  const empty = $(doc, 'notary-open-empty');
  assert.equal(empty.hidden, false, 'l’état vide est affiché');
  assert.ok(/déplac|rayon/i.test(txt(empty)), 'l’écran nomme le rayon comme cause possible');
});
