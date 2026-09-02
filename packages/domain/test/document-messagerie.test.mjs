// LE DOCUMENT DE MESSAGERIE — la règle, avant la plomberie (ADR 0032).
//
// La conversation entre le client et le notaire retenu porte désormais des
// documents. Le domaine décide de ce qui est recevable ; le stockage et les
// routes ne font qu'appliquer.
//
// Les contraintes reprennent celles du dossier (`DOSSIER_FILE`) — PDF ou photo,
// 15 Mo, nom assaini — parce qu'un notaire doit pouvoir ouvrir le fichier, et
// parce qu'un format inerte est la seule protection du produit contre un
// fichier hostile : il n'y a pas d'analyse antivirale (ADR 0032, « ce que cette
// décision ne règle pas »).
//
// La conversation n'existe qu'après rétention. Un document non plus.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const RETENUE = { id: 'b1', dateISO: '2026-09-20', status: D.STATUS.RETENUE, notaryId: 'n1' };
const OUVERTE = { ...RETENUE, status: D.STATUS.OUVERTE };
const codes = (r) => (r.errors || []).map((e) => e.code);

test('un document recevable : PDF, sous la borne, envoyé par une des deux parties', () => {
  const r = D.validateChatDocument({
    bid: RETENUE, de: D.CHAT_FROM.CLIENT,
    nom: 'relevé hypothécaire.pdf', taille: 2 * 1024 * 1024, type: 'application/pdf',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.nom, 'relevé hypothécaire.pdf');
  assert.equal(r.contentType, 'application/pdf');
});

test('une photo passe — un client photographie son compte de taxes', () => {
  for (const [nom, type] of [['taxes.jpg', 'image/jpeg'], ['permis.heic', 'image/heic'], ['plan.png', 'image/png']]) {
    const r = D.validateChatDocument({ bid: RETENUE, de: D.CHAT_FROM.CLIENT, nom, taille: 1000, type });
    assert.equal(r.ok, true, nom + ' : ' + JSON.stringify(r.errors));
  }
});

test('un exécutable est refusé — c’est la seule protection du produit', () => {
  const r = D.validateChatDocument({
    bid: RETENUE, de: D.CHAT_FROM.NOTAIRE, nom: 'acte.exe', taille: 10, type: 'application/octet-stream',
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('format_refuse'), JSON.stringify(r.errors));
});

test('le type DÉCLARÉ doit s’accorder au nom — sinon l’autorisation signée mentirait', () => {
  // L'autorisation de dépôt fige le content-type. Si le nom dit .pdf et que le
  // type dit image/png, l'un des deux est faux, et c'est le stockage qui
  // portera le mensonge.
  const r = D.validateChatDocument({
    bid: RETENUE, de: D.CHAT_FROM.CLIENT, nom: 'faux.pdf', taille: 10, type: 'image/png',
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('type_incoherent'), JSON.stringify(r.errors));
});

test('au-delà de la borne, le refus est LOCAL — jamais après un téléversement', () => {
  const r = D.validateChatDocument({
    bid: RETENUE, de: D.CHAT_FROM.CLIENT, nom: 'gros.pdf', taille: D.DOSSIER_FILE.maxBytes + 1, type: 'application/pdf',
  });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('taille_refusee'));
  // Le message dit la borne : un refus sans le chiffre oblige à deviner.
  assert.match(r.errors.find((e) => e.code === 'taille_refusee').message, /15/);
});

test('une taille absente est refusée — on ne signe pas une autorisation sans borne', () => {
  const r = D.validateChatDocument({ bid: RETENUE, de: D.CHAT_FROM.CLIENT, nom: 'a.pdf', type: 'application/pdf' });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('taille_refusee'));
});

test('le nom est ASSAINI : ni chemin, ni caractère de contrôle', () => {
  const r = D.validateChatDocument({
    bid: RETENUE, de: D.CHAT_FROM.CLIENT,
    nom: 'C:\\fakepath\\..\\..\\etc\\relevé\u0000.pdf', taille: 10, type: 'application/pdf',
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.nom.includes('/'), false);
  assert.equal(r.nom.includes('\\'), false);
  assert.equal(/[\u0000-\u001f]/.test(r.nom), false);
});

test('sans rétention, aucun document — la conversation n’existe pas encore', () => {
  const r = D.validateChatDocument({ bid: OUVERTE, de: D.CHAT_FROM.CLIENT, nom: 'a.pdf', taille: 10, type: 'application/pdf' });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('offre_non_retenue'));
});

test('un expéditeur qui n’est ni le client ni le notaire est refusé', () => {
  const r = D.validateChatDocument({ bid: RETENUE, de: 'nota', nom: 'a.pdf', taille: 10, type: 'application/pdf' });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('expediteur_invalide'));
});

test('la CLÉ de stockage est dérivée, jamais fournie — un appelant ne choisit pas où il écrit', () => {
  const cle = D.documentStorageKey('b1', 'd-42', 'relevé.pdf');
  assert.match(cle, /^offres\/b1\/d-42\./, cle);
  assert.match(cle, /\.pdf$/, 'l’extension survit — elle porte le format');
  // Aucune traversée possible, quel que soit ce qu'on lui passe.
  const hostile = D.documentStorageKey('../../autre', 'd/../x', '../../../etc/passwd');
  assert.equal(hostile.includes('..'), false, hostile);
  assert.equal(hostile.startsWith('offres/'), true, hostile);
});

test('le nombre de documents par conversation est borné', () => {
  const pleine = { ...RETENUE, documents: new Array(D.CHAT_DOCUMENTS_MAX).fill({ id: 'x' }) };
  const r = D.validateChatDocument({ bid: pleine, de: D.CHAT_FROM.CLIENT, nom: 'a.pdf', taille: 10, type: 'application/pdf' });
  assert.equal(r.ok, false);
  assert.ok(codes(r).includes('trop_de_documents'), JSON.stringify(r.errors));
});
