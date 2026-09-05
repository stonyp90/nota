'use strict';

/**
 * A dependency-free reload supervisor: `node scripts/dev-watch.js <entry.js>`.
 *
 * WHY NOT `node --watch`. Node's watcher is built on inotify inside a Linux
 * container, and a write made on the macOS host over a bind mount raises no
 * inotify event — so `--watch` looks like it works, never fires, and the
 * container serves stale code exactly as before, with the added danger that the
 * command line now claims otherwise. This supervisor POLLS a content digest
 * instead (`source-fingerprint.js`), which is oblivious to how the bytes got
 * there and behaves the same on every host, mount and filesystem.
 *
 * A crashed child is NOT fatal: the supervisor reports the exit and waits for
 * the next edit, so a syntax error costs one message rather than a container in
 * a restart loop that nobody reads.
 *
 * THE ONE THING IT CANNOT RELOAD IS ITSELF: a node process cannot swap its own
 * code, and a supervisor that exited to be replaced would just stop the
 * container. So it watches its own two files separately and SAYS SO when they
 * change, rather than quietly running old supervision logic — the failure mode
 * it exists to abolish.
 *
 * Knobs: NOTA_WATCH_PATHS (comma-separated, relative to the repo root),
 * NOTA_WATCH_INTERVAL_MS (default 800).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');
const { sourceFingerprint, watchPaths, REPO_ROOT } = require('./source-fingerprint');

const entry = process.argv[2];
if (!entry) {
  console.error('dev-watch: usage — node apps/api/scripts/dev-watch.js <entry.js> [args...]');
  process.exit(2);
}
const args = process.argv.slice(3);
const interval = Number(process.env.NOTA_WATCH_INTERVAL_MS || 800);
const paths = watchPaths();
const label = path.basename(entry);

// The supervisor's own source, tracked apart from the child's.
const SELF_PATHS = ['apps/api/scripts/dev-watch.js', 'apps/api/scripts/source-fingerprint.js'];
const selfHash = sourceFingerprint({ paths: SELF_PATHS }).hash;
let selfWarned = false;

let child = null;
let current = sourceFingerprint({ paths }).hash;
let stopping = false;
// A restart kills the child on purpose. Without this flag the exit handler
// below announced a crash every single time, and a log that cries wolf on every
// reload is a log nobody reads the day it reports a real one.
let restarting = false;

function start(reason) {
  child = spawn(process.execPath, [entry, ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    // Aucune empreinte n'est passée à l'enfant : il calcule la SIENNE au
    // démarrage, sur les fichiers qu'il vient réellement de charger. Une valeur
    // héritée du superviseur décrirait l'arbre au moment du spawn, pas le code
    // servi — la nuance exacte que l'en-tête `x-nota-source` existe pour lever.
    env: process.env,
  });
  console.log(`[watch:${label}] source ${current} — ${reason}`);
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping || restarting) return;
    console.error(
      `[watch:${label}] le processus s'est arrêté (${signal || 'code ' + code}). ` +
        'En attente d\'une modification pour repartir.',
    );
  });
}

function restart(next) {
  const previous = current;
  current = next;
  if (!child) return start(`reprise après ${previous} → ${next}`);
  console.log(`[watch:${label}] source ${previous} → ${next} — redémarrage`);
  // Un SEUL redémarrage en vol à la fois. Sans ce garde-fou, deux changements
  // détectés avant que l'enfant ait fini de mourir posaient DEUX gestionnaires
  // `exit` sur le même processus : les deux tiraient, deux serveurs partaient,
  // le second échouait sur EADDRINUSE — et comme `child` désignait le second,
  // le superviseur se croyait mort pendant qu'un orphelin servait le port.
  // Le redémarrage déjà lancé repartira sur `current`, qui vient d'être mis à
  // jour, donc rien n'est perdu.
  if (restarting) return;
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    start(`redémarré sur ${current}`);
  });
  child.kill('SIGTERM');
}

start('démarrage');

const timer = setInterval(() => {
  let next;
  try {
    next = sourceFingerprint({ paths }).hash;
  } catch (err) {
    console.error(`[watch:${label}] lecture des sources impossible — ${err.message}`);
    return;
  }
  if (next !== current) restart(next);

  if (!selfWarned && sourceFingerprint({ paths: SELF_PATHS }).hash !== selfHash) {
    selfWarned = true;
    console.warn(
      `[watch:${label}] ATTENTION — dev-watch.js a changé, mais un superviseur ne peut pas se ` +
        'recharger lui-même. Le code SERVI reste à jour ; la supervision, non. ' +
        'Relancez le service (docker compose restart, ou Ctrl-C puis npm run local).',
    );
  }
}, interval);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopping = true;
    clearInterval(timer);
    if (child) child.kill(sig);
    process.exit(0);
  });
}
