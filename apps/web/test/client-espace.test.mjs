/**
 * L'ESPACE CLIENT côté navigateur — « je change de téléphone, je retrouve mes
 * demandes ».
 *
 * Avant, « être connecté » comme client voulait dire : une adresse écrite dans
 * le localStorage de CET appareil. Vider son navigateur ou changer de téléphone
 * vidait « Mes offres » — alors que le serveur tenait toujours le dossier
 * (index `CLIENT#<courriel>`, écrit à chaque publication).
 *
 * La séparation qui rend l'ensemble honnête :
 *   • « S'inscrire » reste le geste léger, en deux clics : l'adresse est gardée
 *     sur l'appareil (P1-15), rien n'est promis d'autre.
 *   • « Se connecter » veut dire « j'ai déjà des demandes, rends-les-moi » :
 *     ça demande le lien à usage unique, exactement comme le notaire.
 *   • `#cauth=<jeton>` réhydrate l'appareil : les offres ET leurs jetons.
 *
 * Le jeton ne survit jamais dans l'URL — la barre d'adresse se copie, se
 * partage et s'inscrit dans l'historique.
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const srcOf = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const I18N_SRC = srcOf('../public/i18n.js');
const DOMAIN_SRC = srcOf('../../../packages/domain/index.js');
const APP_SRC = srcOf('../public/app.js');
const HTML_SRC = srcOf('../public/index.html');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Réhydrater ouvre « Mes offres », qui lance un rafraîchissement périodique :
// sans fermer la fenêtre, le processus de test ne rend jamais la main. Même
// hygiène que le harnais de la console admin.
const OPEN = [];
after(() => { for (const w of OPEN) { try { w.close(); } catch (e) { /* déjà fermée */ } } });

async function boot({ fetchStub, hash = '', seed } = {}) {
  const calls = [];
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/' + hash,
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem('nota.lang', 'fr');
      if (seed) Object.keys(seed).forEach((k) => window.localStorage.setItem(k, JSON.stringify(seed[k])));
      window.scrollTo = () => {};
      window.fetch = (url, opts) => {
        calls.push({ url: String(url), opts: opts || {} });
        const r = fetchStub && fetchStub(String(url), opts || {});
        return r || Promise.reject(new Error('offline'));
      };
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  OPEN.push(win);
  win.eval(I18N_SRC);
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(120);
  return { win, doc: win.document, Nota: win.Nota, calls };
}

const $ = (doc, id) => doc.getElementById(id);
const fire = (win, node, type) => node.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));
const ok = (json) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
const stored = (win, k) => { try { return JSON.parse(win.localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

const OFFRES = [
  { id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2000, status: 'ouverte', clientToken: 'TOK-1' },
  { id: 'b2', dateISO: '2026-12-15', serviceId: 'refinancement', montant: 2400, status: 'ouverte', clientToken: 'TOK-2' },
];

// ===========================================================================
// 1. « Se connecter » demande le lien — il ne prétend jamais nous connecter
// ===========================================================================

test('un client qui se CONNECTE demande le lien, et l’écran ne le dit pas connecté', async () => {
  const { win, doc, Nota, calls } = await boot({ fetchStub: () => ok({ ok: true }) });

  $(doc, 'header-login').click();
  $(doc, 'auth-email').value = 'roy@exemple.ca';
  fire(win, $(doc, 'auth-email-form'), 'submit');
  await wait(30);

  const req = calls.filter((c) => c.url.includes('/client/session/request'));
  assert.equal(req.length, 1, 'le lien est demandé');
  assert.equal(JSON.parse(req[0].opts.body).courriel, 'roy@exemple.ca');

  // Le défaut à ne pas reproduire : se déclarer connecté sans preuve de boîte.
  assert.equal(Nota.account.role(), 'anon', 'demander un lien ne connecte personne');
  assert.ok(
    !calls.some((c) => c.url.includes('/client/welcome')),
    'une connexion n’est pas une inscription'
  );
});

test('« S’inscrire » garde le geste léger : deux clics, l’adresse sur l’appareil', async () => {
  const { win, doc, Nota, calls } = await boot({ fetchStub: () => ok({ ok: true }) });

  $(doc, 'header-signup').click();
  $(doc, 'auth-email').value = 'nouveau@client.ca';
  fire(win, $(doc, 'auth-email-form'), 'submit');
  await wait(30);

  assert.equal(Nota.account.role(), 'client', 'connecté sur cet appareil, au second clic');
  assert.ok(calls.some((c) => c.url.includes('/client/welcome')), 'le courriel de bienvenue part');
  assert.ok(
    !calls.some((c) => c.url.includes('/client/session/request')),
    's’inscrire n’envoie pas un lien de reprise'
  );
});

// ===========================================================================
// 2. Le lien réhydrate l'appareil
// ===========================================================================

test('#cauth= rend les offres ET leurs jetons à un appareil vierge', async () => {
  const { win, doc, Nota } = await boot({
    hash: '#cauth=JETON',
    fetchStub: (url) => (url.includes('/client/session/verify')
      ? ok({ ok: true, courriel: 'roy@exemple.ca', offres: OFFRES })
      : ok({ ok: true, bids: [] })),
  });
  await wait(60);

  const mine = stored(win, 'nota.myoffers.v1') || [];
  assert.equal(mine.length, 2, 'les deux demandes sont revenues');
  assert.deepEqual(mine.map((o) => o.id).sort(), ['b1', 'b2']);
  // Sans le jeton, la ligne serait morte : impossible de lire ou de répondre.
  assert.deepEqual(mine.map((o) => o.clientToken).sort(), ['TOK-1', 'TOK-2']);
  assert.equal(mine[0].dateISO, '2026-12-01', 'la date voyage avec');
  assert.equal(mine[0].serviceId, 'refinancement', 'le service aussi');

  // L'adresse prouvée devient l'identité de l'appareil.
  assert.equal(Nota.account.role(), 'client');
  assert.equal((stored(win, 'nota.profile.v1') || {}).courriel, 'roy@exemple.ca');
  assert.equal(doc.getElementById('acct-email').textContent, 'roy@exemple.ca');
});

test('le jeton ne reste JAMAIS dans la barre d’adresse', async () => {
  const { win } = await boot({
    hash: '#cauth=JETON',
    fetchStub: (url) => (url.includes('/client/session/verify')
      ? ok({ ok: true, courriel: 'roy@exemple.ca', offres: OFFRES })
      : ok({ ok: true, bids: [] })),
  });
  await wait(60);
  assert.ok(!win.location.hash.includes('cauth'), 'le hash est nettoyé');
  assert.ok(!win.location.href.includes('JETON'), 'et le jeton avec');
});

test('un lien mort ne vide pas l’appareil et le dit', async () => {
  const seed = { 'nota.myoffers.v1': [{ id: 'deja', dateISO: '2026-11-01', serviceId: 'refinancement', clientToken: 'GARDE' }] };
  const { win, doc } = await boot({
    hash: '#cauth=PERIME',
    seed,
    fetchStub: (url) => (url.includes('/client/session/verify')
      ? Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ errors: [{ code: 'lien_invalide', message: 'Lien invalide ou expiré.' }] }) })
      : ok({ ok: true, bids: [] })),
  });
  await wait(60);

  const mine = stored(win, 'nota.myoffers.v1') || [];
  assert.equal(mine.length, 1, 'ce que l’appareil avait déjà reste');
  assert.equal(mine[0].id, 'deja');
  assert.ok(/expir|invalide/i.test(doc.body.textContent), 'et l’écran dit que le lien est mort');
});

test('une reprise fusionne : elle n’écrase pas une offre déjà connue', async () => {
  // L'appareil connaît b1 avec un statut local ; le serveur renvoie b1 + b2.
  const seed = { 'nota.myoffers.v1': [{ id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', clientToken: 'VIEUX', retained: true }] };
  const { win } = await boot({
    hash: '#cauth=JETON',
    seed,
    fetchStub: (url) => (url.includes('/client/session/verify')
      ? ok({ ok: true, courriel: 'roy@exemple.ca', offres: OFFRES })
      : ok({ ok: true, bids: [] })),
  });
  await wait(60);

  const mine = stored(win, 'nota.myoffers.v1') || [];
  assert.equal(mine.length, 2, 'aucune ligne en double');
  const b1 = mine.filter((o) => o.id === 'b1')[0];
  assert.equal(b1.clientToken, 'TOK-1', 'le jeton frais du serveur gagne');
  assert.equal(b1.retained, true, 'mais le progrès local survit');
});

// ===========================================================================
// 3. LA DÉCONNEXION EFFACE VRAIMENT — appareil partagé
// ===========================================================================
// Le geste promettait « vos coordonnées, vos offres publiées, votre dossier et
// vos notifications » et n'effaçait que QUATRE clés sur la douzaine que le
// client possède. Restaient notamment `nota.offerstatus.v1` — qui met en cache
// le nom et le courriel du notaire retenu, le CORPS des messages, l'état de la
// caution et les chiffres d'annulation — et `nota.docitems.v1`, qui nomme ses
// documents. Sur un poste partagé, « se déconnecter » laissait tout ça derrière.

const CLES_CLIENT = [
  'nota.profile.v1', 'nota.myoffers.v1', 'nota.dossier.v1', 'nota.notifs.v1',
  'nota.offerstatus.v1', 'nota.seen.v1', 'nota.docitems.v1', 'nota.checkout.v1',
  'nota.support.v1', 'nota.role.v1',
];

test('se déconnecter n’abandonne RIEN du client sur l’appareil', async () => {
  const seed = {};
  // Chaque clé prend une forme PLAUSIBLE : les listes en tableau, le reste en
  // objet. Un bouchon mal formé ferait échouer le test pour la mauvaise raison.
  CLES_CLIENT.forEach((k) => { seed[k] = { marqueur: k }; });
  // Les clés en LISTE prennent une entrée bien formée : le boot les parcourt
  // vraiment (mois, dates), et un bouchon creux ferait échouer le test pour la
  // mauvaise raison.
  seed['nota.myoffers.v1'] = [{ id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2000, clientToken: 'TOK-1' }];
  seed['nota.notifs.v1'] = [{ key: 'k1', kind: 'reminders', title: 'Test', dateISO: '2026-12-01' }];
  seed['nota.role.v1'] = 'client';
  // Deux clés qui n'appartiennent PAS à la session client : elles doivent
  // survivre. Le notaire a sa propre déconnexion ; le code partenaire est une
  // identité distincte, avec sa propre reprise par courriel.
  seed['nota.notary.token'] = 'jeton-notaire';
  seed['nota.partner.v1'] = { code: 'MARIE' };

  const { win, Nota } = await boot({ seed, fetchStub: () => ok({ ok: true }) });
  win.confirm = () => true;
  Nota.account.signOut();
  await wait(40);

  const restes = CLES_CLIENT.filter((k) => win.localStorage.getItem(k) !== null);
  assert.deepEqual(restes, [], 'aucune clé du client ne survit');
  assert.equal(Nota.account.role(), 'anon', 'et la session est bien close');

  assert.match(win.localStorage.getItem('nota.notary.token') || '', /jeton-notaire/, 'la session notaire n’est pas touchée');
  assert.ok(win.localStorage.getItem('nota.partner.v1'), 'le code partenaire non plus');
});

test('la question posée avant d’effacer nomme ce qui part vraiment', async () => {
  let demande = '';
  const { win, Nota } = await boot({ fetchStub: () => ok({ ok: true }) });
  win.confirm = (m) => { demande = String(m); return false; };
  Nota.account.signOut();
  // Le cache de statut porte le nom du notaire et le corps des messages : la
  // phrase doit le dire, sinon elle promet moins que ce qu'elle fait.
  assert.ok(/message|notaire|échange/i.test(demande), 'la phrase nomme les échanges');
});

test('refuser la question n’efface rien', async () => {
  const seed = { 'nota.myoffers.v1': [{ id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement' }] };
  const { win, Nota } = await boot({ seed, fetchStub: () => ok({ ok: true }) });
  win.confirm = () => false;
  Nota.account.signOut();
  await wait(20);
  assert.ok(win.localStorage.getItem('nota.myoffers.v1'), 'l’offre est toujours là');
});

// ===========================================================================
// 4. LE DOSSIER REVIENT AVEC L'OFFRE
// ===========================================================================

test('le dossier rendu par le serveur réhydrate la liste de documents', async () => {
  const seed = { 'nota.myoffers.v1': [{ id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', clientToken: 'TOK-1' }] };
  const { win } = await boot({
    seed,
    fetchStub: (url) => (url.includes('/client/bid')
      ? ok({
        bid: { id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2000, status: 'ouverte' },
        dossier: { piece_identite: 'permis-2019.pdf' },
        propositions: [], demandes: [], messages: [], documents: [], readiness: null,
        lecture: { notaire: null }, notaire: null, acte: null,
      })
      : ok({ ok: true, bids: [] })),
  });
  await wait(120);

  const d = stored(win, 'nota.dossier.v1') || {};
  const pour = d.refinancement || {};
  assert.equal(pour.piece_identite, 'permis-2019.pdf', 'la réponse déjà donnée est revenue');
});

test('un dossier vide venu du serveur n’EFFACE pas ce que l’appareil savait', async () => {
  // Le serveur ne connaît que ce qui a été poussé ; l'appareil peut être en
  // avance. Un objet vide ne doit donc jamais valoir « efface tout ».
  const seed = {
    'nota.myoffers.v1': [{ id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', clientToken: 'TOK-1' }],
    'nota.dossier.v1': { refinancement: { compte_taxes: 'taxes-local.pdf' } },
  };
  const { win } = await boot({
    seed,
    fetchStub: (url) => (url.includes('/client/bid')
      ? ok({
        bid: { id: 'b1', dateISO: '2026-12-01', serviceId: 'refinancement', montant: 2000, status: 'ouverte' },
        dossier: {},
        propositions: [], demandes: [], messages: [], documents: [], readiness: null,
        lecture: { notaire: null }, notaire: null, acte: null,
      })
      : ok({ ok: true, bids: [] })),
  });
  await wait(120);
  const pour = (stored(win, 'nota.dossier.v1') || {}).refinancement || {};
  assert.equal(pour.compte_taxes, 'taxes-local.pdf', 'le travail local survit');
});

test('le profil n’affiche que les pièces correspondant aux réponses de l’acte actif', async () => {
  const seed = {
    'nota.myoffers.v1': [{ id: 'fin-1', dateISO: '2026-12-01', serviceId: 'financement', clientToken: 'TOK-FIN' }],
    'nota.dossier.v1': {
      financement: {
        __pricing: {
          contexte: 'propriete_detenue',
          assurance_habitation: 'oui',
          certificat_localisation: 'a_jour',
          succession: 'non',
        },
      },
    },
  };
  const { doc, Nota } = await boot({ seed, fetchStub: () => ok({ ok: true }) });
  Nota.setTab('profil');
  await wait(40);

  const card = doc.querySelector('.profil-docs');
  assert.ok(card, 'la carte des documents est visible');
  assert.equal(card.querySelector('.chip[data-svc="financement"]').getAttribute('aria-pressed'), 'true', 'l’acte actif est sélectionné');
  const names = [...card.querySelectorAll('.doc-row-name')].map((n) => n.textContent);
  assert.ok(!names.some((n) => /promesse/i.test(n)), 'la promesse d’achat absente du contexte n’est jamais demandée');
  assert.ok(names.length > 0, 'les pièces et informations réellement applicables restent visibles');
});

test('email preference link opens controls and persists the chosen email types', async () => {
  let saved;
  const { win, doc } = await boot({
    hash: '#email-preferences=SIGNED',
    fetchStub(url, opts) {
      if (!url.includes('/notification-preferences')) return null;
      assert.equal(opts.headers.authorization, 'Bearer SIGNED');
      if (opts.method === 'POST') saved = JSON.parse(opts.body).preferences;
      return ok({ catalog: [
        { key: 'offerPublished', labelFr: 'Offre publiée', labelEn: 'Offer posted', required: false },
        { key: 'clientMagicLink', labelFr: 'Lien de connexion', labelEn: 'Sign-in link', required: true },
      ], preferences: {} });
    },
  });
  const dialog = doc.getElementById('email-preferences-dialog');
  assert.ok(dialog.open);
  assert.equal(win.location.hash, '', 'the signed identity is removed from the URL');
  const inputs = dialog.querySelectorAll('input[type=checkbox]');
  assert.equal(inputs[1].disabled, true);
  inputs[0].checked = false;
  fire(win, dialog.querySelector('form'), 'submit');
  await wait(30);
  assert.deepEqual(saved, { offerPublished: false, clientMagicLink: true });
  assert.match(dialog.textContent, /Préférences de courriel enregistrées/);
});
