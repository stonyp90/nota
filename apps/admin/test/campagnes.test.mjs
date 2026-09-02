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
function sampleSegments() {
  return {
    ok: true,
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

function sampleGroupes() {
  return { groupes: [{ id: 'pilote', nom: 'Groupe pilote', description: 'Les dix premiers notaires.', permissions: [] }] };
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
    avertissements: [],
  }, over);
}

// L'API authentifiée. `permissions` décide ce que l'écran ouvre.
function api(opts = {}) {
  const role = opts.role || 'super_admin';
  const permissions = opts.permissions || (role === 'super_admin'
    ? ['analytics:read', 'pii:read', 'settings:write', 'notifications:write', 'campaigns:send', 'groups:read']
    : ['analytics:read']);
  const state = {
    segments: opts.segments || sampleSegments(),
    apercu: opts.apercu || sampleApercu(),
    envoi: opts.envoi || null,
    segmentsStatus: opts.segmentsStatus || 200,
  };
  const handler = (method, url, body) => {
    if (url.includes('/auth/verify')) return [200, { ok: true, session: 'sess', expiresAt: futureISO(), role }];
    if (url.includes('/auth/refresh')) return [200, { ok: true, session: 'sess2', expiresAt: futureISO() }];
    if (url.endsWith('/me')) return [200, { email: 'ops@nota.ca', role, permissions }];
    if (url.includes('/metrics/overview')) return [200, { kpis: {}, gauge: {}, series: { offersPerDay: [], byService: [] } }];
    if (url.includes('/notifications/templates')) return [200, sampleTemplates()];
    if (url.includes('/segments')) return [state.segmentsStatus, state.segmentsStatus === 200 ? state.segments : null];
    if (url.includes('/groups')) return [200, sampleGroupes()];
    if (url.includes('/campaigns/preview')) {
      return typeof state.apercu === 'function' ? state.apercu(body) : [200, state.apercu];
    }
    if (url.includes('/campaigns')) {
      if (state.envoi) return typeof state.envoi === 'function' ? state.envoi(body) : state.envoi;
      return [200, { ok: true, envoyes: 34, exclus: sampleApercu().exclus, campagneId: 'camp_1' }];
    }
    return [404, null];
  };
  handler.state = state;
  return handler;
}

// Petits raccourcis d'écran.
const q = (doc, sel) => doc.querySelector(sel);
const boutonCible = (doc, libelle) => [...doc.querySelectorAll('.camp-cible .seg-btn')].find((b) => text(b) === libelle);
// Aucun gabarit n'est pré-choisi : chaque parcours désigne le sien.
const choisirGabarit = (win, doc, key = 'notaryReengage') => change(win, q(doc, '[name="templateKey"]'), key);

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
  assert.ok(select, 'la cible « groupe » offre la liste des groupes');
  assert.deepEqual([...select.options].map((o) => o.textContent), ['Groupe pilote']);
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
  assert.equal(calls.filter((c) => c.url.includes('/campaigns') && !c.url.includes('preview')).length, 0,
    'aucune campagne ne part sur un bouton fermé');
});

test('la prévisualisation montre ce qui est atteint ET ce qui ne l’est pas, exclusion par exclusion', async () => {
  const { win, doc, calls } = await ouvrir();
  // Aucun gabarit n'est pré-choisi : le parcours en désigne un.
  assert.equal(q(doc, '[name="templateKey"]').value, '', 'aucune campagne ne part sur un défaut');
  choisirGabarit(win, doc);
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
  assert.equal(calls.filter((c) => c.url.includes('/campaigns') && !c.url.includes('preview')).length, 0);
});

test('sans « analytics:read » la prévisualisation elle-même est fermée, et l’écran le dit', async () => {
  const { doc } = await ouvrir(api({ permissions: ['groups:read'] }));
  assert.equal(q(doc, '.camp-previsualiser').disabled, true);
  assert.match(text(q(doc, '.camp-form')), /prévisualisation/i);
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
