// L'assistant de la messagerie (ADR 0046) — la part DOMAINE.
//
// Trois choses vivent ici et nulle part ailleurs :
//
//   1. `supportFacts()` — la fiche de faits que l'assistant reçoit. Elle est
//      CALCULÉE à partir des constantes vivantes (SERVICES, TIERS, prixNota…),
//      jamais recopiée : changer un prix dans le catalogue change la réponse
//      de l'assistant, sans qu'une seule chaîne soit retouchée. C'est
//      l'invariant central de ce fichier, et il est testé de façon hostile.
//   2. `SUPPORT_NIVEAUX` — l'échelle 1·2·3 et ce qui, au-delà, revient à
//      l'humain. Une donnée, pas une suite de `if`.
//   3. `validateSupportAnswer()` — le garde-fou. Le domaine dit ce qu'une
//      réponse envoyée à un client N'A PAS LE DROIT de contenir : le
//      vocabulaire de taux que l'ADR 0042 a banni côté client, une cote
//      nominative (art. 70), un conseil juridique. Le modèle propose ; le
//      domaine dispose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

// --- 1. La fiche de faits ----------------------------------------------------

test('supportFacts nomme chaque service du catalogue avec SON prix vivant', () => {
  const f = D.supportFacts();
  assert.equal(f.services.length, D.SERVICES.length, 'un service du catalogue = une fiche');
  for (const svc of D.SERVICES) {
    const fait = f.services.find((s) => s.id === svc.id);
    assert.ok(fait, `le service ${svc.id} a sa fiche`);
    // Le prix annoncé est le TOTAL (ADR 0042) : honoraires de départ + Nota.
    const attendu = D.prixAnnonce(svc.id);
    assert.equal(fait.prixAnnonceTotalCents, attendu.totalCents);
    assert.equal(fait.honorairesDepartCents, attendu.honorairesCents);
    assert.equal(fait.prixNotaCents, attendu.notaCents);
    assert.equal(fait.nom, svc.nom);
    assert.equal(fait.nomEn, svc.nomEn);
  }
});

test('la fiche SUIT le catalogue : elle est calculée, jamais recopiée', () => {
  // La preuve qu'aucun chiffre n'est figé dans une chaîne : on repasse la
  // grille de prix admin, et la fiche bouge avec elle.
  const grille = D.prixNotaGrille({
    services: Object.fromEntries(D.SERVICES.map((s) => [s.id, s.prixNotaCents + 5000])),
  });
  const base = D.supportFacts();
  const bougee = D.supportFacts({ grille });
  for (const svc of D.SERVICES) {
    const a = base.services.find((s) => s.id === svc.id);
    const b = bougee.services.find((s) => s.id === svc.id);
    assert.equal(b.prixNotaCents - a.prixNotaCents, 5000, `${svc.id} suit la grille`);
    assert.equal(b.prixAnnonceTotalCents - a.prixAnnonceTotalCents, 5000);
  }
});

test('la fiche porte l’échelle des dates, avec le supplément de chaque barreau', () => {
  const f = D.supportFacts();
  assert.equal(f.dates.length, D.TIERS.length);
  for (const t of D.TIERS) {
    const fait = f.dates.find((d) => d.id === t.id);
    assert.ok(fait, `le barreau ${t.id} est dans la fiche`);
    assert.equal(fait.maxJours, t.maxJours);
    assert.equal(fait.supplementCents, t.prixNotaDateCents);
    assert.equal(fait.nom, t.nom);
    assert.equal(fait.nomEn, t.nomEn);
  }
  // Le standard ne coûte rien de plus : c'est LE fait que l'assistant doit
  // pouvoir dire sans se tromper.
  assert.equal(f.dates.find((d) => d.id === 'standard').supplementCents, 0);
});

test('la fiche porte les déplacements, les prêteurs et les documents du catalogue', () => {
  const f = D.supportFacts();
  assert.equal(f.deplacements.length, D.DEPLACEMENTS.length);
  assert.equal(f.preteurs.length, D.LENDERS.length);
  // Les documents sont ceux que le service demande réellement — la même liste
  // que la liste de vérification du dossier, pas une seconde énumération.
  for (const svc of D.SERVICES) {
    const fait = f.services.find((s) => s.id === svc.id);
    assert.deepEqual(
      fait.documents.map((d) => d.id),
      svc.documents.map((d) => d.id),
      `${svc.id} nomme ses documents`
    );
  }
});

test('la fiche porte le contact public et la limite d’un message', () => {
  const f = D.supportFacts();
  assert.equal(f.contact.courriel, D.CONTACT.courriel);
  assert.equal(f.limites.messageMax, D.SUPPORT_MESSAGE_MAX);
});

test('la fiche tient dans une invite : sérialisée, elle reste courte', () => {
  // Un garde-fou de coût autant que de qualité : la fiche part à chaque
  // question. Si elle enfle, c'est que quelqu'un y a versé un document.
  const json = JSON.stringify(D.supportFacts());
  assert.ok(json.length < 24000, `la fiche fait ${json.length} caractères`);
});

// --- 2. L'échelle 1·2·3 -------------------------------------------------------

test('les niveaux sont une donnée ordonnée, bilingue, et bornée à trois', () => {
  assert.equal(D.SUPPORT_NIVEAUX.length, 3);
  assert.deepEqual(D.SUPPORT_NIVEAUX.map((n) => n.niveau), [1, 2, 3]);
  for (const n of D.SUPPORT_NIVEAUX) {
    assert.ok(n.id && n.nom && n.nomEn, 'un niveau se nomme dans les deux langues');
    assert.ok(Array.isArray(n.sujets) && n.sujets.length, 'un niveau porte ses sujets');
  }
});

test('au-delà du niveau 3, c’est un humain — et la liste le dit', () => {
  assert.ok(Array.isArray(D.SUPPORT_ESCALADE_MOTIFS) && D.SUPPORT_ESCALADE_MOTIFS.length);
  for (const m of D.SUPPORT_ESCALADE_MOTIFS) {
    assert.ok(m.id && m.nom && m.nomEn);
  }
  // Les trois classes que rien ne peut fonder : un dossier nommé, une
  // exception de prix, un conseil juridique.
  for (const id of ['dossier_precis', 'exception', 'conseil_juridique']) {
    assert.ok(D.SUPPORT_ESCALADE_MOTIFS.some((m) => m.id === id), `le motif ${id} existe`);
  }
});

// --- 3. Le garde-fou ----------------------------------------------------------

test('une réponse vide ou trop longue est refusée', () => {
  assert.equal(D.validateSupportAnswer({ texte: '   ' }).ok, false);
  const trop = 'a'.repeat(D.SUPPORT_MESSAGE_MAX + 1);
  const v = D.validateSupportAnswer({ texte: trop });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.code === 'message_trop_long'));
});

test('le vocabulaire de taux est refusé côté client (ADR 0042)', () => {
  // « à partir de » est un prix partiel ; un taux, un palier ou un pourcentage
  // dans une réponse au client rouvre exactement la porte que l'ADR a fermée.
  for (const texte of [
    'Le taux applicable est de 30 %.',
    'Vous êtes dans le palier de 14 jours.',
    'Nous prenons un pourcentage du montant.',
    'Our rate is 30% of the amount.',
  ]) {
    const v = D.validateSupportAnswer({ texte });
    assert.equal(v.ok, false, `refusé : ${texte}`);
    assert.ok(v.errors.some((e) => e.code === 'vocabulaire_interdit'), texte);
  }
});

test('une cote nominative est refusée (art. 70)', () => {
  const v = D.validateSupportAnswer({ texte: 'Me Tremblay a une cote de 92 sur 100, c’est notre meilleur.' });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.code === 'cote_nominative'));
});

test('un conseil juridique est refusé, même bien intentionné', () => {
  for (const texte of [
    'Je vous conseille de signer avant la fin du mois pour éviter la pénalité.',
    'Vous devriez plutôt opter pour une hypothèque de deuxième rang.',
    'In your situation you should sign the deed before closing.',
  ]) {
    const v = D.validateSupportAnswer({ texte });
    assert.equal(v.ok, false, `refusé : ${texte}`);
    assert.ok(v.errors.some((e) => e.code === 'conseil_juridique'), texte);
  }
});

test('les affirmations que l’audit a retirées du site ne peuvent pas revenir par la messagerie', () => {
  // Chaque ligne ici a déjà été écrite quelque part sur le site, et retirée.
  // Une machine qui rédige est exactement ce qui les ferait revenir.
  const cas = [
    ['prix_fige', 'Le service de Nota est un forfait de 229 $.'],
    ['prix_fige', 'Nota charges a flat fee for its service.'],
    ['comparaison_prix', 'C’est moins cher que d’aller voir un notaire directement.'],
    ['tout_compris', 'Le montant que vous offrez est le total, tout compris.'],
    ['caution_ordre', 'Nos notaires sont certifiés par la Chambre.'],
    ['partage_honoraires', 'Le partage des honoraires est de 75/25 en votre faveur.'],
    ['delai_promis', 'On vous répond en quelques minutes.'],
    ['delai_promis', 'We reply within a few hours.'],
    ['statistique_inventee', 'Vos chances d’obtenir un notaire sont de 95 %.'],
    ['statistique_inventee', 'La médiane du mois est de 4 165 $.'],
  ];
  for (const [code, texte] of cas) {
    const v = D.validateSupportAnswer({ texte });
    assert.equal(v.ok, false, `refusé : ${texte}`);
    assert.ok(v.errors.some((e) => e.code === code), `${texte} → ${code} (reçu ${JSON.stringify(v.errors)})`);
  }
});

test('la NÉGATION d’un partage reste dicible — c’est ce que le produit doit dire', () => {
  const v = D.validateSupportAnswer({ texte: 'Il n’y a aucun partage d’hono' + 'raires : le notaire reçoit 100 % de votre offre.' });
  // La phrase exacte du site contient le motif ; le garde-fou la refuse, et
  // c'est assumé : l'assistant dit la même chose autrement.
  assert.equal(v.ok, false);
  const autrement = D.validateSupportAnswer({
    texte: 'Le notaire reçoit 100 % du montant que vous offrez. Le service de Nota est une seconde ligne, facturée à part.',
  });
  assert.equal(autrement.ok, true, JSON.stringify(autrement.errors));
});

test('les faits VRAIS du produit passent le garde-fou', () => {
  // Le risque d'un filtre trop large : rendre le produit indicible. Ces
  // phrases sont exactes et doivent passer.
  for (const texte of [
    'Les taxes et les débours ne sont pas compris.',
    'Un certificat de localisation périmé ajoute 100 $ au prix de départ.',
    'La signature 100 % en ligne n’est possible qu’en cas d’urgence déclarée.',
    'Vous ne payez qu’à la signature de l’acte.',
    'Tant qu’aucun notaire n’a retenu votre demande, vous pouvez la retirer sans frais.',
  ]) {
    const v = D.validateSupportAnswer({ texte });
    assert.equal(v.ok, true, `${texte} → ${JSON.stringify(v.errors)}`);
  }
});

test('une réponse honnête et chiffrée passe', () => {
  const f = D.supportFacts();
  const svc = f.services[0];
  const texte =
    `Pour un ${svc.nom.toLowerCase()}, le prix affiché commence à ${D.money(svc.prixAnnonceTotalCents / 100)} ` +
    'et c’est le total : les honoraires du notaire et le service de Nota. Vous ne payez qu’à la signature.';
  const v = D.validateSupportAnswer({ texte });
  assert.equal(v.ok, true, JSON.stringify(v.errors));
  assert.equal(v.texte, texte);
});

test('le garde-fou ne s’applique qu’au client : l’opérateur écrit ce qu’il veut', () => {
  // Le propriétaire répond à la main depuis son courriel — le domaine ne
  // censure jamais un humain, seulement ce qu'une machine s'apprête à dire.
  const texte = 'Le taux de 30 % du palier de 3 jours est le plafond, pas un frais.';
  assert.equal(D.validateSupportAnswer({ texte, de: D.SUPPORT_FROM.NOTA }).ok, true);
  assert.equal(D.validateSupportAnswer({ texte, de: D.SUPPORT_FROM.ASSISTANT }).ok, false);
});

// --- 4. Le fil : qui a parlé en dernier --------------------------------------

test('« assistant » est un émetteur du fil, distinct du visiteur et de Nota', () => {
  assert.equal(D.SUPPORT_FROM.ASSISTANT, 'assistant');
  assert.notEqual(D.SUPPORT_FROM.ASSISTANT, D.SUPPORT_FROM.NOTA);
});

test('une réponse de l’assistant NE marque PAS le fil « répondu »', () => {
  // C'est l'invariant qui protège le propriétaire : tant qu'un humain n'a pas
  // parlé, un fil escaladé reste dans « à répondre ». Une machine ne peut pas
  // vider la boîte de quelqu'un d'autre.
  const fil = {
    id: 't1',
    messages: [
      { id: 'm1', de: D.SUPPORT_FROM.VISITEUR, texte: 'Bonjour ?', createdAt: '2026-09-06T12:00:00.000Z' },
      { id: 'm2', de: D.SUPPORT_FROM.ASSISTANT, texte: 'Bonjour !', createdAt: '2026-09-06T12:00:01.000Z' },
    ],
  };
  const s = D.supportThreadSummary(fil);
  assert.equal(s.statut, D.SUPPORT_STATUT.A_REPONDRE);
  assert.equal(s.dernierDe, D.SUPPORT_FROM.ASSISTANT);
});

test('une escalade est portée par le fil et se lit dans le résumé', () => {
  const fil = {
    id: 't2',
    escaladeLe: '2026-09-06T12:00:02.000Z',
    escaladeMotif: 'dossier_precis',
    messages: [
      { id: 'm1', de: D.SUPPORT_FROM.VISITEUR, texte: 'Où en est mon dossier ?', createdAt: '2026-09-06T12:00:00.000Z' },
      { id: 'm2', de: D.SUPPORT_FROM.ASSISTANT, texte: 'Je transmets à Anthony.', createdAt: '2026-09-06T12:00:01.000Z' },
    ],
  };
  const s = D.supportThreadSummary(fil);
  assert.equal(s.escalade, true);
  assert.equal(s.escaladeMotif, 'dossier_precis');
  assert.equal(s.statut, D.SUPPORT_STATUT.A_REPONDRE);
});

test('la réponse de l’humain ferme l’escalade : le fil redevient « répondu »', () => {
  const fil = {
    id: 't3',
    escaladeLe: '2026-09-06T12:00:02.000Z',
    messages: [
      { id: 'm1', de: D.SUPPORT_FROM.VISITEUR, texte: 'Où en est mon dossier ?', createdAt: '2026-09-06T12:00:00.000Z' },
      { id: 'm2', de: D.SUPPORT_FROM.ASSISTANT, texte: 'Je transmets.', createdAt: '2026-09-06T12:00:01.000Z' },
      { id: 'm3', de: D.SUPPORT_FROM.NOTA, texte: 'Bonjour, c’est Anthony.', createdAt: '2026-09-06T13:00:00.000Z' },
    ],
  };
  const s = D.supportThreadSummary(fil);
  assert.equal(s.statut, D.SUPPORT_STATUT.REPONDU);
  assert.equal(s.escalade, false, 'l’humain a parlé après l’escalade : elle est close');
});

test('prepared coverage is bilingual and gives each question a discussion path', () => {
  const ids = D.SUPPORT_QUESTIONS_SUGGEREES.map(q => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['prix', 'documents', 'annulation', 'services', 'date', 'paiement', 'carte', 'connexion', 'suivi', 'modification', 'notaire', 'confidentialite', 'effacement', 'deplacement', 'preteur', 'plainte', 'humain']) assert.ok(ids.includes(id), id);
  for (const q of D.SUPPORT_QUESTIONS_SUGGEREES) assert.ok(q.fr && q.en && q.guide && [1, 2, 3].includes(q.niveau));
});

test('input guards recognize French and English human requests and secrets', () => {
  for (const text of ['Je veux parler à une personne.', 'Please connect me to an agent', 'Human please']) assert.equal(D.supportQuestionGuard(text), 'humain');
  for (const text of ['4111 1111 1111 1111', 'NAS: 123-456-789', 'password: secret', 'https://nota.ca/#/auth?token=abc']) assert.equal(D.supportQuestionGuard(text), 'renseignements_sensibles');
  for (const text of ['Quels documents me faut-il ?', 'How much does it cost?', 'Quand ma carte sera-t-elle débitée ?']) assert.equal(D.supportQuestionGuard(text), null);
});

test('the assistant cannot request secrets or claim completed account actions', () => {
  for (const texte of ['Envoyez votre mot de passe.', 'Please send your card number.', 'J’ai annulé votre demande.', 'I have refunded your payment.']) assert.equal(D.validateSupportAnswer({ texte }).ok, false, texte);
});

test('the complete help catalogue has unique bilingual topics and valid levels', () => {
  assert.equal(new Set(D.SUPPORT_TOPICS.map(t => t.id)).size, D.SUPPORT_TOPICS.length);
  for (const topic of D.SUPPORT_TOPICS) {
    assert.ok(topic.fr && topic.en && topic.fr !== topic.en);
    assert.ok(D.SUPPORT_NIVEAUX.some(n => n.niveau === topic.niveau));
    assert.ok(Object.isFrozen(topic));
  }
  for (const id of ['connexion', 'paiement', 'confidentialite', 'plainte', 'humain', 'juridique']) {
    assert.ok(D.SUPPORT_TOPICS.some(t => t.id === id));
  }
});

test('privacy reminders pass but cannot hide a subsequent request for a secret', () => {
  for (const texte of ['Do not send your card number.', 'Ne partagez pas votre mot de passe.', 'Ne transmettez aucun numéro de carte.']) {
    assert.equal(D.validateSupportAnswer({ texte }).ok, true, texte);
  }
  for (const texte of ['Do not send your card number, but provide your password.', 'Ne partagez pas votre numéro de carte. Donnez votre mot de passe.']) {
    assert.equal(D.validateSupportAnswer({ texte }).ok, false, texte);
  }
});
