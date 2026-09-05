'use strict';

/**
 * The whole local stack in ONE terminal: `npm run local`.
 *
 * The seeded, no-docker path used to be a four-terminal ritual — `api:local`,
 * `dev`, `admin:local`, `dev:admin` — with the ports and the two wiring
 * variables (NOTA_API_BASE, NOTA_ADMIN_API) carried in someone's head. Getting
 * one of them wrong gives a console that renders and silently talks to nothing,
 * which is the worst possible failure for an agent iterating alone.
 *
 * So the four processes, their ports and their wiring are declared here, once.
 * Every one runs under `dev-watch.js`, so an edit anywhere under the API source
 * restarts what serves it. Output is prefixed per service; Ctrl-C stops all
 * four.
 *
 * CE QUE CE SCRIPT NE SAIT PAS. Ses enfants sont des SUPERVISEURS, et un
 * superviseur ne meurt pas quand son serveur meurt : il annonce l'arrêt et
 * attend une modification. Donc un service qui refuse de démarrer — un port
 * déjà pris, le cas le plus fréquent quand la pile docker tourne encore — ne
 * remonte JAMAIS jusqu'ici : la bannière ci-dessous s'affiche entière et les
 * quatre adresses qu'elle donne peuvent ne rien servir. La trace EADDRINUSE
 * passe bien dans la sortie préfixée, mais elle se noie. Le verdict, lui, se
 * demande : `npm run local:check` interroge les quatre surfaces.
 *
 * Ports are overridable (NOTA_PORT_API, NOTA_PORT_WEB, NOTA_PORT_ADMIN_API,
 * NOTA_PORT_ADMIN). This path is IN-MEMORY: TABLE_NAME is deliberately dropped
 * from the children's environment so each server seeds itself from
 * `dev-fixtures.js`. For the DynamoDB-backed stack, use `docker compose up`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { REPO_ROOT } = require('./source-fingerprint');

const PORTS = {
  api: Number(process.env.NOTA_PORT_API || 8788),
  web: Number(process.env.NOTA_PORT_WEB || 4173),
  adminApi: Number(process.env.NOTA_PORT_ADMIN_API || 8790),
  admin: Number(process.env.NOTA_PORT_ADMIN || 4174),
};

const watcher = path.join('apps', 'api', 'scripts', 'dev-watch.js');

const SERVICES = [
  {
    name: 'api',
    entry: path.join('apps', 'api', 'local-server.js'),
    env: { PORT: String(PORTS.api) },
  },
  {
    name: 'admin-api',
    entry: path.join('apps', 'api', 'admin-local-server.js'),
    env: {
      PORT: String(PORTS.adminApi),
      // The magic link must land on the admin CONSOLE, not on the API.
      NOTA_ADMIN_BASE_URL: `http://localhost:${PORTS.admin}`,
    },
  },
  {
    name: 'web',
    entry: path.join('apps', 'web', 'run-local.mjs'),
    env: { PORT: String(PORTS.web), NOTA_API_BASE: `http://localhost:${PORTS.api}` },
    // public/ is re-read on every request; only the server file needs a restart.
    watch: 'apps/web/run-local.mjs',
  },
  {
    name: 'admin',
    entry: path.join('apps', 'admin', 'run-local.mjs'),
    env: { PORT: String(PORTS.admin), NOTA_ADMIN_API: `http://localhost:${PORTS.adminApi}` },
    watch: 'apps/admin/run-local.mjs,apps/admin/dev-server.mjs',
  },
];

const children = [];
let stopping = false;

function prefix(name, stream, chunk) {
  for (const line of String(chunk).split('\n')) {
    if (line.trim()) stream.write(`[${name}] ${line}\n`);
  }
}

function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (!c.killed) c.kill('SIGTERM');
  }
  // NOT unref'd: the exit code has to survive, and an unref'd timer lets the
  // process fall out of the loop with 0 while a service is reporting a failure.
  setTimeout(() => process.exit(code), 200);
}

for (const svc of SERVICES) {
  const env = { ...process.env, ...svc.env };
  // In-memory mode: a stray TABLE_NAME in the shell would silently point every
  // surface at an unseeded DynamoDB and empty the carnet.
  delete env.TABLE_NAME;
  delete env.ADMIN_TABLE_NAME;
  if (svc.watch) env.NOTA_WATCH_PATHS = svc.watch;
  else delete env.NOTA_WATCH_PATHS;

  const child = spawn(process.execPath, [watcher, svc.entry], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.on('error', (err) => {
    console.error(`[dev-all] ${svc.name} n'a pas pu démarrer — ${(err && err.message) || err}`);
    stopAll(1);
  });
  child.stdout.on('data', (c) => prefix(svc.name, process.stdout, c));
  child.stderr.on('data', (c) => prefix(svc.name, process.stderr, c));
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.error(`[dev-all] ${svc.name} s'est arrêté (${signal || 'code ' + code}) — arrêt de la pile.`);
    stopAll(1);
  });
  children.push(child);
}

console.log(
  [
    '',
    'Nota, en local et amorcé (mémoire, aucune AWS) :',
    `  carnet public   http://localhost:${PORTS.web}`,
    `  API publique    http://localhost:${PORTS.api}`,
    `  console admin   http://localhost:${PORTS.admin}`,
    `  API admin       http://localhost:${PORTS.adminApi}`,
    '',
    "  Connexion admin : demander un lien pour admin@nota.local — hors production",
    "  la réponse renvoie le lien magique (devLink) et la page l'affiche.",
    '  Ces adresses sont celles qui ONT ÉTÉ DEMANDÉES, pas un constat : un port',
    '  déjà pris tue le service sans que ce script le sache. Le constat se prend',
    '  avec « npm run local:check », qui interroge les quatre surfaces.',
    '',
  ].join('\n'),
);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stopAll(0));
