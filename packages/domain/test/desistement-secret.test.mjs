// LE DÉSISTEMENT FERME LA CONVERSATION (art. 37 du Code de déontologie).
//
//   « Le notaire ne doit pas, à moins que la nature du cas ne l'exige, révéler
//     qu'une personne a fait appel à ses services. »
//
// Quand un notaire se désiste, l'offre retourne au carnet et un AUTRE notaire
// peut la retenir. Si le fil et les documents survivaient, le second recevrait
// l'intégralité de l'échange du premier : il apprendrait que ce client a fait
// appel à un confrère, ce qu'il a écrit, et les pièces qu'il a transmises.
//
// L'ADR 0032 a aggravé l'enjeu en ajoutant des documents au même fil — des
// relevés de prêt, des comptes de taxes, des pièces d'identité.
//
// La conversation appartient à la relation, pas à l'offre. Elle meurt avec elle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../index.js');

const RETENUE = {
  id: 'b1', dateISO: '2026-09-20', status: D.STATUS.RETENUE,
  notaryId: 'n1', etude: 'Étude A', montant: 2000,
  messages: [
    { id: 'm1', de: 'notaire', texte: 'Bonjour, il me faut votre relevé.', createdAt: '2026-09-02T10:00:00.000Z' },
    { id: 'm2', de: 'client', texte: 'Le voici.', createdAt: '2026-09-02T10:05:00.000Z' },
  ],
  documents: [
    { id: 'd1', de: 'client', nom: 'relevé.pdf', taille: 1024, etat: 'pret', cle: 'offres/b1/d1.pdf' },
  ],
};

test('ART. 37 — le fil ne survit pas au désistement', () => {
  const relache = D.releasedBid(RETENUE);
  assert.equal(relache.status, D.STATUS.OUVERTE);
  assert.equal(relache.notaryId, null);
  assert.equal(relache.etude, null);
  assert.deepEqual(relache.messages, [], 'aucun message ne passe au notaire suivant');
  assert.deepEqual(relache.documents, [], 'aucun document non plus');
});

test('le client garde sa date, son montant et son dossier', () => {
  const relache = D.releasedBid({ ...RETENUE, dossier: { piece_identite: 'permis.pdf' } });
  assert.equal(relache.dateISO, '2026-09-20');
  assert.equal(relache.montant, 2000);
  // Le DOSSIER est au client, pas à la conversation : il voyage avec l'offre,
  // c'est son objet même. Seul l'échange avec CE notaire disparaît.
  assert.deepEqual(relache.dossier, { piece_identite: 'permis.pdf' });
});

test('les clés des documents effacés sont RENDUES — pour que le stockage suive', () => {
  // Laisser des octets chiffrés que plus personne ne peut atteindre pendant
  // 400 jours est un risque qui ne rapporte rien. Le domaine ne supprime pas —
  // il dit quoi supprimer, et la couche qui possède le stockage s'exécute.
  const cles = D.releasedDocumentKeys(RETENUE);
  assert.deepEqual(cles, ['offres/b1/d1.pdf']);
  assert.deepEqual(D.releasedDocumentKeys({ ...RETENUE, documents: [] }), []);
  assert.deepEqual(D.releasedDocumentKeys({}), []);
});

test('une offre sans conversation se relâche sans erreur', () => {
  const relache = D.releasedBid({ id: 'b2', dateISO: '2026-09-21', status: D.STATUS.RETENUE, notaryId: 'n1' });
  assert.deepEqual(relache.messages, []);
  assert.deepEqual(relache.documents, []);
});
