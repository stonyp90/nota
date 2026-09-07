// D'où vient la clé de l'assistant (ADR 0046).
//
// Terraform écrit la valeur de CHAQUE variable dans son fichier d'état, en
// clair, `sensitive = true` compris : le marqueur ne masque que la sortie de
// la console. L'état de ce dépôt est LOCAL — `infra/terraform.tfstate`, à côté
// du code, plus sa copie `.backup`. Une clé d'API posée dans une variable
// Terraform est donc une clé déposée en clair sur le disque, dans un fichier
// que personne ne relit.
//
// Cette suite tient la conséquence : l'infrastructure ne connaît que le NOM
// d'un paramètre SSM, jamais sa valeur — et le garde est HOSTILE, il lit la
// source Terraform elle-même, parce qu'une variable « juste pour dépanner »
// est exactement la façon dont ce genre de règle se perd.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/handler.js');
const { createMemoryRepo } = require('../src/repo-memory.js');
const { createEnvSecrets } = require('../src/secrets-port.js');

const TF = (f) => readFileSync(fileURLToPath(new URL('../../../infra/' + f, import.meta.url)), 'utf8');

const ask = (a, texte) =>
  a.handle({ method: 'POST', path: '/support/messages', headers: {}, body: JSON.stringify({ texte }) });

function app({ env, secrets } = {}) {
  const repo = createMemoryRepo([]);
  return {
    ...createApp(repo, {
      now: () => '2026-08-12',
      nowMs: () => 1_760_000_000_000,
      newId: (() => { let n = 0; return () => 'id-' + ++n; })(),
      env: env || {},
      ...(secrets ? { secrets } : {}),
    }),
    repo,
  };
}

// --- 1. Le garde hostile sur l'infrastructure --------------------------------

test('AUCUNE variable Terraform ne porte la clé de l’assistant', () => {
  // Le nom du paramètre, oui. La valeur, jamais.
  const src = TF('notifications.tf') + TF('lambda.tf') + TF('variables.tf');
  assert.ok(
    !/variable\s+"assistant_api_key"/.test(src),
    'une variable `assistant_api_key` est réapparue : sa valeur finirait en clair dans terraform.tfstate'
  );
  assert.ok(
    !/ANTHROPIC_API_KEY\s*=\s*var\./.test(src),
    'la clé est passée à la Lambda depuis une variable Terraform : elle transite alors par l’état'
  );
});

test('l’infrastructure passe le NOM du paramètre, et accorde le droit de le lire', () => {
  const lambda = TF('lambda.tf');
  const notifs = TF('notifications.tf');
  assert.match(lambda, /NOTA_ASSISTANT_KEY_PARAM/, 'la Lambda reçoit le nom du paramètre');
  assert.match(notifs + lambda, /variable\s+"assistant_key_param"/, 'le nom est une variable, jamais un littéral');
  // Le droit de lecture doit exister, et être BORNÉ à ce paramètre.
  const iam = TF('lambda.tf') + TF('notifications.tf') + TF('observability.tf');
  assert.match(iam, /ssm:GetParameter/, 'la Lambda peut lire le paramètre');
  assert.ok(!/"ssm:\*"/.test(iam), 'jamais un droit SSM en étoile');
});

// --- 2. La résolution, côté code ---------------------------------------------

test('sans rien de configuré, SSM n’est même pas interrogé', async () => {
  const secrets = createEnvSecrets({});
  const a = app({ env: {}, secrets });
  await ask(a, 'Bonjour ?');
  assert.deepEqual(secrets.asked, [], 'aucun aller-retour inutile sur le chemin chaud');
});

test('le nom du paramètre configuré est celui qu’on demande à SSM', async () => {
  const secrets = createEnvSecrets({});
  const a = app({ env: { NOTA_ASSISTANT_KEY_PARAM: '/nota/assistant/anthropic-api-key' }, secrets });
  await ask(a, 'Bonjour ?');
  assert.deepEqual(secrets.asked, ['/nota/assistant/anthropic-api-key']);
});

test('un paramètre absent DÉGRADE : la messagerie répond comme sans assistant', async () => {
  const secrets = createEnvSecrets({}); // le paramètre n'existe pas
  const a = app({ env: { NOTA_ASSISTANT_KEY_PARAM: '/nota/assistant/anthropic-api-key' }, secrets });
  const res = await ask(a, 'Bonjour ?');
  assert.equal(res.statusCode, 201, 'la question passe quand même');
  assert.equal(JSON.parse(res.body).reponse, undefined, 'et rien n’est inventé');
});

test('SSM momentanément muet ne condamne pas l’assistant jusqu’au prochain déploiement', async () => {
  // Le piège : mémoriser « pas de clé » au premier échec fige la Lambda dans
  // l'état dégradé pour toute la vie du conteneur, soit des heures.
  let vivant = false;
  const secrets = {
    asked: [],
    async get(name) {
      this.asked.push(name);
      return vivant ? 'sk-ant-test' : null;
    },
  };
  const a = app({ env: { NOTA_ASSISTANT_KEY_PARAM: '/nota/k' }, secrets });
  await ask(a, 'Première question, SSM muet');
  vivant = true;
  await ask(a, 'Deuxième question, SSM revenu');
  assert.equal(secrets.asked.length, 2, 'le second message redemande la clé');
});

test('ANTHROPIC_API_KEY passe devant : le développement local n’a ni SSM ni état à protéger', async () => {
  const secrets = createEnvSecrets({ '/nota/k': 'depuis-ssm' });
  const a = app({ env: { ANTHROPIC_API_KEY: 'depuis-env', NOTA_ASSISTANT_KEY_PARAM: '/nota/k' }, secrets });
  await ask(a, 'Bonjour ?');
  assert.deepEqual(secrets.asked, [], 'la clé locale court-circuite SSM');
});
