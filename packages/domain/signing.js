(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NotaSigning = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var SESSION_MS = 30 * 60 * 1000;
  var AUTH_FRESH_MS = 60 * 60 * 1000;
  var PRESENCE_MS = 25 * 1000;
  var DOCUMENT = Object.freeze({
    title: 'Exercice de signature — document sans effet juridique',
    text: 'NOTA — EXERCICE DE SIGNATURE\n\nCe document sert uniquement à essayer la visioconférence et la preuve cryptographique de Nota. Il ne constitue pas un acte notarié, un mandat ni une signature officielle. Aucun engagement juridique ni paiement ne résulte de cet exercice.\n\nEn apposant ma confirmation, je confirme uniquement avoir essayé ce document de démonstration. L’identité civile, la capacité et le consentement juridique ne sont pas attestés par cet exercice.\n\nVersion : nota-signing-rehearsal-v1',
  });
  function live(session, at) { return !!session && at < session.expiresAt && !['closed', 'complete'].includes(session.status); }
  function observed(session, at) {
    return ['notary', 'client'].every(function (role) {
      var p = session.participants[role];
      return p && p.joined && p.connected === true && Number.isFinite(p.lastSeenAt) && p.lastSeenAt <= at && at - p.lastSeenAt < PRESENCE_MS;
    });
  }
  function decision(session, role, action, at) {
    if (!['notary', 'client'].includes(role)) return { ok: false, code: 'interdit' };
    if (!live(session, at)) return { ok: false, code: 'session_terminee' };
    if (action === 'close') return { ok: true, status: 'closed' };
    if (action === 'pause') return { ok: true, status: 'paused' };
    if (action === 'join') return { ok: role === 'client' && !session.participants.client.joined && session.status === 'waiting', status: 'waiting', code: 'etape_invalide' };
    if (role === 'notary' && action === 'admit') return { ok: session.status === 'waiting' && session.participants.client.joined, status: 'admitted', code: 'etape_invalide' };
    if (!observed(session, at)) return { ok: false, code: 'presence_requise' };
    if (role === 'notary' && action === 'review') return { ok: ['admitted', 'paused'].includes(session.status) && session.admitted === true, status: 'reviewed', code: 'etape_invalide' };
    if (role === 'notary' && action === 'release') return { ok: session.status === 'reviewed', status: 'released', code: 'etape_invalide' };
    if (action === 'acknowledge') {
      var allowed = session.status === 'released' && !session.participants[role].acknowledged && (role === 'client' || session.participants.client.acknowledged);
      return { ok: allowed, status: role === 'notary' ? 'complete' : 'released', code: 'etape_invalide' };
    }
    return { ok: false, code: 'etape_invalide' };
  }
  function proofMessage(sessionId, digest, role, nonce) {
    return ['NOTA-REHEARSAL-V1', sessionId, digest, role, nonce].join('\n');
  }
  function signalMessage(sessionId, role, type, digest) {
    return ['NOTA-SIGNAL-V1', sessionId, role, type, digest].join('\n');
  }
  return Object.freeze({ SESSION_MS: SESSION_MS, AUTH_FRESH_MS: AUTH_FRESH_MS, PRESENCE_MS: PRESENCE_MS, DOCUMENT: DOCUMENT, live: live, observed: observed, decision: decision, proofMessage: proofMessage, signalMessage: signalMessage });
});
