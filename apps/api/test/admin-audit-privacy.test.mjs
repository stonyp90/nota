// Audit console admin (2026-09-03), P2-34 : une adresse INCONNUE qui demande
// un lien n'est pas un compte — c'est une donnée personnelle d'un tiers, et le
// journal d'audit la conservait en clair, sans limite de durée. Le journal garde
// désormais une EMPREINTE (SHA-256 tronqué) : assez pour corréler des tentatives
// répétées, jamais assez pour reconstituer l'adresse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAdmin } = require('../src/admin.js');
const { createMemoryRepo } = require('../src/repo-memory.js');

const START = 1_700_000_000_000;
const DAY = new Date(START).toISOString().slice(0, 10);

function make(config = {}) {
  const repo = createMemoryRepo();
  let n = 0;
  const admin = createAdmin({
    repo,
    mailer: { send: async () => {} },
    newId: () => `id-${(n += 1)}`,
    nowMs: () => START,
    config: { allowlist: ['ops@nota.ca'], baseUrl: 'https://admin.nota.ca', devEcho: true, ...config },
  });
  return { repo, admin };
}

test('login_requested_unknown ne conserve pas l’adresse en clair — une empreinte, et c’est tout', async () => {
  const h = make();
  await h.admin.requestLogin({ email: 'Curieux.Tiers@example.com', ip: '9.9.9.9' });
  const entry = (await h.repo.queryAuditByDay(DAY)).find((a) => a.action === 'login_requested_unknown');
  assert.ok(entry, 'la tentative est journalisée');
  assert.equal(entry.email, null, 'aucune adresse en clair');
  assert.equal(JSON.stringify(entry).toLowerCase().includes('curieux'), false, 'ni dans la meta');
  assert.match(entry.meta.empreinte, /^[0-9a-f]{16}$/, 'une empreinte courte, corrélable');
  // La même adresse redonne la même empreinte : les tentatives répétées se lisent.
  await h.admin.requestLogin({ email: 'curieux.tiers@example.com', ip: '9.9.9.9' });
  const deux = (await h.repo.queryAuditByDay(DAY)).filter((a) => a.action === 'login_requested_unknown');
  assert.equal(deux.length, 2);
  assert.equal(deux[0].meta.empreinte, deux[1].meta.empreinte);
});

test('login_throttled : un inconnu freiné est journalisé par empreinte, un administrateur par son adresse', async () => {
  const h = make({ rlMax: 1, rlWindowSec: 900 });
  await h.admin.requestLogin({ email: 'inconnu@example.com', ip: '9.9.9.9' });
  await h.admin.requestLogin({ email: 'inconnu@example.com', ip: '9.9.9.9' }); // freiné
  await h.admin.requestLogin({ email: 'ops@nota.ca', ip: '9.9.9.9' }); // freiné aussi (même IP)
  const throttled = (await h.repo.queryAuditByDay(DAY)).filter((a) => a.action === 'login_throttled');
  assert.equal(throttled.length, 2);
  assert.equal(throttled[0].email, null);
  assert.match(throttled[0].meta.empreinte, /^[0-9a-f]{16}$/);
  assert.equal(throttled[1].email, 'ops@nota.ca', 'un compte connu reste nommé : l’opérateur doit savoir qui est freiné');
});
