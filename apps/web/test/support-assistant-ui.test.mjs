// La messagerie assistée, côté écran (ADR 0046).
//
// Ce que le propriétaire voyait avant : un panneau qui s'ouvrait sur un vide,
// promettait « on vous répond en quelques minutes », puis ne répondait pas.
// Cette suite tient ce qui remplace chacune de ces trois choses :
//
//   1. Le vide est devenu quatre questions d'amorce, bâties depuis le domaine.
//   2. La promesse de délai a disparu de TOUTES les surfaces de la messagerie
//      — c'est l'affirmation que l'audit a marquée invérifiable.
//   3. La réponse arrive avec la requête, l'assistant porte SON nom, et une
//      escalade se dit au visiteur au lieu de se taire.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';

const require = createRequire(import.meta.url);
const D = require('../../../packages/domain/index.js');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const CSS_SRC = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

const DOMS = [];
after(() => { for (const d of DOMS) { try { d.window.close(); } catch {} } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FLAT = (s) => s.replace(/[  ]/g, ' ').replace(/\s+/g, ' ').trim();
const $ = (doc, id) => doc.getElementById(id);
const submit = (form) => form.dispatchEvent(new form.ownerDocument.defaultView.Event('submit', { bubbles: true, cancelable: true }));

// L'API telle que l'ADR 0046 la rend : la réponse de l'assistant voyage DANS
// la réponse du POST, avec le drapeau d'escalade.
function assistedStub({ escalade = false, texte = 'Le prix affiché est le total.', delay = 0 } = {}) {
  const calls = [];
  let n = 0;
  const clock = () => new Date(Date.now() + ++n * 1000).toISOString();
  const handler = async (url, init = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body });
    const json = (obj, status = 200) => ({ ok: status < 400, status, json: async () => obj });
    if (path.includes('/support/messages')) {
      if (delay) await wait(delay);
      return json(
        {
          threadId: 'th-1',
          token: 'tok-1',
          message: { id: 'm-v', de: 'visiteur', texte: body.texte, createdAt: clock() },
          reponse: { id: 'm-a', de: 'assistant', texte, createdAt: clock() },
          escalade,
        },
        201
      );
    }
    if (path.includes('/support/thread')) return json({ messages: [] });
    throw new Error('offline');
  };
  return { calls, handler };
}

async function boot(stub) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only',
    url: 'https://nota.example/',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = stub.handler;
      window.scrollTo = () => {};
      if (!window.HTMLDialogElement.prototype.showModal) window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      if (!window.HTMLDialogElement.prototype.close) window.HTMLDialogElement.prototype.close = function () { this.open = false; };
    },
  });
  DOMS.push(dom);
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(60);
  return { win, doc: win.document, stub };
}

async function ask(doc, text) {
  if ($(doc, 'chat-panel').hidden) $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = text;
  submit($(doc, 'chat-form'));
  await wait(40);
}

// --- 1. Le vide est devenu des questions -------------------------------------

test('le panneau s’ouvre sur les questions du DOMAINE, pas sur un vide', async () => {
  const { doc } = await boot(assistedStub());
  $(doc, 'chat-fab').click();
  await wait(20);
  const chips = [...$(doc, 'chat-suggest').querySelectorAll('.sup-chip')];
  assert.equal(chips.length, 4);
  // Bâties depuis la donnée : changer la liste du domaine change l'écran.
  assert.deepEqual(chips.map((c) => FLAT(c.textContent)), D.SUPPORT_QUESTIONS_SUGGEREES.slice(0, 4).map((q) => q.fr));
  assert.deepEqual(chips.map((c) => c.dataset.q), D.SUPPORT_QUESTIONS_SUGGEREES.slice(0, 4).map((q) => q.id));
});

test('cliquer une question l’envoie telle quelle', async () => {
  const { doc, stub } = await boot(assistedStub());
  $(doc, 'chat-fab').click();
  await wait(20);
  $(doc, 'chat-suggest').querySelector('.sup-chip').click();
  await wait(60);
  // Le fil des balises du tunnel poste lui aussi : on cherche CETTE route.
  const post = stub.calls.find((c) => c.method === 'POST' && c.path.includes('/support/messages'));
  assert.equal(post.body.texte, D.SUPPORT_QUESTIONS_SUGGEREES[0].fr);
});

test('les amorces disparaissent dès le premier message et ne reviennent pas', async () => {
  const { doc } = await boot(assistedStub());
  await ask(doc, 'Combien ça coûte ?');
  assert.equal($(doc, 'chat-suggest').hidden, true);
  // Le sondage revient à vide (fil purgé, réponse partielle) : les amorces ne
  // doivent PAS repousser au-dessus d'une conversation déjà commencée.
  await wait(60);
  assert.equal($(doc, 'chat-suggest').hidden, true);
  assert.ok($(doc, 'chat-log').querySelectorAll('.sup-msg').length >= 2);
});

// --- 2. Aucune promesse de délai ---------------------------------------------

test('aucune surface de la messagerie n’annonce un délai de réponse', async () => {
  const { doc } = await boot(assistedStub());
  $(doc, 'chat-fab').click();
  await wait(20);
  const txt = FLAT($(doc, 'chat-panel').textContent);
  for (const promesse of [/quelques minutes/i, /heures d’ouverture/i, /en direct/i, /within .*(minutes|hours)/i]) {
    assert.ok(!promesse.test(txt), `la messagerie ne promet plus : ${promesse}`);
  }
});

test('la ligne d’entête dit ce que la messagerie FAIT, et le dit une fois', async () => {
  const { doc } = await boot(assistedStub());
  $(doc, 'chat-fab').click();
  const txt = FLAT($(doc, 'chat-panel').textContent);
  const ligne = 'Posez votre question ici, en tout temps. Un assistant IA peut vous guider; une personne peut prendre le relais dans cette conversation.';
  assert.equal(txt.split(ligne).length - 1, 1);
});

// --- 3. La réponse, le nom, l'escalade ---------------------------------------

test('la réponse de l’assistant s’affiche AVEC la requête, sans attendre un sondage', async () => {
  const { doc } = await boot(assistedStub({ texte: 'Le prix affiché est le total.' }));
  await ask(doc, 'Le prix comprend quoi ?');
  const bulles = [...$(doc, 'chat-log').querySelectorAll('.sup-msg')];
  assert.deepEqual(bulles.map((b) => b.dataset.de), ['visiteur', 'assistant']);
  assert.equal(FLAT(bulles[1].querySelector('.sup-bubble').textContent), 'Le prix affiché est le total.');
});

test('l’assistant porte SON nom : un visiteur ne croit jamais parler à une personne', async () => {
  const { doc } = await boot(assistedStub());
  await ask(doc, 'Bonjour');
  const meta = $(doc, 'chat-log').querySelector('.sup-msg[data-de="assistant"] .sup-who');
  assert.equal(FLAT(meta.textContent), 'Assistant Nota');
  // Et « Nota » tout court reste réservé à l'humain qui répond de sa boîte.
  assert.notEqual(FLAT(meta.textContent), 'Nota');
});

test('« l’assistant écrit… » pendant que le modèle réfléchit, puis s’efface', async () => {
  const { doc } = await boot(assistedStub({ delay: 120 }));
  if ($(doc, 'chat-panel').hidden) $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = 'Combien ?';
  submit($(doc, 'chat-form'));
  await wait(40);
  assert.ok($(doc, 'chat-log').querySelector('.sup-typing'), 'le témoin d’écriture est là pendant l’attente');
  await wait(220);
  assert.ok(!$(doc, 'chat-log').querySelector('.sup-typing'), 'et il s’efface quand la réponse arrive');
});

test('le champ se vide dès l’envoi : la question est déjà dans le fil', async () => {
  const { doc } = await boot(assistedStub({ delay: 80 }));
  if ($(doc, 'chat-panel').hidden) $(doc, 'chat-fab').click();
  $(doc, 'chat-text').value = 'Combien ?';
  submit($(doc, 'chat-form'));
  await wait(30);
  assert.equal($(doc, 'chat-text').value, '');
  assert.equal(FLAT($(doc, 'chat-log').querySelector('.sup-msg .sup-bubble').textContent), 'Combien ?');
});

test('l’écho local ne double pas la bulle quand le serveur répond', async () => {
  const { doc } = await boot(assistedStub({ delay: 60 }));
  await ask(doc, 'Combien ?');
  await wait(120);
  const visiteur = [...$(doc, 'chat-log').querySelectorAll('.sup-msg[data-de="visiteur"]')];
  assert.equal(visiteur.length, 1, 'une seule bulle pour une seule question');
  assert.ok(!$(doc, 'chat-log').querySelector('.sup-msg[data-id^="local-"]'), 'l’id provisoire a cédé la place');
});

test('une escalade reste dans le chat et le courriel reste un choix', async () => {
  const { doc } = await boot(assistedStub({ escalade: true, texte: 'Je passe la question à Anthony.' }));
  await ask(doc, 'Où en est mon dossier ?');
  assert.equal($(doc, 'chat-escalade').hidden, false, 'l’avis d’escalade est visible');
  assert.match(FLAT($(doc, 'chat-escalade').textContent), /personne prendra le relais ici/);
  assert.equal($(doc, 'chat-courriel-row').hidden, true, 'le courriel n’est pas demandé automatiquement');
});

test('une réponse ordinaire ne montre PAS l’avis d’escalade', async () => {
  const { doc } = await boot(assistedStub({ escalade: false }));
  await ask(doc, 'Combien ?');
  assert.equal($(doc, 'chat-escalade').hidden, true);
});

test('la langue du visiteur part avec la question', async () => {
  const { doc, stub } = await boot(assistedStub());
  await ask(doc, 'How much?');
  const post = stub.calls.find((c) => c.method === 'POST' && c.path.includes('/support/messages'));
  assert.equal(post.body.locale, 'fr', 'français par défaut, comme le reste du site');
});

// --- 4. Le trou de 108 px --------------------------------------------------

test('les notes de situation se REPLIENT : plus de vide réservé dans le panneau', async () => {
  // C'était, littéralement, ce qui faisait paraître la messagerie cassée : deux
  // paragraphes cachés qui gardaient chacun leur ligne au milieu du panneau.
  const reserve = CSS_SRC.match(/^[^\n]*\[hidden\][^{]*\{\s*display:\s*block\s*!important/m);
  assert.ok(reserve, 'la règle de ligne réservée existe toujours pour les messages de validation');
  const bloc = CSS_SRC.slice(0, CSS_SRC.indexOf('display: block !important'));
  const ligne = bloc.slice(bloc.lastIndexOf('.hold[hidden]'));
  for (const cls of ['.sup-ended[hidden]', '.sup-escalade[hidden]', '.sup-suggest[hidden]']) {
    assert.ok(!ligne.includes(cls), `${cls} ne réserve plus de ligne`);
  }
});

test('CSS : l’assistant a sa marque, et les points d’écriture restent des points', async () => {
  assert.match(CSS_SRC, /\.sup-msg\[data-de='assistant'\]\s*\.sup-bubble\s*\{[^}]*border-left/);
  assert.match(CSS_SRC, /\.sup-dot\s*\{[^}]*width:\s*[1-8]px/);
  // Le mouvement se coupe pour qui le demande.
  assert.match(CSS_SRC, /prefers-reduced-motion[^}]*\}[\s\S]{0,120}\.sup-dot\s*\{[^}]*animation:\s*none|\.sup-dot\s*\{\s*animation:\s*none/);
});

test('expanded questions are behind a native disclosure and the composer explains privacy', async () => {
  const { doc } = await boot(assistedStub());
  $(doc, 'chat-fab').click();
  const box = $(doc, 'chat-suggest');
  assert.equal(box.querySelectorAll(':scope > .sup-chip').length, 4);
  const more = $(doc, 'chat-topics');
  assert.equal(more.open, false);
  assert.ok(more.querySelectorAll('.sup-chip').length > 10);
  assert.ok($(doc, 'chat-text').getAttribute('aria-describedby').includes('chat-privacy'));
  assert.match($(doc, 'chat-privacy').textContent, /mot de passe/);
});

test('help topics remain available after a reply and prepare a question without sending', async () => {
  const { doc, stub } = await boot(assistedStub());
  await ask(doc, 'Bonjour');
  const posts = () => stub.calls.filter(c => c.path.includes('/support/messages')).length;
  const before = posts();
  const topics = $(doc, 'chat-topic-list').querySelectorAll('[data-topic]');
  assert.equal(topics.length, D.SUPPORT_TOPICS.length);
  $(doc, 'chat-topics').open = true;
  topics[0].click();
  assert.equal($(doc, 'chat-text').value, D.SUPPORT_TOPICS[0].fr);
  assert.equal(posts(), before);
  assert.equal(doc.activeElement, $(doc, 'chat-text'));
  $(doc, 'chat-text').value = 'Ma question en cours';
  topics[1].click();
  assert.equal($(doc, 'chat-text').value, 'Ma question en cours');
  assert.ok($(doc, 'chat-text').getAttribute('aria-describedby').includes('chat-privacy'));
});

test('contact opens the conversation directly and an explicit human request preserves unfinished drafts', async () => {
  const { doc, stub } = await boot(assistedStub({ escalade: true, texte: 'Une personne prend le relais ici.' }));
  $(doc, 'mnav-contact').click();
  assert.equal($(doc, 'chat-panel').hidden, false);
  assert.equal($(doc, 'contact-dialog').open, false);
  assert.equal(doc.activeElement, $(doc, 'chat-text'));
  $(doc, 'chat-text').value = 'Mon brouillon';
  $(doc, 'chat-human').click();
  assert.equal($(doc, 'chat-text').value, 'Mon brouillon');
  assert.equal(stub.calls.filter(c => c.path.includes('/support/messages')).length, 0);
  $(doc, 'chat-text').value = '';
  $(doc, 'chat-human').click();
  await wait(80);
  const post = stub.calls.find(c => c.method === 'POST' && c.path.includes('/support/messages'));
  assert.equal(post.body.texte, D.SUPPORT_TOPICS.find(t => t.id === 'humain').fr);
  assert.ok(!post.body.courriel);
  assert.equal($(doc, 'chat-courriel-row').hidden, true);
});
