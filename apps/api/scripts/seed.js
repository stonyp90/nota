'use strict';

/**
 * Seed the local DynamoDB tables with the demo world. Idempotent.
 *
 *   npm run local:seed                      # against a running docker stack
 *   docker compose run --rm seed            # from inside the compose network
 *   npm run local:seed -- --force           # rewrite the analytics history too
 *
 * This is the piece the docker path was missing: `create-table.js` creates the
 * tables and issues zero PutItem, and both dev servers only seed their
 * IN-MEMORY branch (`useDynamo = !!TABLE_NAME`) — which docker never takes. So
 * a cold `docker compose up` used to serve an empty carnet and an empty admin
 * console, and every local check made against it was a check of nothing.
 *
 * The data comes from `dev-fixtures.js`, byte for byte the set the in-memory
 * servers use, written here through the SAME DynamoDB adapter the containers
 * read with — so what is seeded is what the surfaces serve, by construction
 * rather than by hope.
 */
const { createDynamoRepo } = require('../src/repo-dynamo');
const { seedInto, devToday } = require('./dev-fixtures');

const tableName = process.env.TABLE_NAME || 'nota';
const adminTableName = process.env.ADMIN_TABLE_NAME || `${tableName}-admin`;
const endpoint = process.env.DYNAMO_ENDPOINT || 'http://localhost:8000';
const region = process.env.AWS_REGION || 'ca-central-1';
const force = process.argv.includes('--force');

// A guard, not a formality: this script writes demo offers and demo notaries.
// Pointed at a regional endpoint it would publish fiction into a real carnet.
if (!/localhost|127\.0\.0\.1|dynamodb-local/.test(endpoint)) {
  console.error(
    `seed: refus — DYNAMO_ENDPOINT "${endpoint}" n'est pas une base locale.\n` +
      'Ce script écrit des données de démonstration ; il ne parle qu\'à DynamoDB Local.',
  );
  process.exit(2);
}

// DynamoDB Local ignores credentials, but the SDK refuses to sign a request
// without any. Supply throwaway ones so the script runs from a bare shell.
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'local';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'locallocal';

(async () => {
  const repo = createDynamoRepo({ tableName, adminTableName, endpoint, region });
  const today = devToday();
  console.log(`Seed du monde de démonstration → ${tableName} @ ${endpoint} (jour ouvrable ${today})`);
  const summary = await seedInto(repo, { today, force, log: (l) => console.log(l) });
  console.log(
    `Fait : ${summary.bids} offres, ${summary.partners} parrains, ${summary.notaries} notaires, ` +
      `${summary.stats} compteurs. Rejouable à volonté (npm run local:seed).`,
  );
})().catch((e) => {
  console.error('seed: échec —', (e && e.message) || e);
  process.exit(1);
});
