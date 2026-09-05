/**
 * Tests DOM sans navigateur pour la section « Campagnes » — à qui Nota écrit,
 * et pourquoi celui-là.
 *
 * Deux textes commandent cet écran, et l'écran doit les rendre LISIBLES :
 *   • LCAP (L.C. 2010, ch. 23, art. 6 et 10) — un message COMMERCIAL exige une
 *     base de consentement. Une campagne commerciale n'est pas une notification
 *     transactionnelle, et l'opérateur doit voir laquelle il s'apprête à
 *     envoyer AVANT de l'envoyer.
 *   • Art. 56 1° du Code de déontologie des notaires — inciter quelqu'un « de
 *     façon pressante ou répétée » est dérogatoire. Le plafond de fréquence et
 *     le décompte des exclus sont la réponse produit ; les cacher reviendrait à
 *     ne pas l'appliquer.
 *
 * Même harnais que prix.test.mjs / acces.test.mjs : index.html dans jsdom,
 * admin.js évalué, fetch bouchonné en API admin, assertions sur le DOM rendu.
 * Couvre : l'entrée de rail et sa route, les trois formes de cible, les
 * paramètres de segment bornés, l'ordre imposé (prévisualiser puis envoyer),
 * les exclusions rendues une par une avec leur raison, les avertissements, la
 * confirmation en page qui répète le nombre, le 409 `confirmation_requise`, et
 * la lecture seule sans « campaigns:send ».
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
async function settle(win) { for (let i = 0; i < 4; i++) await wait(5); }

const text = (node) => (node ? node.textContent : '');
const futureISO = () => new Date(Date.now() + 3600000).toISOString();
const click = (win, node) => node.dispatchEvent(new win.Event('click', { bubbles: true }));
const change = (win, node, value) => {
  node.value = value;
  node.dispatchEvent(new win.Event('change', { bubbles: true }));
  node.dispatchEvent(new win.Event('input', { bubbles: true }));
};

// ---------------------------------------------------------------------------
// Charges utiles
// ---------------------------------------------------------------------------

// Le catalogue tel que le contrat HTTP le sert : libellés à plat, paramètres
// en TABLEAU. Le module segments.js, lui, décrit ses paramètres en objet — la
// console lit les deux, faute de quoi elle casserait au premier des deux.
// `limites` voyage avec le catalogue : la console pose les `maxlength` du
// compositeur depuis le serveur, jamais depuis un littéral qui dériverait.
const CAMP_LIMITES = { sujet: 200, preheader: 200, corps: 4000, cta: 60, jetons: ['email'] };

function sampleSegments() {
  return {
    ok: true,
    limites: CAMP_LIMITES,
    segments: [
      {
        id: 'notaires_silencieux',
        libelle: 'Notaires silencieux', libelleEn: 'Silent notaries',
        vise: 'Le notaire qui n’a rien retenu depuis un moment.',
        audience: 'notaire', nature: 'commercial',
        params: [{ nom: 'joursSilence', defaut: 30, min: 7, max: 365 }],
      },
      {
        id: 'clients_signature_proche',
        libelle: 'Clients — signature proche', libelleEn: 'Clients — signing soon',
        vise: 'Le client dont l’offre est encore ouverte alors que la date approche.',
        audience: 'client', nature: 'transactionnel',
        params: [{ nom: 'joursAvant', defaut: 3, min: 0, max: 30 }],
      },
    ],
  };
}

// La même chose, dans la forme que rend describeSegments() côté module.
function sampleSegmentsFormeModule() {
  return {
    ok: true,
    limites: CAMP_LIMITES,
    segments: [
      {
        id: 'notaires_silencieux',
        libelle: { fr: 'Notaires silencieux', en: 'Silent notaries' },
        vise: 'Le notaire qui n’a rien retenu depuis un moment.',
        audience: 'notaire', nature: 'commercial',
        params: {
          joursSilence: { defaut: 30, min: 7, max: 365, libelle: { fr: 'Jours de silence', en: 'Days of silence' } },
        },
      },
    ],
  };
}

// Les groupes RBAC — des paquets de PERMISSIONS. C'est CE bouchon que l'écran
// lisait pour peupler « envoyer à un groupe » : la cible existait à l'écran et
// n'atteignait personne. Il reste ici pour qu'un test puisse vérifier que la
// console ne le lit PLUS.
function sampleGroupesRbac() {
  return { groupes: [{ id: 'soutien', nom: 'Groupe RBAC', description: 'Des permissions.', permissions: ['analytics:read'] }] };
}

// Les groupes d'AUDIENCE — des listes de DESTINATAIRES. La forme que sert
// vraiment `GET /admin/audiences/groups`.
function sampleAudiences() {
  return {
    ok: true,
    groupes: [{
      id: 'pilote', libelle: 'Groupe pilote', audience: 'notaire', nature: 'commercial',
      membres: ['a@etude.ca', 'b@etude.ca'], nbMembres: 2, updatedAt: '2026-09-01T00:00:00.000Z',
    }],
  };
}

function sampleTemplates() {
  return {
    limites: { sujet: 200, preheader: 200, corps: 1200, cta: 60 },
    templates: [
      {
        key: 'notaryReengage', audience: 'notaire', transactionnel: false,
        labelFr: 'Reconquête notaire', labelEn: 'Notary winback',
        defaultSubjectFr: 'On ne vous a pas vu', defaultSubjectEn: 'We have not seen you',
        placeholders: [], override: null,
      },
      {
        key: 'offerPublished', audience: 'client', transactionnel: true,
        labelFr: 'Offre publiée', labelEn: 'Offer posted',
        defaultSubjectFr: 'Votre offre est en ligne', defaultSubjectEn: 'Your offer is live',
        placeholders: [], override: null,
      },
    ],
  };
}

function sampleApercu(over = {}) {
  return Object.assign({
    ok: true,
    total: 34,
    exclus: { desabonnes: 3, sansConsentement: 5, frequence: 2, doublons: 1, sansCourriel: 0 },
    echantillon: ['a•••@etude-roy.ca', 'b•••@notaires-qc.ca'],
    plafond: { limite: 200, depasse: false },
    nature: 'commercial',
    garde: { frequence: 'appliquee', consentement: 'registre' },
    avertissements: [],
  }, over);
}

// Le message que le compositeur écrit — la forme par DÉFAUT de l'écran.
function messageEcrit() {
  return {
    sujetFr: 'On ne vous a pas vu', sujetEn: 'We have not seen you',
    corpsFr: 'Le carnet reçoit des demandes chaque jour.', corpsEn: 'The carnet receives requests every day.',
    ctaFr: '', ctaEn: '', ctaUrl: '',
  };
}

// L'API authentifiée. `permissions` décide ce que l'écran ouvre.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'settings:write', 'notifications:write', 'campaigns:send', 'groups:read', 'audiences:read', 'audiences:write']
    : ['analytics:read']);
  const state = {
    segments: opts.segments || sampleSegments(),
    apercu: opts.apercu || sampleApercu(),
    envoi: opts.envoi || null,
    segmentsStatus: opts.segmentsStatus || 200,
    audiences: opts.audiences || sampleAudiences(),
    audiencesStatus: opts.audiencesStatus || 200,
    destinataires: opts.destinataires || { ok: true, campagneId: 'camp_1', destinataires: [], cursor: null },
    // Les envois passés du jour. Le jour vient du SERVEUR — la console n'en
    // calcule aucun (à 21 h, une tranche UTC dirait demain).
    histoire: opts.histoire || { ok: true, jour: '2026-09-04', campagnes: [] },
  };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/notifications/templates')) return [200, sampleTemplates()];
    if (url.includes('/segments')) return [state.segmentsStatus, state.segmentsStatus === 200 ? state.segments : null];
    // L'ORDRE COMPTE : `/audiences/groups` contient « /groups ». Le bouchon RBAC
    // reste servi sous `/groups` nu, pour qu'un test puisse vérifier que la
    // console ne le lit plus.
    if (url.includes('/audiences/groups')) {
      return [state.audiencesStatus, state.audiencesStatus === 200 ? state.audiences : null];
    }
    if (url.includes('/groups')) return [200, sampleGroupesRbac()];
    if (url.includes('/recipients')) return [200, state.destinataires];
    if (url.includes('/campaigns/preview')) {
      return typeof state.apercu === 'function' ? state.apercu(body) : [200, state.apercu];
    }
    // LE JOURNAL DES ENVOIS PASSÉS — une LECTURE, et surtout pas l'envoi. Ce
    // bouchon répondait à `/campaigns` sans regarder la méthode : un GET y
    // passait pour un POST et « comptait » comme une campagne partie.
    if (url.includes('/campaigns') && method === 'GET') {
      return [200, typeof state.histoire === 'function' ? state.histoire(url) : state.histoire];
    }
    if (url.includes('/campaigns')) {
      if (state.envoi) return typeof state.envoi === 'function' ? state.envoi(body) : state.envoi;
      return [200, { ok: true, envoyes: 34, echoues: 0, echecs: [], registre: { ecrits: 34, echecs: 0 }, exclus: sampleApercu().exclus, campagneId: 'camp_1' }];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// Petits raccourcis d'écran.
const q = (doc, sel) => doc.querySelector(sel);
const boutonCible = (doc, libelle) => [...doc.querySelectorAll('.camp-cible .seg-btn')].find((b) => text(b) === libelle);
// Les deux modes se désignent par leur RANG, pas par leur libellé : l'écran
// anglais dit « Resend a template », et un test qui cherche le français ne
// trouverait rien — sans échouer sur ce qui compte.
const MODE_RANG = { message: 0, gabarit: 1 };
const boutonMode = (doc, mode) => doc.querySelectorAll('.camp-mode .seg-btn')[MODE_RANG[mode]];
// L'écran s'ouvre sur le COMPOSITEUR : une campagne porte sa propre copie.
// Réexpédier un gabarit du registre reste offert — il faut le demander.
const choisirGabarit = (win, doc, key = 'notaryReengage') => {
  const bascule = boutonMode(doc, 'gabarit');
  if (bascule && bascule.getAttribute('aria-pressed') !== 'true') click(win, bascule);
  change(win, q(doc, '[name="templateKey"]'), key);
};
// Écrire une campagne : le parcours par défaut.
const ecrireMessage = (win, doc, over = {}) => {
  const m = Object.assign(messageEcrit(), over);
  Object.keys(m).forEach((nom) => {
    const champ = q(doc, '[name="' + nom + '"]');
    if (champ) change(win, champ, m[nom]);
  });
  return m;
};

async function ouvrir(handler, lang) {
  const ctx = await boot(handler || api(), '#/auth?token=T', lang);
  await waitFor(ctx.win, '.admin-rail');
  ctx.win.location.hash = '#/campagnes';
  await waitFor(ctx.win, '.camp-form');
  return ctx;
}

// ---------------------------------------------------------------------------

test('le rail porte une entrée Campagnes active qui mène à l’écran d’envoi', async () => {
  const { win, doc } = await boot(api(), '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  const links = [...doc.querySelectorAll('.admin-rail-link')];
  const entry = links.find((b) => text(b).includes('Campagnes'));
  assert.ok(entry, 'l’entrée « Campagnes » manque au rail');
  assert.equal(entry.disabled, false, 'l’entrée doit être active');
  const firstDisabled = links.find((b) => b.disabled);
  assert.ok(links.indexOf(entry) < links.indexOf(firstDisabled), 'Campagnes vient avant les entrées désactivées');

  click(win, entry);
  await waitFor(win, '.camp-form');
  assert.equal(win.location.hash, '#/campagnes');
  assert.equal(text(doc.querySelector('.page-title')), 'Campagnes');
  assert.ok(text(doc.querySelector('.admin-rail-link[aria-current="page"]')).includes('Campagnes'));
});

test('l’écran nomme les deux textes qui le commandent : LCAP et art. 56 1°', async () => {
  const { doc } = await ouvrir();
  const cadre = text(q(doc, '.camp-cadre'));
  assert.match(cadre, /LCAP/, 'la loi anti-pourriel est nommée');
  assert.match(cadre, /art\. 56 1°/i, 'et l’article de déontologie aussi');
  assert.match(cadre, /pressante ou répétée/, 'avec les mots de l’article');
});

test('les trois formes de cible : une personne, un groupe, un segment', async () => {
  const { win, doc } = await ouvrir();
  const libelles = [...doc.querySelectorAll('.camp-cible .seg-btn')].map(text);
  assert.deepEqual(libelles, ['Une personne', 'Un groupe', 'Un segment']);

  // Un segment est le point de départ : c'est la forme qui porte des bornes.
  assert.ok(q(doc, '[name="cibleSegment"]'), 'le choix de segment est offert d’abord');
  assert.equal(q(doc, '[name="cibleEmail"]'), null);

  click(win, boutonCible(doc, 'Une personne'));
  await settle(win);
  assert.ok(q(doc, '[name="cibleEmail"]'), 'la cible « personne » demande une adresse');
  assert.equal(q(doc, '[name="cibleSegment"]'), null);

  click(win, boutonCible(doc, 'Un groupe'));
  await settle(win);
  const select = q(doc, '[name="cibleGroupe"]');
  assert.ok(select, 'la cible « groupe » offre la liste des groupes d’AUDIENCE');
  // Le nom de la liste ET son nombre de destinataires : viser une liste sans
  // savoir combien elle contient est exactement ce qu'on refuse à l'aperçu.
  assert.deepEqual([...select.options].map((o) => o.textContent), ['Groupe pilote · 2']);
});

// LA COUTURE. La liste déroulante « Un groupe » était peuplée par
// `GET /admin/groups` — les groupes RBAC, des paquets de PERMISSIONS. Viser
// l'un d'eux ne pouvait atteindre PERSONNE : le serveur cherchait un groupe
// d'audience sous cet identifiant et n'en trouvait aucun. Le bogue tenait
// derrière deux suites vertes parce qu'aucune ne traversait la couture — ce
// test la traverse, en vérifiant l'appel RÉEL que la console fait et le fait
// qu'aucun identifiant RBAC ne peut plus atterrir dans une cible.
test('la cible « groupe » lit les groupes d’AUDIENCE, jamais les groupes RBAC', async () => {
  const { win, doc, calls } = await ouvrir();
  click(win, boutonCible(doc, 'Un groupe'));
  await settle(win);

  assert.ok(calls.some((c) => c.url.includes('/audiences/groups')),
    'la console demande bien la route des groupes d’audience');
  assert.ok(!calls.some((c) => /\/groups$/.test(c.url.replace(/\?.*$/, '')) && !c.url.includes('/audiences/')),
    'et ne demande plus la route RBAC, dont les identifiants n’atteignent personne');

  const select = q(doc, '[name="cibleGroupe"]');
  const valeurs = [...select.options].map((o) => o.value);
  assert.deepEqual(valeurs, ['pilote']);
  assert.ok(!valeurs.includes('soutien'),
    'l’identifiant du groupe RBAC ne doit jamais pouvoir être visé par une campagne');
});

test('sans « audiences:read » la cible « groupe » reste offerte, vide, et nomme la permission qui manque', async () => {
  const handler = api({ permissions: ['analytics:read', 'campaigns:send'] });
  handler.state.audiencesStatus = 403;
  const { win, doc } = await ouvrir(handler);
  click(win, boutonCible(doc, 'Un groupe'));
  await settle(win);
  assert.equal(q(doc, '[name="cibleGroupe"]'), null);
  assert.match(text(q(doc, '.camp-cible-panneau')), /Voir les groupes d’audience/);
});

test('les paramètres d’un segment sont éditables DANS les bornes servies', async () => {
  const { doc } = await ouvrir();
  const input = q(doc, '[name="param-joursSilence"]');
  assert.ok(input, 'le paramètre du segment est un champ, pas un chiffre figé');
  assert.equal(input.value, '30', 'amorcé sur le défaut servi');
  assert.equal(input.getAttribute('min'), '7');
  assert.equal(input.getAttribute('max'), '365');
  // Ce que le segment vise se lit à côté, sinon le paramètre ne veut rien dire.
  assert.match(text(q(doc, '.camp-segment-vise')), /n’a rien retenu/);
});

test('le catalogue est lu aussi dans la forme du module (libelle {fr,en}, params en objet)', async () => {
  const { doc } = await ouvrir(api({ segments: sampleSegmentsFormeModule() }));
  const select = q(doc, '[name="cibleSegment"]');
  assert.deepEqual([...select.options].map((o) => o.textContent), ['Notaires silencieux']);
  const input = q(doc, '[name="param-joursSilence"]');
  assert.equal(input.value, '30');
  assert.equal(input.getAttribute('max'), '365');
});

test('la nature du gabarit se dit dès le choix — et « non déclarée » n’est pas « commercial »', async () => {
  const { win, doc } = await ouvrir();
  // L'écran s'ouvre sur le compositeur : c'est la cible qui décide de la nature.
  assert.match(text(q(doc, '.camp-gabarit-nature')), /nature est celle de la cible/);
  click(win, boutonMode(doc, 'gabarit'));
  await settle(win);
  assert.match(text(q(doc, '.camp-gabarit-nature')), /Aucun gabarit choisi/);
  choisirGabarit(win, doc, 'offerPublished');
  assert.match(text(q(doc, '.camp-gabarit-nature')), /transactionnel/i);
  choisirGabarit(win, doc, 'notaryReengage');
  assert.match(text(q(doc, '.camp-gabarit-nature')), /commercial/i);
  assert.match(text(q(doc, '.camp-gabarit-nature')), /LCAP/);
});

test('aucun envoi n’est possible avant d’avoir vu le décompte', async () => {
  const { win, doc, calls } = await ouvrir();
  const envoyer = q(doc, '.camp-envoyer');
  assert.ok(envoyer, 'le bouton d’envoi reste VISIBLE — la console garde sa forme');
  assert.equal(envoyer.disabled, true, 'mais fermé tant qu’aucun aperçu n’a été vu');
  click(win, envoyer);
  await settle(win);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.includes('/campaigns') && !c.url.includes('preview')).length, 0,
    'aucune campagne ne part sur un bouton fermé');
});

test('la prévisualisation montre ce qui est atteint ET ce qui ne l’est pas, exclusion par exclusion', async () => {
  const { win, doc, calls } = await ouvrir();
  choisirGabarit(win, doc);
  // Aucun gabarit n'est pré-choisi une fois le mode « gabarit » demandé.
  assert.equal(q(doc, '[name="templateKey"]').value, 'notaryReengage');
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');

  // Ce qui est parti sur le fil.
  const prev = calls.find((c) => c.url.includes('/campaigns/preview'));
  assert.equal(prev.method, 'POST');
  assert.deepEqual(prev.body, {
    audience: { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence: 30 } },
    templateKey: 'notaryReengage',
  });

  // Le décompte.
  assert.match(text(q(doc, '.camp-total')), /34/);

  // Les cinq exclusions, TOUTES rendues — y compris celles à zéro : une
  // exclusion qu'on ne voit pas est une exclusion qu'on ne sait pas avoir faite.
  const lignes = [...doc.querySelectorAll('.camp-exclus tbody tr')];
  assert.deepEqual(lignes.map((r) => r.getAttribute('data-exclu')),
    ['sansCourriel', 'doublons', 'desabonnes', 'sansConsentement', 'frequence']);
  const parCle = (cle) => lignes.find((r) => r.getAttribute('data-exclu') === cle);
  assert.match(text(parCle('desabonnes')), /3/);
  assert.match(text(parCle('sansCourriel')), /0/, 'une exclusion à zéro se montre quand même');
  // Chaque ligne porte SA raison, pas une étiquette nue.
  assert.match(text(parCle('frequence')), /56 1°/);
  assert.match(text(parCle('sansConsentement')), /LCAP/);

  // L'échantillon, masqué — reconnaissable, pas expédiable.
  assert.match(text(q(doc, '.camp-echantillon')), /a•••@etude-roy\.ca/);
});

test('l’écran dit laquelle des deux natures il s’apprête à envoyer', async () => {
  const { win, doc } = await ouvrir();
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  const nature = text(q(doc, '.camp-nature'));
  assert.match(nature, /commerciale/i);
  assert.match(nature, /LCAP/, 'et rappelle ce que la LCAP exige d’un message commercial');
  assert.doesNotMatch(nature, /^Notification transactionnelle/);
});

test('une campagne transactionnelle se nomme comme telle', async () => {
  const { win, doc } = await ouvrir(api({ apercu: sampleApercu({ nature: 'transactionnel' }) }));
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  assert.match(text(q(doc, '.camp-nature')), /transactionnelle/i);
});

test('les avertissements du serveur sont rendus — ils disent sur quoi l’envoi repose', async () => {
  const avert = ['Aucun registre de campagnes : le plafond de fréquence n’a pas pu être appliqué.'];
  const { win, doc } = await ouvrir(api({ apercu: sampleApercu({ avertissements: avert }) }));
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  assert.match(text(q(doc, '.camp-avertissements')), /plafond de fréquence n’a pas pu être appliqué/);
});

test('changer la cible périme l’aperçu : le bouton d’envoi se referme', async () => {
  const { win, doc } = await ouvrir();
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  assert.equal(q(doc, '.camp-envoyer').disabled, false, 'l’envoi s’ouvre après l’aperçu');

  click(win, boutonCible(doc, 'Une personne'));
  await settle(win);
  assert.equal(q(doc, '.camp-envoyer').disabled, true, 'un changement de cible referme l’envoi');
  assert.equal(q(doc, '.camp-apercu'), null, 'et retire un décompte qui ne vaut plus');
  assert.match(text(q(doc, '.camp-perime')), /prévisualisez/i);
});

test('l’envoi passe par une confirmation en page qui répète le nombre', async () => {
  const envois = [];
  const handler = api({
    envoi: (body) => { envois.push(body); return [200, { ok: true, envoyes: 34, exclus: sampleApercu().exclus, campagneId: 'camp_9' }]; },
  });
  const { win, doc } = await ouvrir(handler);
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');

  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  const confirm = q(doc, '.camp-confirm');
  assert.ok(confirm && !confirm.hidden, 'la confirmation se pose en page, jamais un confirm() du navigateur');
  assert.match(text(confirm), /34/, 'et répète le nombre');
  assert.equal(envois.length, 0, 'rien n’est parti sur le seul clic');

  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-resultat');
  assert.deepEqual(envois, [{
    audience: { type: 'segment', segmentId: 'notaires_silencieux', params: { joursSilence: 30 } },
    templateKey: 'notaryReengage',
  }]);
  assert.match(text(q(doc, '.camp-resultat')), /34/);
  assert.match(text(q(doc, '.camp-resultat')), /camp_9/, 'l’identifiant de campagne reste lisible pour l’audit');
});

test('un 409 confirmation_requise se dit, et offre de confirmer', async () => {
  const envois = [];
  const handler = api({
    apercu: sampleApercu({ total: 240, plafond: { limite: 200, depasse: true } }),
    envoi: (body) => {
      envois.push(body);
      if (!body.confirme) {
        return [409, { errors: [{ code: 'confirmation_requise', total: 240, limite: 200, message: 'Cette audience compte 240 destinataires (plafond : 200). Confirmez explicitement pour la résoudre.' }] }];
      }
      return [200, { ok: true, envoyes: 240, exclus: sampleApercu().exclus, campagneId: 'camp_x' }];
    },
  });
  const { win, doc } = await ouvrir(handler);
  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  // Le plafond dépassé se lit dès l'aperçu.
  assert.match(text(q(doc, '.camp-plafond')), /200/);
  assert.match(text(q(doc, '.camp-plafond')), /dépass/i);

  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await settle(win);

  const err = q(doc, '.camp-erreur');
  assert.equal(err.hidden, false);
  assert.match(text(err), /Confirmation requise/i);
  const forcer = q(doc, '.camp-forcer');
  assert.ok(forcer, 'une porte explicite est offerte, pas un renvoi à la documentation');

  click(win, forcer);
  await waitFor(win, '.camp-resultat');
  assert.equal(envois.length, 2);
  assert.equal(envois[1].confirme, true, 'le second envoi porte la confirmation explicite');
  assert.match(text(q(doc, '.camp-resultat')), /240/);
});

test('sans « campaigns:send » l’écran reste visible, en lecture seule, et dit pourquoi', async () => {
  const { win, doc, calls } = await ouvrir(api({ permissions: ['analytics:read', 'groups:read'] }));
  assert.match(text(q(doc, '.tpl-readonly-note')), /Lecture seule/);
  assert.ok(q(doc, '.camp-form'), 'le formulaire garde sa forme');
  // Prévisualiser reste ouvert (analytics:read) — c'est l'envoi qui ferme.
  assert.equal(q(doc, '.camp-previsualiser').disabled, false);
  const envoyer = q(doc, '.camp-envoyer');
  assert.equal(envoyer.disabled, true);

  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  assert.equal(q(doc, '.camp-envoyer').disabled, true, 'même après l’aperçu, l’envoi reste fermé');
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.url.includes('/campaigns') && !c.url.includes('preview')).length, 0);
});

test('sans « analytics:read » la prévisualisation elle-même est fermée, et l’écran le dit', async () => {
  const handler = api({ permissions: ['groups:read'] });
  const { doc } = await ouvrir(handler);
  assert.equal(q(doc, '.camp-previsualiser').disabled, true);
  assert.match(text(q(doc, '.camp-form')), /prévisualisation/i);
  // P2-30 — la permission est nommée comme au catalogue, jamais autrement.
  assert.match(text(q(doc, '.camp-form')), /« Lire les tableaux de bord »/);
});

test('P1-11 — un 403 sur le catalogue des segments se lit comme une porte fermée, pas comme une panne à réessayer', async () => {
  const handler = api({ permissions: ['groups:read'] });
  handler.state.segmentsStatus = 403;
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/campagnes';
  await waitFor(win, '.admin-denied');
  assert.equal(q(doc, '.error-banner'), null, 'aucun « Réessayer » mort');
  assert.match(text(q(doc, '.admin-denied')), /Lire les tableaux de bord/);
});

test('une cible « personne » sans adresse est refusée AVANT l’envoi', async () => {
  const { win, doc, calls } = await ouvrir();
  choisirGabarit(win, doc);
  click(win, boutonCible(doc, 'Une personne'));
  await settle(win);
  const avant = calls.length;
  click(win, q(doc, '.camp-previsualiser'));
  await settle(win);
  assert.equal(calls.length, avant, 'rien ne part sans destinataire');
  assert.match(text(q(doc, '.camp-erreur')), /adresse/i);
});

// ---------------------------------------------------------------------------
// LE COMPOSITEUR — une campagne porte SA copie (2026-09-04)
// ---------------------------------------------------------------------------

test('l’écran s’ouvre sur le compositeur : une campagne écrit son propre message', async () => {
  const { doc } = await ouvrir();
  assert.ok(q(doc, '[name="sujetFr"]'), 'le sujet français est un champ, pas un choix de gabarit');
  assert.ok(q(doc, '[name="sujetEn"]'), 'et l’anglais aussi — un courriel Nota porte les deux langues');
  assert.ok(q(doc, '[name="corpsFr"]') && q(doc, '[name="corpsEn"]'));
  assert.equal(q(doc, '[name="templateKey"]'), null, 'le gabarit n’est offert que si on le demande');
  // Les bornes viennent du serveur, jamais d'un littéral de la console.
  assert.equal(q(doc, '[name="sujetFr"]').getAttribute('maxlength'), '200');
  assert.equal(q(doc, '[name="corpsFr"]').getAttribute('maxlength'), '4000');
  // Le jeton permis est nommé — le reste resterait vide dans la boîte du client.
  assert.match(text(q(doc, '.camp-jetons')), /\{\{email\}\}/);
  // Et l'écran dit que rien du registre ne bouge.
  assert.match(text(q(doc, '.camp-message-panneau')), /ne touche à aucun gabarit/);
});

test('le message écrit voyage AVEC la campagne, jamais comme une surcharge de gabarit', async () => {
  const envois = [];
  const handler = api({
    envoi: (body) => { envois.push(body); return [200, { ok: true, envoyes: 34, echoues: 0, echecs: [], registre: { ecrits: 34, echecs: 0 }, exclus: sampleApercu().exclus, campagneId: 'camp_m' }]; },
  });
  const { win, doc, calls } = await ouvrir(handler);
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');

  const prev = calls.find((c) => c.url.includes('/campaigns/preview'));
  assert.equal(prev.body.templateKey, undefined, 'aucun gabarit désigné');
  assert.equal(prev.body.message.sujetFr, 'On ne vous a pas vu');
  assert.equal(prev.body.message.corpsEn, 'The carnet receives requests every day.');

  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-resultat');
  assert.equal(envois[0].message.sujetEn, 'We have not seen you');
  // AUCUN PUT sur un gabarit : l'écran Courriels reste ce qu'il était.
  assert.equal(calls.filter((c) => c.method === 'PUT' && c.url.includes('/notifications/templates')).length, 0);
});

test('une paire à moitié remplie est refusée AVANT le réseau', async () => {
  const { win, doc, calls } = await ouvrir();
  ecrireMessage(win, doc, { sujetEn: '' });
  const avant = calls.length;
  click(win, q(doc, '.camp-previsualiser'));
  await settle(win);
  assert.equal(calls.length, avant, 'rien ne part sur une copie unilingue');
  assert.match(text(q(doc, '.camp-erreur')), /deux langues/i);
});

test('l’aperçu dit sur quoi les deux gardes se sont appuyées', async () => {
  const { win, doc } = await ouvrir();
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  const garde = q(doc, '.camp-garde');
  assert.ok(garde, 'la console ne peut pas affirmer une garantie sans dire d’où elle vient');
  assert.match(text(garde), /registre/i);
  assert.match(text(garde), /56 1°/);
});

test('une base seulement DÉDUITE se distingue d’une base lue au registre', async () => {
  const { win, doc } = await ouvrir(api({
    apercu: sampleApercu({ garde: { consentement: 'deduit', frequence: 'non_verifiee' } }),
  }));
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  const lignes = [...doc.querySelectorAll('.camp-garde-list li')];
  assert.deepEqual(lignes.map((l) => l.getAttribute('data-garde')), ['deduit', 'non_verifiee']);
  assert.match(text(lignes[0]), /DÉDUITE/);
  assert.match(text(lignes[1]), /NON vérifié/);
});

// ---------------------------------------------------------------------------
// L'ÉCHEC QUI SE VOIT, ET QUI A REÇU
// ---------------------------------------------------------------------------

test('zéro destinataire joint ne s’annonce PAS comme une campagne envoyée', async () => {
  const handler = api({
    envoi: [502, {
      errors: [{ code: 'envoi_echoue', message: 'Aucun des 34 destinataires n’a été joint : la campagne n’est PAS partie.' }],
      echecs: [{ courriel: 'roy@etude.ca', raison: 'NOTA_FROM_EMAIL is not configured on the admin Lambda' }],
      campagneId: 'camp_vide',
    }],
  });
  const { win, doc } = await ouvrir(handler);
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-echecs');

  assert.equal(q(doc, '.camp-resultat'), null, 'aucun panneau « Campagne envoyée »');
  assert.match(text(q(doc, '.camp-erreur')), /Aucun destinataire joint/);
  // Le motif RÉEL de l'échec, celui qui dit quoi réparer.
  assert.match(text(q(doc, '.camp-echecs')), /NOTA_FROM_EMAIL/);
  assert.match(text(q(doc, '.camp-echecs')), /roy@etude\.ca/);
});

test('un envoi partiel compte ses échecs à côté de ses succès', async () => {
  const handler = api({
    envoi: [200, {
      ok: true, envoyes: 33, echoues: 1,
      echecs: [{ courriel: 'roy@etude.ca', raison: 'send-failed' }],
      registre: { ecrits: 34, echecs: 0 },
      exclus: sampleApercu().exclus, campagneId: 'camp_p',
    }],
  });
  const { win, doc } = await ouvrir(handler);
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-resultat');
  const resultat = text(q(doc, '.camp-resultat'));
  assert.match(resultat, /33/);
  assert.match(resultat, /Échoués/);
  assert.match(resultat, /send-failed/);
});

test('après l’envoi, l’écran montre QUI a reçu — la ligne, pas seulement le chiffre', async () => {
  const handler = api({
    destinataires: {
      ok: true, campagneId: 'camp_1', cursor: null,
      destinataires: [
        { courriel: 'a@etude.ca', statut: 'envoye', erreur: null, nature: 'commercial', at: '2026-09-02T14:00:00.000Z' },
        { courriel: 'b@etude.ca', statut: 'echoue', erreur: 'send-failed', nature: 'commercial', at: '2026-09-02T14:00:00.000Z' },
      ],
    },
  });
  const { win, doc, calls } = await ouvrir(handler);
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-recus');

  assert.ok(calls.some((c) => c.url.includes('/campaigns/camp_1/recipients')),
    'la console lit le registre par (campagne, destinataire)');
  const lignes = [...doc.querySelectorAll('.camp-recus-table tbody tr')];
  assert.equal(lignes.length, 2);
  assert.match(text(lignes[0]), /a@etude\.ca/);
  assert.equal(lignes[1].getAttribute('data-statut'), 'echoue');
  assert.match(text(lignes[1]), /send-failed/);
});

test('des lignes perdues au registre se disent — « Qui a reçu » sera incomplet', async () => {
  const handler = api({
    envoi: [200, {
      ok: true, envoyes: 34, echoues: 0, echecs: [],
      registre: { ecrits: 30, echecs: 4, frequenceEchecs: 2 },
      exclus: sampleApercu().exclus, campagneId: 'camp_1',
    }],
  });
  const { win, doc } = await ouvrir(handler);
  ecrireMessage(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  click(win, q(doc, '.camp-confirmer'));
  await waitFor(win, '.camp-resultat');
  const alertes = [...doc.querySelectorAll('.camp-registre-manque')].map(text);
  assert.equal(alertes.length, 2, 'deux registres, deux lacunes, deux phrases');
  assert.match(alertes[0], /4/);
  assert.match(alertes[0], /incomplet/i);
  // Le quota est une AUTRE garde : un envoi bien parti dont le plafond n'a pas
  // été inscrit ne se compte pas comme un échec de livraison.
  assert.match(alertes[1], /2/);
  assert.match(alertes[1], /plafond de fréquence/i);
  assert.match(text(q(doc, '.camp-resultat .stat-grid')), /Échoués/);
});

test('un catalogue de segments indisponible montre la bannière de reprise', async () => {
  const handler = api({ segmentsStatus: 500 });
  const { win, doc } = await boot(handler, '#/auth?token=T');
  await waitFor(win, '.admin-rail');
  win.location.hash = '#/campagnes';
  const banner = await waitFor(win, '.error-banner');
  handler.state.segmentsStatus = 200;
  click(win, banner.querySelector('button'));
  await waitFor(win, '.camp-form');
  assert.equal(q(doc, '.error-banner'), null, 'la bannière disparaît après une reprise réussie');
});

test('en anglais, l’écran parle anglais — jusqu’au décompte et à la confirmation', async () => {
  const { win, doc } = await ouvrir(api(), 'en');
  assert.equal(text(doc.querySelector('.page-title')), 'Campaigns');
  assert.deepEqual([...doc.querySelectorAll('.camp-cible .seg-btn')].map(text),
    ['One person', 'A group', 'A segment']);
  assert.match(text(q(doc, '.camp-cadre')), /CASL/, 'la loi anti-pourriel porte son nom anglais');
  assert.equal(text(q(doc, '.camp-previsualiser')), 'Preview');
  assert.equal(text(q(doc, '.camp-envoyer')), 'Send the campaign');

  choisirGabarit(win, doc);
  click(win, q(doc, '.camp-previsualiser'));
  await waitFor(win, '.camp-apercu');
  // L'aperçu — y compris les cinq raisons et la phrase du plafond, qui porte
  // un nombre servi et passe donc par une règle plutôt qu'une entrée exacte.
  assert.match(text(q(doc, '.camp-nature')), /Commercial campaign/);
  assert.match(text(q(doc, '.camp-plafond')), /Audience cap: 200 recipients/);
  const lignes = [...doc.querySelectorAll('.camp-exclus tbody tr')].map(text);
  assert.match(lignes.join(' '), /Unsubscribed/);
  assert.match(lignes.join(' '), /Frequency cap/);
  assert.doesNotMatch(lignes.join(' '), /Désabonnés|Plafond de fréquence/);

  click(win, q(doc, '.camp-envoyer'));
  await settle(win);
  assert.match(text(q(doc, '.camp-confirm')), /Send to 34 recipients\?/);
});
