import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { NOTARY_CONTACT } from '../test-support/notary-fixture.mjs';
import { notarySignIn } from '../test-support/notary-session.mjs';

const require = createRequire(import.meta.url);
const D = require('@nota/domain');
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createMemoryStorage } = require('../src/storage-port.js');
const { createBilling } = require('../src/billing.js');
const { notaryIdForEmail } = require('../src/notary-auth.js');

const TODAY = '2026-09-09';
const NOW_MS = Date.parse('2026-09-09T14:00:00.000Z');
const NOTARY_EMAIL = 'notaire@etude.test';
const NOTARY_ID = notaryIdForEmail(NOTARY_EMAIL);
const DATE = '2026-09-18';
const PRICING = {
  valeur_pret: 250000,
  succession: 'non',
  approbation_bancaire: 'obtenue',
  preteur: 'banque_nationale',
  deplacement: 'client_50',
};
const PAGE = {
  documentId: 'offre-preteur',
  page: 1,
  text: 'Adresse : 10 rue des Érables, Québec. Prêteur : Banque Exemple. Dettes garanties : Hypothèque existante.',
};
const EXTRACTION = {
  fields: [
    { fieldId: 'property_address', value: '10 rue des Érables, Québec', evidence: [{ documentId: PAGE.documentId, page: 1, quote: 'Adresse : 10 rue des Érables, Québec' }] },
    { fieldId: 'lender_name', value: 'Banque Exemple', evidence: [{ documentId: PAGE.documentId, page: 1, quote: 'Prêteur : Banque Exemple' }] },
    { fieldId: 'secured_debts', value: 'Hypothèque existante', evidence: [{ documentId: PAGE.documentId, page: 1, quote: 'Dettes garanties : Hypothèque existante' }] },
  ],
};

const parse = response => JSON.parse(response.body);
const bearer = token => ({ authorization: 'Bearer ' + token });
const call = (app, method, path, { token, query = {}, body } = {}) => app.handle({
  method, path, query, headers: token ? bearer(token) : {},
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function fakeStripe() {
  return {};
}

function setup() {
  const repo = createMemoryRepo([]);
  const storage = createMemoryStorage({ now: () => NOW_MS });
  const billing = createBilling({ repo, stripe: fakeStripe(), now: () => TODAY });
  const aiCalls = [];
  let nextId = 0;
  const app = createApp(repo, {
    now: () => TODAY,
    nowMs: () => NOW_MS,
    newId: () => 'lifecycle-' + (++nextId),
    storage,
    billing,
    billingConfigured: false,
    env: { NOTA_FINANCING_AI_ENABLED: 'true' },
    financingAIPort: {
      model: 'lifecycle-model',
      async extract(input) { aiCalls.push(input); return { extraction: EXTRACTION }; },
    },
  });
  return { app, repo, storage, aiCalls };
}

async function seedNotary(repo) {
  await repo.putNotary({
    id: NOTARY_ID,
    email: NOTARY_EMAIL,
    status: 'active',
    etude: 'Étude Exemple',
    prefixe: 'G1R',
    rayonKm: 50,
    urgences: true,
    chargesEnabled: true,
    connectAccountId: 'acct_lifecycle',
    ...NOTARY_CONTACT,
  });
}

test('full notary lifecycle keeps client context, AI evidence and human decisions in one file', async () => {
  const { app, repo, storage, aiCalls } = setup();
  await seedNotary(repo);

  const posted = await call(app, 'POST', '/bids', {
    body: {
      serviceId: 'refinancement', dateISO: DATE, montant: 2800,
      prefixe: 'G1R', nom: 'Marie Roy', courriel: 'client@example.ca', telephone: '418 555 0100',
      pricing: PRICING,
      dossier: { adresse: '10 rue des Érables, Québec', __consent: true },
    },
  });
  assert.equal(posted.statusCode, 201, posted.body);
  const published = parse(posted);
  const bid = published.bid;
  const clientToken = published.clientToken;
  assert.ok(clientToken);

  const clientView = await call(app, 'GET', '/client/bid', { token: clientToken, query: { id: bid.id, dateISO: DATE } });
  assert.equal(clientView.statusCode, 200, clientView.body);
  assert.equal(parse(clientView).dossier.adresse, '10 rue des Érables, Québec');

  const session = await notarySignIn(app, NOTARY_EMAIL);
  const notaryToken = session.token;
  const open = await call(app, 'GET', '/notary/bids', { token: notaryToken });
  assert.equal(open.statusCode, 200, open.body);
  assert.ok(parse(open).bids.some(item => item.id === bid.id));

  const retained = await call(app, 'POST', '/notary/bids/accept', { token: notaryToken, body: { id: bid.id, dateISO: DATE } });
  assert.equal(retained.statusCode, 200, retained.body);
  assert.equal(parse(retained).dossier.adresse, '10 rue des Érables, Québec');

  const request = await call(app, 'POST', '/notary/bids/documents', {
    token: notaryToken,
    body: { id: bid.id, dateISO: DATE, documents: ['offre_preteur'], message: 'Merci de transmettre la dernière offre.' },
  });
  assert.equal(request.statusCode, 200, request.body);

  const updatedDossier = await call(app, 'POST', '/client/dossier', {
    token: clientToken,
    body: { id: bid.id, dateISO: DATE, dossier: { adresse: '10 rue des Érables, Québec', offre_preteur: 'offre-banque.pdf', __consent: true } },
  });
  assert.equal(updatedDossier.statusCode, 200, updatedDossier.body);
  assert.equal(parse(updatedDossier).demandes[0].fournie, true);

  const upload = await call(app, 'POST', '/client/bid/documents', {
    token: clientToken,
    body: { id: bid.id, dateISO: DATE, nom: 'offre-banque.pdf', taille: 1024, type: 'application/pdf' },
  });
  assert.equal(upload.statusCode, 200, upload.body);
  const document = parse(upload).document;
  storage.__deposer(D.documentStorageKey(bid.id, document.id, 'offre-banque.pdf'), Buffer.alloc(1024), 'application/pdf');
  const confirmed = await call(app, 'POST', '/client/bid/documents/confirme', {
    token: clientToken, body: { id: bid.id, dateISO: DATE, documentId: document.id },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(parse(confirmed).document.etat, 'pret');

  const documents = await call(app, 'GET', '/notary/bids/documents', {
    token: notaryToken, query: { id: bid.id, dateISO: DATE, documentId: document.id },
  });
  assert.equal(documents.statusCode, 200, documents.body);
  assert.ok(parse(documents).lecture.url);

  const prepared = await call(app, 'POST', '/notary/financing/preparation', {
    token: notaryToken,
    body: { id: bid.id, dateISO: DATE, pages: [PAGE], processingAuthorized: true },
  });
  assert.equal(prepared.statusCode, 200, prepared.body);
  const preparedBody = parse(prepared);
  assert.equal(preparedBody.analysis.preparation.status, 'needs_notary_review');
  assert.equal(preparedBody.workPacket.workflow.ai.status, 'awaiting_review');
  assert.equal(aiCalls.length, 1);
  assert.equal((await repo.get(bid.id, DATE)).financingAnalysis.pages, undefined);

  const reviewed = await call(app, 'POST', '/notary/financing/review', {
    token: notaryToken,
    body: {
      id: bid.id, dateISO: DATE, analysisId: preparedBody.analysis.id,
      decisions: EXTRACTION.fields.map((field, index) => ({ index, decision: 'accepted', reason: 'Extrait vérifié dans le document.' })),
      activeReviewSeconds: 42,
    },
  });
  assert.equal(reviewed.statusCode, 200, reviewed.body);
  const reviewedBody = parse(reviewed);
  assert.equal(reviewedBody.workPacket.workflow.ai.status, 'reviewed');
  assert.equal(reviewedBody.workPacket.workflow.ai.reviewSeconds, 42);

  const sent = await call(app, 'POST', '/notary/bids/message', {
    token: notaryToken, body: { id: bid.id, dateISO: DATE, texte: 'Votre dossier est prêt pour notre vérification finale.' },
  });
  assert.equal(sent.statusCode, 200, sent.body);
  const answered = await call(app, 'POST', '/client/bid/message', {
    token: clientToken, body: { id: bid.id, dateISO: DATE, texte: 'Merci, je reste disponible.' },
  });
  assert.equal(answered.statusCode, 200, answered.body);

  const complete = await call(app, 'POST', '/notary/acts/complete', {
    token: notaryToken, body: { bidId: bid.id, dateISO: DATE, actAmount: 2800 },
  });
  assert.equal(complete.statusCode, 200, complete.body);
  assert.equal(parse(complete).actAmount, 2800);
  assert.ok(await repo.getActCompletion(bid.id));

  const finalFeed = await call(app, 'GET', '/notary/bids', { token: notaryToken });
  const finalEntry = parse(finalFeed).retained.find(item => item.id === bid.id);
  assert.equal(finalEntry.completed, true);
  assert.equal(finalEntry.actAmount, 2800);

  const learningKinds = (await repo.queryNotaryLearningByDay(TODAY))
    .filter(entry => entry.action === 'notary_learning_signal' && entry.meta?.bidId === bid.id)
    .map(entry => entry.meta.kind);
  for (const kind of ['customer_input', 'customer_behavior', 'communication', 'ai_output', 'notary_review', 'official_outcome']) {
    assert.ok(learningKinds.includes(kind), kind);
  }
});
