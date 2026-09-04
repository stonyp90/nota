/**
 * The notary's questions and the client's checklist — audit of the booking
 * journey (2026-09-02, AUDIT-BOOKING §1 + §3).
 *
 *   - Legal copy: the ID help must NOT recommend the health-insurance card
 *     (Loi sur l'assurance maladie, art. 9.0.0.1), the co-borrower help must
 *     include the couple, and the family residence (art. 401-405 C.c.Q.) is a
 *     question on BOTH acts.
 *   - Conditional documents: a document may carry `si` (a predicate on the
 *     pricing answers). dossierItems / leadReadiness / requestableItems honour
 *     it WHEN pricing is given and include every document when it is not —
 *     every caller that predates the predicate keeps today's behaviour.
 *   - Copy of the questions themselves (help texts, option labels, the
 *     déplacement bands as a willingness) lives here, never in an adapter.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const D = createRequire(import.meta.url)('../index.js');

const crit = (sid, id) => D.serviceById(sid).pricing.criteria.find((c) => c.id === id);
const doc = (sid, id) => D.serviceById(sid).documents.find((d) => d.id === id);
const ACTS = ['refinancement', 'financement'];

// --- P0 legal copy -----------------------------------------------------------

test('pièce d’identité: the help never recommends the RAMQ card, and says why', () => {
  for (const sid of ACTS) {
    const d = doc(sid, 'piece_identite');
    assert.ok(d, `${sid} collects ID`);
    assert.match(d.aide, /Permis de conduire ou passeport/, `${sid}: names the two lawful IDs`);
    assert.match(d.aide, /N’utilisez pas votre carte d’assurance maladie/, `${sid}: warns against the RAMQ card`);
    assert.match(d.aide, /la loi en interdit l’usage/, `${sid}: gives the reason`);
    assert.doesNotMatch(d.aide, /ou carte d’assurance maladie valide/, `${sid}: the old recommendation is gone`);
  }
});

test('co-emprunteur: the help includes the couple, not only "more than two owners"', () => {
  for (const sid of ACTS) {
    const c = crit(sid, 'coemprunteur');
    assert.equal(c.type, 'flag');
    assert.equal(c.aide, 'Deux emprunteurs ou plus, ou une propriété détenue en indivision (parts non divisées).');
  }
});

test('résidence familiale: an optional choice on BOTH acts — the non-borrowing spouse must intervene (art. 401-405 C.c.Q.)', () => {
  for (const sid of ACTS) {
    const c = crit(sid, 'residence_familiale');
    assert.ok(c, `${sid} asks the family-residence question`);
    assert.equal(c.type, 'choice');
    assert.equal(c.optional, true, 'optional so every existing fixture stays a valid offer');
    assert.ok(!c.required);
    assert.equal(c.defaut, undefined, 'no default: the client declares it');
    assert.deepEqual(
      c.options.map((o) => [o.id, o.label, o.add, o.poids]),
      [
        ['non', 'Ni marié ni uni civilement', 0, 0],
        ['autre_immeuble', 'Marié ou uni civilement — autre immeuble', 0, 1],
        ['residence_familiale', 'Marié ou uni civilement — résidence familiale', 150, 2],
      ]
    );
    assert.equal(
      c.aide,
      'Si vous êtes marié ou uni civilement et que l’immeuble est votre résidence familiale, votre conjoint doit intervenir à l’acte, même s’il n’emprunte pas.'
    );
    // The engine needs no new type: the family residence prices and weighs.
    const base = D.computeBasePrice(sid, {});
    assert.equal(D.computeBasePrice(sid, { residence_familiale: 'residence_familiale' }), base + 150);
    assert.equal(D.computeBasePrice(sid, { residence_familiale: 'autre_immeuble' }), base);
    assert.equal(D.complexity(sid, { residence_familiale: 'residence_familiale' }).score, 2);
    assert.ok(D.complexity(sid, { residence_familiale: 'residence_familiale' }).factors[0].endsWith(' : Marié ou uni civilement — résidence familiale'));
    // Unanswered, it never blocks an offer.
    assert.ok(!D.missingRequired(sid, {}).some((m) => m.id === 'residence_familiale'));
  }
});

// --- P1 catalogue -------------------------------------------------------------

test('succession: financement asks it too, with refinancement’s exact shape (required, « Non » by default)', () => {
  const ref = crit('refinancement', 'succession');
  const fin = crit('financement', 'succession');
  assert.ok(fin, 'financement asks the succession question');
  assert.equal(fin.required, true);
  assert.equal(fin.defaut, 'non');
  assert.deepEqual(fin.options, ref.options);
  assert.equal(fin.label, ref.label);
  assert.equal(fin.aide, ref.aide);
  assert.equal(D.computeBasePrice('financement', { succession: 'oui' }), 1800 + 400);
  // Unanswered, it blocks the offer like every required question.
  assert.ok(D.missingRequired('financement', {}).some((m) => m.id === 'succession'));
});

test('succession: the help says what a succession means here, in the client’s words', () => {
  for (const sid of ACTS) {
    assert.equal(
      crit(sid, 'succession').aide,
      'Répondez oui si l’immeuble vient d’une succession qui n’est pas entièrement réglée — par exemple si le titre est encore au nom de la personne décédée.'
    );
  }
});

test('certificat de localisation: an « Assurance titres » option, free, weighed, with its own help', () => {
  for (const sid of ACTS) {
    const c = crit(sid, 'certificat_localisation');
    const o = c.options.find((x) => x.id === 'assurance_titres');
    assert.ok(o, `${sid} offers title insurance as an answer`);
    assert.equal(o.label, 'Assurance titres');
    assert.equal(o.add, 0);
    assert.equal(o.poids, 1);
    assert.equal(o.aide, 'L’assurance titres remplace souvent un certificat périmé — demandez au notaire.');
    assert.match(c.aide, /certificat de moins de 10 ans/, 'the help names the lenders’ 10-year rule');
    assert.match(c.aide, /travaux/, '…and the works-since caveat');
  }
});

test('assurance habitation: the help says what « Aucune » means for the disbursement', () => {
  for (const sid of ACTS) {
    const c = crit(sid, 'assurance_habitation');
    assert.match(c.aide, /ne débourse pas/);
    assert.match(c.aide, /avant la signature/);
  }
});

test('comptes de taxes: municipal AND school, most recent ones', () => {
  for (const sid of ACTS) {
    const d = doc(sid, 'compte_taxes');
    assert.equal(d.nom, 'Comptes de taxes municipales et scolaires');
    assert.equal(d.aide, 'Les comptes les plus récents de votre municipalité et de votre centre de services scolaire.');
  }
});

test('preuve d’assurance habitation: a document on both acts, not asked of a client who declared none', () => {
  for (const sid of ACTS) {
    const d = doc(sid, 'preuve_assurance');
    assert.ok(d, `${sid} collects the insurance proof`);
    assert.equal(d.nom, 'Preuve d’assurance habitation');
    assert.ok(d.aide && d.aide.length > 0);
    assert.deepEqual(d.si, { critere: 'assurance_habitation', sauf: ['non'] });
  }
});

// --- Conditional documents: the `si` predicate ---------------------------------

test('documentApplies: no predicate or no pricing → always; `valeurs` whitelists, `sauf` blacklists', () => {
  const plain = { id: 'x', nom: 'X', aide: 'x' };
  assert.equal(D.documentApplies(plain, undefined), true);
  assert.equal(D.documentApplies(plain, { contexte: 'achat' }), true);
  const onAchat = { ...plain, si: { critere: 'contexte', valeurs: ['achat'] } };
  assert.equal(D.documentApplies(onAchat, undefined), true, 'no pricing: today’s behaviour, included');
  assert.equal(D.documentApplies(onAchat, null), true);
  assert.equal(D.documentApplies(onAchat, {}), false, 'unanswered: a whitelist does not hold');
  assert.equal(D.documentApplies(onAchat, { contexte: 'propriete_detenue' }), false);
  assert.equal(D.documentApplies(onAchat, { contexte: 'achat' }), true);
  const unlessNone = { ...plain, si: { critere: 'assurance_habitation', sauf: ['non'] } };
  assert.equal(D.documentApplies(unlessNone, {}), true, 'unanswered: a blacklist holds');
  assert.equal(D.documentApplies(unlessNone, { assurance_habitation: 'oui' }), true);
  assert.equal(D.documentApplies(unlessNone, { assurance_habitation: 'non' }), false);
});

test('promesse d’achat acceptée: only when the financement finances a purchase', () => {
  const d = doc('financement', 'promesse_achat');
  assert.ok(d, 'financement lists the accepted promise to purchase');
  assert.deepEqual(d.si, { critere: 'contexte', valeurs: ['achat'] });
  assert.ok(!doc('refinancement', 'promesse_achat'), 'a refinancing never asks for one');
  const ids = (p) => D.dossierItems('financement', p).filter((it) => it.kind === 'doc').map((it) => it.id);
  assert.ok(ids(undefined).includes('promesse_achat'), 'no pricing: every document, as before');
  assert.ok(!ids({ contexte: 'propriete_detenue' }).includes('promesse_achat'));
  assert.ok(ids({ contexte: 'achat' }).includes('promesse_achat'));
});

test('testament et déclaration de transmission: only when the property comes from a succession (both acts)', () => {
  for (const sid of ACTS) {
    const d = doc(sid, 'testament_transmission');
    assert.ok(d, `${sid} lists the succession papers`);
    assert.deepEqual(d.si, { critere: 'succession', valeurs: ['oui'] });
    const ids = (p) => D.dossierItems(sid, p).filter((it) => it.kind === 'doc').map((it) => it.id);
    assert.ok(ids().includes('testament_transmission'), 'no pricing: included');
    assert.ok(!ids({ succession: 'non' }).includes('testament_transmission'));
    assert.ok(ids({ succession: 'oui' }).includes('testament_transmission'));
  }
});

test('certificat de localisation: périmé or replaced by title insurance → no upload demanded, a note instead', () => {
  for (const sid of ACTS) {
    const d = doc(sid, 'certificat_localisation');
    assert.deepEqual(d.si, { critere: 'certificat_localisation', sauf: ['perime', 'assurance_titres'] });
    assert.ok(d.sinon && d.sinon.length > 0, 'the note shown in place of the upload');
    const items = (p) => D.dossierItems(sid, p);
    const asDoc = items({ certificat_localisation: 'a_jour' }).find((it) => it.id === 'certificat_localisation');
    assert.equal(asDoc.kind, 'doc');
    for (const answer of ['perime', 'assurance_titres']) {
      const asNote = items({ certificat_localisation: answer }).find((it) => it.id === 'certificat_localisation');
      assert.equal(asNote.kind, 'note', `${sid}/${answer}: a note, not an upload row`);
      assert.equal(asNote.nom, d.nom);
      assert.equal(asNote.aide, d.sinon);
    }
    // Unanswered (optional question) and no pricing at all: the upload row.
    assert.equal(items({}).find((it) => it.id === 'certificat_localisation').kind, 'doc');
    assert.equal(items().find((it) => it.id === 'certificat_localisation').kind, 'doc');
  }
});

test('dossierItems: documents then fields, each with kind/id/nom/aide — a service object is accepted too', () => {
  const svc = D.serviceById('refinancement');
  const items = D.dossierItems('refinancement');
  assert.deepEqual(D.dossierItems(svc), items, 'the service object works like its id');
  assert.equal(items.length, svc.documents.length + svc.champs.length);
  const docs = items.filter((it) => it.kind === 'doc');
  const fields = items.filter((it) => it.kind === 'field');
  assert.deepEqual(docs.map((it) => it.id), svc.documents.map((d) => d.id));
  assert.deepEqual(fields.map((it) => it.id), svc.champs.map((c) => c.id));
  assert.deepEqual(fields.map((it) => it.nom), svc.champs.map((c) => c.label));
  for (const it of items) assert.ok(it.aide, `${it.id} carries its help`);
  assert.deepEqual(D.dossierItems('service_inconnu'), []);
});

test('leadReadiness honours `si` when pricing is given, and counts every document when it is not', () => {
  const svc = D.serviceById('financement');
  const all = svc.documents.length + svc.champs.length;
  const saved = { __consent: true, __pricing: { valeur_pret: 250000, contexte: 'propriete_detenue', approbation_bancaire: 'obtenue', preteur: 'banque_nationale', succession: 'non', deplacement: 'client_50' } };
  // Without the third argument: exactly today's behaviour (the dossier's own
  // __pricing is NOT read implicitly — callers opt in).
  const before = D.leadReadiness('financement', saved);
  assert.equal(before.total, all);
  assert.ok(before.missing.includes('Promesse d’achat acceptée'));
  assert.ok(before.missing.includes('Testament et déclaration de transmission'));
  // With pricing: the promise and the succession papers are not this client's.
  const after = D.leadReadiness('financement', saved, saved.__pricing);
  assert.equal(after.total, all - 2);
  assert.ok(!after.missing.includes('Promesse d’achat acceptée'));
  assert.ok(!after.missing.includes('Testament et déclaration de transmission'));
  assert.equal(after.ready, true, 'the gate itself is unchanged: required answers + consent');
  // A note (certificat périmé) is neither missing nor done.
  const perime = D.leadReadiness('financement', saved, { ...saved.__pricing, certificat_localisation: 'perime' });
  assert.equal(perime.total, all - 3);
  assert.ok(!perime.missing.includes('Certificat de localisation'));
  // A provided conditional document counts when it applies.
  const withPromise = D.leadReadiness('financement', { ...saved, promesse_achat: 'promesse.pdf' }, { ...saved.__pricing, contexte: 'achat' });
  assert.equal(withPromise.done, 1);
});

test('requestableItems honours `si` when pricing is given — the notary cannot ask for what does not apply', () => {
  const ids = (p) => D.requestableItems('financement', p).map((it) => it.id);
  assert.ok(ids().includes('promesse_achat'), 'no pricing: every document is requestable, as before');
  assert.ok(!ids({ contexte: 'propriete_detenue' }).includes('promesse_achat'));
  assert.ok(ids({ contexte: 'achat' }).includes('promesse_achat'));
  assert.ok(!ids({ certificat_localisation: 'perime' }).includes('certificat_localisation'), 'a note is not requestable');
  assert.ok(ids({ contexte: 'achat' }).includes('adresse'), 'fields are always requestable');
  // validateDocumentRequest is untouched: it still validates against the full list.
  assert.equal(D.validateDocumentRequest({ serviceId: 'financement', documents: ['promesse_achat'] }).ok, true);
});

test('cleanDossier keeps the conditional documents’ declared names', () => {
  const clean = D.cleanDossier('financement', { promesse_achat: 'promesse.pdf', preuve_assurance: 'assurance.pdf', testament_transmission: 'testament.pdf' });
  assert.equal(clean.promesse_achat, 'promesse.pdf');
  assert.equal(clean.preuve_assurance, 'assurance.pdf');
  assert.equal(clean.testament_transmission, 'testament.pdf');
});

// --- Copy of the questions (§3) ----------------------------------------------

test('déplacement: the client bands read as a willingness, the notary bands and the urgency stay', () => {
  const nom = (id) => D.deplacementById(id).nom;
  assert.equal(nom('client_50'), 'J’accepte de me déplacer à l’étude — jusqu’à 50 km');
  assert.equal(nom('client_25'), 'J’accepte de me déplacer à l’étude — jusqu’à 25 km');
  assert.equal(nom('client_10'), 'J’accepte de me déplacer à l’étude — moins de 10 km');
  assert.equal(nom('notaire_25'), 'Le notaire se déplace chez moi — jusqu’à 25 km');
  assert.equal(nom('notaire_50'), 'Le notaire se déplace chez moi — jusqu’à 50 km');
  assert.equal(nom('urgence_en_ligne'), 'Urgence — signature 100 % en ligne');
  for (const sid of ACTS) {
    assert.equal(
      crit(sid, 'deplacement').aide,
      'L’acte se signe en personne, sauf en cas d’urgence déclarée. Plus vous acceptez de vous déplacer, plus de notaires peuvent vous servir — et moins le déplacement coûte.'
    );
  }
  // The radius row asks a question per direction (renderers read it, never re-declare it).
  const qui = (id) => D.DEPLACEMENT_QUI.find((q) => q.id === id);
  assert.equal(qui('client').question, 'Jusqu’où acceptez-vous de vous déplacer ?');
  assert.equal(qui('notaire').question, 'Jusqu’où le notaire doit-il se déplacer ?');
  assert.equal(qui('en_ligne').question, undefined, 'a single-band direction has no radius row');
});

test('the questions’ own words (§3.9–3.15, 1.12)', () => {
  assert.equal(crit('financement', 'contexte').label, 'Que finance ce prêt ?');
  const lender = crit('refinancement', 'preteur');
  assert.match(lender.aide, /sans succursale/);
  assert.doesNotMatch(lender.aide, /virtuel/);
  for (const sid of ACTS) {
    assert.equal(crit(sid, 'approbation_bancaire').options.find((o) => o.id === 'non').label, 'Pas encore demandée');
    assert.equal(doc(sid, 'offre_preteur').nom, 'Lettre d’engagement du prêteur (offre de financement)');
    assert.match(doc(sid, 'certificat_localisation').aide, /^Le rapport et le plan de l’arpenteur-géomètre\./);
  }
  assert.equal(doc('refinancement', 'releve_hypotheque').aide, 'Votre plus récent relevé du prêt à rembourser.');
  // The private lender explains its surcharge (the one lender that still adds).
  const prive = D.lenderById('prive');
  assert.equal(prive.aide, 'Un prêteur privé donne ses instructions à la main : plus de vérifications, d’où le supplément.');
  assert.equal(lender.options.find((o) => o.id === 'prive').aide, prive.aide);
  assert.equal(lender.options.find((o) => o.id === 'desjardins').aide, undefined, 'only the surcharge is explained');
});

test('fixtures stay valid offers with the new questions (financement now answers succession)', () => {
  const today = '2026-08-12';
  for (const b of D.makeFixtures(today)) {
    const r = D.validateOffer({ serviceId: b.serviceId, dateISO: b.dateISO, montant: b.montant, todayISO: today, pricing: b.pricing, prefixe: b.prefixe });
    assert.equal(r.ok, true, `${b.id} ${b.serviceId}: ${JSON.stringify(r.errors)}`);
    if (b.serviceId === 'financement') assert.ok(['oui', 'non'].includes(b.pricing.succession), 'financement fixtures answer succession');
  }
});
