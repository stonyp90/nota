import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const emails = require('../src/emails.js');
const BASE = 'https://gonota.ca';
const TODAY = '2026-09-08';
const CTX = {
  serviceId: 'refinancement',
  dateISO: '2026-08-19',
  montant: 1500,
  tier: 'prioritaire',
  days: 7,
  bids: [{ serviceId: 'refinancement', dateISO: '2026-08-20', montant: 2400, tier: 'rapide' }],
  n: 2,
  notaryEmail: 'notaire@example.ca',
  email: 'client@example.ca',
  note: 4,
  commentaire: 'Merci.',
  code: 'EVEROY',
  etude: 'Étude Tremblay',
  notaire: { nom: 'Me Jeanne Tremblay', etude: 'Étude Tremblay', telephone: '418 555-0199', adresse: '12, rue Saint-Jean, Québec', courriel: 'jeanne@etude.ca', lienCNQ: 'https://www.cnq.org/fiche/jt' },
  bareme: [{ maxJours: 3, taux: 0.3, frais: 450 }, { maxJours: 14, taux: 0.1, frais: 150 }],
  annulation: { taux: 0.3, frais: 450, joursAvant: 2, dedommagement: { notaire: true, verse: true, transferId: 'tr_1' } },
  client: { nom: 'Marie Roy', courriel: 'marie@exemple.ca', telephone: '(418) 555-0100', secteur: 'G1R', deplacement: 'notaire_25', preteur: 'desjardins' },
  dossier: { ready: false, missing: ['Pièce d’identité'], requis: [] },
  proposition: { montant: 1600, delta: 100, message: 'Bonjour', etude: 'Étude Tremblay' },
  demande: { documents: [{ id: 'releve', nom: 'Relevé hypothécaire' }], message: 'Merci', etude: 'Étude Tremblay' },
  message: 'Bonjour, à mardi.',
  document: 'quittance.pdf',
  texte: 'Réponse',
  sujet: 'Question',
  nom: 'Marie',
  secteur: 'G1R',
  distanceKm: 6,
  link: BASE + '/#auth?token=t0k3n',
  bidId: 'b1',
  baseUrl: BASE,
  unsubscribeUrl: BASE + '/api/unsubscribe?token=abc123',
};

for (const [key, render] of Object.entries(emails.TEMPLATES)) {
  test(`${key}: French and English select one complete language, including the footer`, () => {
    const fr = render({ ...CTX, emailLanguage: 'fr' });
    const en = render({ ...CTX, emailLanguage: 'en' });
    assert.match(fr.html, /<html lang="fr-CA">/);
    assert.doesNotMatch(fr.html, /lang="en-CA"|The Nota team|The notarial marketplace|Contact us/);
    assert.doesNotMatch(fr.text, /The Nota team|Contact us/);
    assert.match(fr.text, /L’équipe Nota/);
    assert.match(en.html, /<html lang="en-CA">/);
    assert.doesNotMatch(en.html, /L’équipe Nota|La place de marché notariale|Nous écrire/);
    assert.doesNotMatch(en.text, /L’équipe Nota|Nous écrire/);
    assert.match(en.text, /The Nota team/);
  });
}

test('configured default selects the subject, custom signature and preheader without joining translations', () => {
  const before = process.env.NOTA_EMAIL_LANGUAGE;
  process.env.NOTA_EMAIL_LANGUAGE = 'fr';
  try {
    const ctx = { ...CTX, __override: { subjectFr: 'Sujet français', subjectEn: 'English subject', preheaderFr: 'Aperçu français', preheaderEn: 'English preview', signatureFr: 'Votre équipe', signatureEn: 'Your team' } };
    const out = emails.clientWelcome(ctx);
    assert.equal(out.subject, 'Sujet français');
    assert.match(out.html, /Aperçu français/);
    assert.match(out.text, /Votre équipe/);
    assert.doesNotMatch(out.html + out.text, /English preview|Your team/);
    assert.equal(emails.renderSubjectOverride(ctx.__override, ctx), 'Sujet français');
    const en = emails.clientWelcome({ ...ctx, emailLanguage: 'en' });
    assert.equal(en.subject, 'English subject');
    assert.match(en.text, /Your team/);
  } finally {
    if (before === undefined) delete process.env.NOTA_EMAIL_LANGUAGE;
    else process.env.NOTA_EMAIL_LANGUAGE = before;
  }
});

test('composed campaigns follow the same selected language', () => {
  const out = emails.campaignMessage({ ...CTX, emailLanguage: 'fr', sujetFr: 'Nouvelles', sujetEn: 'News', corpsFr: 'Bonjour à vous.', corpsEn: 'Hello there.', ctaFr: 'Voir le carnet', ctaEn: 'View the calendar' });
  assert.equal(out.subject, 'Nouvelles');
  assert.match(out.text, /Bonjour à vous/);
  assert.doesNotMatch(out.html + out.text, /Hello there|View the calendar|The Nota team/);
});
