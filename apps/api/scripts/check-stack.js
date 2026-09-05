'use strict';

/**
 * Is the local stack up, FRESH, and SEEDED? `npm run local:check`.
 *
 * Three separate questions, and the middle one is the reason this exists. A
 * container that answers 200 with two-day-old code looks exactly like a healthy
 * one — the audit found the stack in precisely that state — so this compares the
 * `x-nota-source` digest each API server stamps on its responses against the
 * digest of the tree on disk right now. A mismatch is reported as STALE with
 * both digests, not as a vague warning.
 *
 * The third question matters just as much: a surface that answers 200 with an
 * EMPTY carnet is not a working stack, it is a working web server. So the check
 * also asserts the seed is visible where the surfaces read it.
 *
 * Exit code 0 only if every line passes. Ports follow the same environment
 * variables as `dev-all.js`, so it checks the docker stack and the in-memory
 * stack without being told which is running.
 */
const domain = require('@nota/domain');
const { sourceFingerprint } = require('./source-fingerprint');

const PORTS = {
  api: Number(process.env.NOTA_PORT_API || 8788),
  web: Number(process.env.NOTA_PORT_WEB || 4173),
  adminApi: Number(process.env.NOTA_PORT_ADMIN_API || 8790),
  admin: Number(process.env.NOTA_PORT_ADMIN || 4174),
};

const TIMEOUT_MS = Number(process.env.NOTA_CHECK_TIMEOUT_MS || 5000);
const expected = sourceFingerprint();

const results = [];
function record(ok, label, detail) {
  results.push({ ok, label, detail });
  console.log(`${ok ? '  ok  ' : ' ÉCHEC'} ${label}${detail ? ' — ' + detail : ''}`);
}

async function fetchOnce(url, init) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(timer);
  }
}

/** A live surface, on the expected status. */
async function probe(label, url, want, init) {
  try {
    const res = await fetchOnce(url, init);
    const ok = res.status === want;
    record(ok, label, ok ? url : `${url} → HTTP ${res.status} (attendu ${want})`);
    return ok ? res : null;
  } catch (err) {
    record(false, label, `${url} → injoignable (${(err && err.message) || err})`);
    return null;
  }
}

/** The digest the server stamped vs. the tree on disk. */
function freshness(label, res) {
  if (!res) return;
  const served = res.headers.get('x-nota-source');
  if (!served) {
    record(false, label, "aucun en-tête x-nota-source — serveur d'une version antérieure à la sonde ?");
    return;
  }
  record(
    served === expected.hash,
    label,
    served === expected.hash
      ? `source ${served}`
      : `PÉRIMÉ : le serveur rend ${served}, l'arbre de travail vaut ${expected.hash}. ` +
          'Le processus tourne sur du vieux code — redémarrez-le (docker compose restart api admin-api).',
  );
}

(async () => {
  console.log(`Pile locale — source attendue ${expected.hash} (${expected.files} fichiers)\n`);

  const month = domain.businessDay(null, process.env.NOTA_TIMEZONE).slice(0, 7);
  const carnet = await probe('API publique', `http://localhost:${PORTS.api}/bids?month=${month}`, 200);
  freshness('API publique — fraîcheur du code', carnet);
  if (carnet) {
    let bids = [];
    try {
      bids = (JSON.parse(carnet.text) || {}).bids || [];
    } catch { /* laissé vide : la ligne suivante le signale */ }
    record(bids.length > 0, 'API publique — carnet amorcé', `${bids.length} offres pour ${month}` +
      (bids.length ? '' : ' — lancez « npm run local:seed » (docker) ou « npm run local » (mémoire)'));
  }

  await probe('Site public', `http://localhost:${PORTS.web}/`, 200);

  // Unauthenticated: 401 is the healthy answer, and it carries the header.
  const adminApi = await probe('API admin', `http://localhost:${PORTS.adminApi}/admin/metrics/overview`, 401);
  freshness('API admin — fraîcheur du code', adminApi);

  await probe('Console admin', `http://localhost:${PORTS.admin}/`, 200);
  // The same route THROUGH the console's same-origin proxy: this is the wiring
  // that silently breaks (NOTA_ADMIN_API), and a console that renders proves
  // nothing about it.
  await probe('Console admin → API (proxy /api)', `http://localhost:${PORTS.admin}/api/admin/metrics/overview`, 401);

  const failed = results.filter((r) => !r.ok);
  console.log('');
  if (failed.length) {
    console.error(`${failed.length} vérification(s) en échec sur ${results.length}.`);
    process.exit(1);
  }
  console.log(`${results.length} vérifications, toutes vertes. La pile sert bien l'arbre courant.`);
})().catch((e) => {
  console.error('local:check —', (e && e.message) || e);
  process.exit(1);
});
