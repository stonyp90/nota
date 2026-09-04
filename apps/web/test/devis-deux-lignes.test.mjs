/**
 * LE DEVIS — ce que le client paiera vraiment, affiché avant qu'il ne s'engage.
 *
 * Depuis l'ADR 0031, la carte du client autorise le TOTAL de deux lignes : les
 * honoraires offerts au notaire, qui lui reviennent en entier, et le prix du
 * service de Nota. La seconde n'était affichée nulle part : le client la
 * découvrait sur la page de paiement.
 *
 *   Art. 68 C.déont. — « Le notaire ne doit faire ni permettre que soit faite,
 *   par quelque moyen que ce soit, aucune publicité fausse, trompeuse,
 *   INCOMPLÈTE ou susceptible d'induire en erreur. »
 *   Art. 71 3° — qui annonce des honoraires doit « indiquer si les débours et
 *   les taxes sont ou non inclus ».
 *   Art. 32 C.déont. / art. 32.1 2° L.N. — le notaire ne partage pas ses
 *   honoraires : le devis montre DEUX ACHATS, jamais un partage. Le vocabulaire
 *   compte autant que le chiffre.
 *
 * Le devis vit dans l'étape du montant, sans un clic de plus : il bouge avec le
 * curseur, là où la décision se prend.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const domain = require('@nota/domain');

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (doc, id) => doc.getElementById(id);
const todayISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

// ADR 0034 — le serveur annonce une GRILLE : une ligne par service, plus la
// garantie de date. Le devis lit la cellule de SON service à SA date, jamais un
// nombre unique — et jamais un nombre en dur, ici pas plus qu'à l'écran.
const GRILLE = domain.prixNotaGrille();
const TARIF = {
  grille: GRILLE,
  prixNotaMinCents: GRILLE.defaut,
  taxesIncluses: false,
  deboursInclus: false,
};
const prixCents = (serviceId, tierId) => domain.prixNota(serviceId, tierId, GRILLE);

async function boot({ enLigne = true, tarif } = {}) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (url) => {
        if (!enLigne) return Promise.reject(new Error('offline'));
        if (String(url).includes('/bids?month=')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              month: String(url).split('month=')[1],
              bids: [],
              tarif: tarif !== undefined ? tarif : TARIF,
            }),
          });
        }
        return Promise.reject(new Error('route non simulée'));
      };
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) {
        window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      }
      if (!window.HTMLDialogElement.prototype.close) {
        window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      }
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document, D: win.NotaDomain };
}

// Six jours : le palier « prioritaire » du domaine — une date rapprochée, donc
// une garantie de date facturée sur SA propre ligne (ADR 0034).
async function ouvrirRefinancement(doc, { jours = 6 } = {}) {
  const iso = addDays(todayISO(), jours);
  doc.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(30);
  return iso;
}

// Le prix que le devis DOIT afficher pour une offre ouverte à `jours` de la
// date du jour — calculé par le domaine, comme le fait l'écran.
const prixAttendu = (serviceId, jours) => prixCents(serviceId, domain.tierForDays(jours));

const montant = (doc) => Number($(doc, 'o-amount').value);

test('ART. 68 — le devis annonce les DEUX lignes et le total avant tout paiement', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);

  const devis = $(doc, 'offer-devis');
  assert.ok(devis, 'le devis existe dans le parcours');
  assert.equal(devis.hidden, false, 'et il est visible dès qu’un montant est proposé');

  const offert = montant(doc);
  const p = prixAttendu('refinancement', 6);
  assert.ok(offert > 0, 'le montant est pré-rempli');
  assert.equal($(doc, 'devis-hon').textContent, doc.defaultView.NotaDomain.money(offert));
  assert.equal($(doc, 'devis-nota').textContent, doc.defaultView.NotaDomain.money(p.serviceCents / 100));
  assert.equal($(doc, 'devis-total').textContent,
    doc.defaultView.NotaDomain.money(offert + p.totalCents / 100),
    'le total est exactement ce que la carte autorisera');
});

// --- ADR 0034 : la grille, ligne par ligne ----------------------------------

test('ADR 0034 — la ligne Nota est celle du SERVICE choisi, jamais un prix unique', async () => {
  const { doc, win } = await boot();
  await ouvrirRefinancement(doc);
  assert.equal($(doc, 'devis-nota').textContent,
    win.NotaDomain.money(prixCents('refinancement', 'prioritaire').serviceCents / 100));

  // Le même parcours sur l'autre service du catalogue : le prix change, parce
  // que c'est un autre service — jamais parce que l'acte vaut plus cher.
  doc.querySelector('#o-service-chips .chip[data-svc="financement"]').click();
  await wait(40);
  assert.equal($(doc, 'devis-nota').textContent,
    win.NotaDomain.money(prixCents('financement', 'prioritaire').serviceCents / 100));
});

test('ART. 49 4° — la garantie de date est une ligne PROPRE À NOTA, distincte des honoraires', async () => {
  const { doc, win } = await boot();
  await ouvrirRefinancement(doc); // 6 jours → prioritaire
  const ligne = $(doc, 'devis-date-l');
  assert.equal(ligne.hidden, false, 'une date rapprochée porte sa ligne');
  assert.equal($(doc, 'devis-date').textContent,
    win.NotaDomain.money(prixCents('refinancement', 'prioritaire').dateCents / 100));
  // Elle est nommée pour ce qu'elle est : ce que NOTA vend, pas un supplément
  // d'honoraires du notaire (que l'art. 49 4° lui laisse fixer lui-même).
  assert.match($(doc, 'devis-date-k').textContent, /date/i);
});

test('à échéance normale, la ligne de garantie de date disparaît — elle ne se paie pas', async () => {
  const { doc } = await boot();
  // La première date « standard » réellement offrable : on avance de mois en
  // mois jusqu'à la trouver, plutôt que de parier sur le calendrier du jour.
  let cell = null;
  for (let saut = 0; saut < 3 && !cell; saut += 1) {
    if (saut) { $(doc, 'cal-next').click(); await wait(40); }
    cell = [...doc.querySelectorAll('.cal-cell[data-date]')].find(
      (c) => domain.tierForDays(
        Math.round((Date.parse(c.dataset.date + 'T00:00:00Z') - Date.parse(todayISO() + 'T00:00:00Z')) / 864e5),
      ) === 'standard',
    );
  }
  assert.ok(cell, 'une date à échéance normale est offrable');
  cell.click();
  await wait(40);
  doc.querySelector('#o-service-chips .chip[data-svc="refinancement"]').click();
  await wait(40);

  assert.equal($(doc, 'devis-date-l').hidden, true, 'aucune garantie de date à payer');
  const offert = montant(doc);
  assert.equal($(doc, 'devis-total').textContent,
    doc.defaultView.NotaDomain.money(offert + prixCents('refinancement', 'standard').totalCents / 100));
});

test('le total EST la somme des lignes affichées — rien ne se cache entre elles', async () => {
  const { doc, win } = await boot();
  await ouvrirRefinancement(doc);
  const lire = (id) => Number($(doc, id).textContent.replace(/[^\d]/g, ''));
  assert.equal(lire('devis-total'), lire('devis-hon') + lire('devis-nota') + lire('devis-date'));
  assert.ok(win, 'jsdom en vie');
});

test('ART. 32.1 2° — le devis DIT que le notaire garde 100 % de ses honoraires', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);
  // La phrase est écrite là où le client décide, pas dans une page d'aide :
  // c'est la revendication vérifiable du modèle, et elle doit être lisible au
  // moment exact où la carte va être engagée.
  assert.match($(doc, 'offer-devis').textContent, /100\s*% de ses honoraires/);
});

test('le devis suit le curseur — il ne peut jamais mentir d’un cran', async () => {
  const { win, doc } = await boot();
  await ouvrirRefinancement(doc);

  const slider = $(doc, 'o-amount');
  slider.value = String(Number(slider.max));
  slider.dispatchEvent(new win.Event('input', { bubbles: true }));
  await wait(20);

  const offert = montant(doc);
  assert.equal($(doc, 'devis-hon').textContent, win.NotaDomain.money(offert));
  assert.equal($(doc, 'devis-total').textContent,
    win.NotaDomain.money(offert + prixAttendu('refinancement', 6).totalCents / 100));
});

test('ART. 71 3° — le devis dit que les taxes et les débours sont en sus', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);
  const note = $(doc, 'devis-note').textContent;
  assert.match(note, /[Tt]axes en sus/);
  assert.match(note, /[Dd]ébours en sus/);
  assert.match(note, /RDPRM|droits de publication/);
});

test('ART. 32 — le devis ne décrit jamais un partage', async () => {
  const { doc } = await boot();
  await ouvrirRefinancement(doc);
  const texte = $(doc, 'offer-devis').textContent
    // La seule occurrence tolérée d'un « % » est la revendication de l'ADR
    // 0034 : le notaire garde 100 % de SES honoraires. C'est l'inverse d'un
    // partage, et le seul pourcentage que le devis ait le droit de porter.
    .replace(/Le notaire garde 100\s*% de ses honoraires\./g, '');
  assert.equal(/commission|partage|% |part de/i.test(texte), false,
    'deux achats distincts, jamais une part retenue sur les honoraires du notaire');
  assert.match($(doc, 'devis-hon-k').textContent, /[Hh]onoraires/,
    'la première ligne nomme les honoraires du notaire');
});

test('hors ligne, le devis n’invente aucun montant', async () => {
  const { doc } = await boot({ enLigne: false });
  await ouvrirRefinancement(doc);

  assert.equal($(doc, 'devis-nota').textContent, '—', 'aucun prix inventé');
  assert.equal($(doc, 'devis-total').textContent, '—');
  assert.match($(doc, 'devis-note').textContent, /s’ajoute à ce montant/,
    'mais le client sait qu’un prix s’ajoutera');
});

test('un serveur qui n’annonce pas de tarif ne fait pas tomber le parcours', async () => {
  const { doc } = await boot({ tarif: null });
  await ouvrirRefinancement(doc);
  assert.equal($(doc, 'offer-devis').hidden, false);
  assert.equal($(doc, 'devis-nota').textContent, '—');
});

test('LOI DES TROIS CLICS — de l’accueil à l’offre publiable sans clic de plus', async () => {
  const { win, doc } = await boot();
  const fire = (el, type) => el.dispatchEvent(new win.Event(type, { bubbles: true }));

  // 1er clic : la date au calendrier. 2e clic : l'acte.
  await ouvrirRefinancement(doc);
  // Le devis est déjà là — il n'a coûté aucun clic.
  assert.equal($(doc, 'offer-devis').hidden, false,
    'le devis se lit AVANT toute saisie, sans un clic de plus');

  // Les réponses obligatoires ne sont pas des clics de navigation : ce sont
  // les questions du notaire, et le devis reste visible pendant qu'on y répond.
  const lv = $(doc, 'crit-valeur_pret'); lv.value = '300000'; fire(lv, 'input');
  $(doc, 'crit-approbation_bancaire__obtenue').click();
  const p = $(doc, 'crit-preteur'); p.value = 'banque_nationale'; fire(p, 'change');
  const pre = $(doc, 'o-prefix'); pre.value = 'G1R'; fire(pre, 'input');
  // L'identité (ADR 0033) est une saisie, pas un clic : le notaire qui retient
  // doit pouvoir nommer et écrire au client.
  const nom = $(doc, 'o-name'); nom.value = 'Prénom Nom'; fire(nom, 'input');
  const em = $(doc, 'o-courriel'); em.value = 'client@exemple.ca'; fire(em, 'input');
  await wait(20);

  assert.equal($(doc, 'offer-devis').hidden, false, 'le devis ne disparaît jamais');
  // 3e clic : publier.
  assert.equal($(doc, 'offer-submit').disabled, false,
    'la publication est atteignable au troisième clic');
});

// ---------------------------------------------------------------------------
// LA COPIE DU MODÈLE — ce que la page AFFIRME au client doit rester vrai
// ---------------------------------------------------------------------------
//
// Le défaut que ce garde-fou existe pour attraper : l'ADR 0034 a fait varier le
// prix de Nota par SERVICE et par PALIER DE DÉLAI, et quatre surfaces ont
// continué d'affirmer au client qu'il s'agissait d'« un montant fixe, identique
// pour tous » — dont les conditions d'utilisation, qui sont un engagement
// contractuel, et llms.txt, publié exprès pour que les assistants citent Nota
// juste. Le test i18n ne scanne que la COUVERTURE des chaînes, jamais leur
// véracité : rien en CI ne l'attrapait.
//
// L'art. 68 du Code de déontologie interdit la publicité « incomplète » : une
// page qui décrit le modèle avec un axe de variation en moins l'est exactement.

const LLMS_SRC = readFileSync(fileURLToPath(new URL('../public/llms.txt', import.meta.url)), 'utf8');
const I18N_TXT = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');

test('ART. 68 — aucune surface ne dit plus que le prix de Nota est FIXE', () => {
  // Deux axes de variation, tous deux vivants : le service et le délai.
  assert.notEqual(GRILLE.services.financement, GRILLE.services.refinancement,
    'le prix varie bien par service — sans quoi ce test ne garderait rien');
  assert.ok(Object.values(GRILLE.garantieDate).some((c) => c > 0),
    'et par palier de délai');

  const interdits = [
    /montant\s+fixe/i,
    /prix\s+fixe/i,
    /à\s+prix\s+fixe/i,
    /identique\s+pour\s+tous\b(?!\s+les\s+notaires)/i,
    /fixed\s+(price|amount|service\s+price)/i,
    /flat\s+(price|service\s+price)/i,
  ];
  // Aucune exception : la récompense d'un partenaire EST fixe, mais elle se dit
  // « une récompense fixe », jamais « un montant fixe » — le mot qui décrit le
  // prix de Nota reste réservé à ce qui est vrai de lui.
  const surfaces = [
    ['index.html', HTML_SRC],
    ['llms.txt', LLMS_SRC],
  ];
  for (const [nom, src] of surfaces) {
    for (const re of interdits) {
      const m = src.match(new RegExp('.{0,120}' + re.source + '.{0,120}', re.flags + 's'));
      assert.equal(m, null, nom + ' affirme encore un prix fixe : ' + (m && m[0]));
    }
  }
  // Et la traduction anglaise ne doit pas rattraper par la fenêtre ce que le
  // français a lâché par la porte.
  assert.ok(!/Nota’s service price<\/strong> is a fixed amount/.test(I18N_TXT),
    'le dictionnaire anglais porte encore l’ancienne affirmation');
});

test('les surfaces qui décrivent le modèle nomment les DEUX axes', () => {
  // Ne pas dire « fixe » ne suffit pas : l'art. 68 vise la publicité
  // INCOMPLÈTE. Le client doit lire de quoi le prix dépend.
  for (const [nom, src] of [['index.html', HTML_SRC], ['llms.txt', LLMS_SRC]]) {
    assert.match(src, /publié d’avance|publié d'avance|published in advance/, nom);
    assert.match(src, /dépend du service demandé et du délai|dépend de deux choses|service.{0,40}délai/s, nom);
  }
});
