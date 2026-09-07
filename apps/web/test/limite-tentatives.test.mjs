/**
 * UN PLAFOND N'EST PAS UN REFUS.
 *
 * `/notary/session/request` et `/client/session/request` sont volontairement
 * muets sur l'existence d'un compte : au-delà du plafond ils rendent
 * `429 { ok: true, throttled: true }`, SANS tableau `errors` — un refus
 * détaillé dirait qui est notaire et qui ne l'est pas.
 *
 * Côté console, le repli générique lisait ce silence comme une porte fermée :
 * « Connexion refusée. » Un notaire qui redemande son lien parce que le
 * premier courriel tarde s'entend donc répondre qu'il n'a pas le droit
 * d'entrer — au moment précis où il essaie de travailler. Il doit lire la
 * seule chose vraie : la fenêtre, telle que l'API la donne (`Retry-After`),
 * jamais un délai inventé.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN_SRC = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP_SRC = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const HTML_SRC = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');

const I18N = (() => {
  const src = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  return mod.exports;
})();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// A 429 exactly as the API shapes it: ok:true, no errors, with a Retry-After.
const throttled = (retryAfter) => ({
  ok: false, status: 429,
  headers: { get: (k) => (String(k).toLowerCase() === 'retry-after' ? retryAfter : null) },
  json: async () => ({ ok: true, throttled: true }),
  text: async () => '{"ok":true,"throttled":true}',
});

async function boot(routes) {
  const dom = new JSDOM(HTML_SRC, {
    runScripts: 'outside-only', url: 'https://nota.example/', pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = (u, init) => {
        const r = routes.find((x) => x.match(String(u), init || {}));
        return r ? Promise.resolve(r.reply()) : Promise.reject(new Error('offline'));
      };
      window.scrollTo = () => {};
    },
  });
  const win = dom.window;
  win.eval(DOMAIN_SRC);
  win.eval(APP_SRC);
  await wait(80);
  return { win, doc: win.document };
}

const errorsText = (doc) => {
  const box = doc.getElementById('notary-console-errors');
  return box && !box.hidden ? box.textContent.trim() : '';
};

test('un notaire au plafond lit la fenêtre d’attente, pas « Connexion refusée »', async () => {
  const { win, doc } = await boot([
    { match: (u) => u.includes('/notary/session/request'), reply: () => throttled('900') },
  ]);
  await win.Nota.notary.signIn('me@etude.example');
  const txt = errorsText(doc);
  assert.ok(!/refus/i.test(txt), 'le plafond se lit encore comme un refus : ' + txt);
  assert.match(txt, /Trop de tentatives/, 'le plafond doit se nommer : ' + txt);
  assert.match(txt, /15 minutes/, 'la fenêtre annoncée doit être celle de l’API : ' + txt);
});

test('sans Retry-After, la fenêtre n’est pas inventée', async () => {
  const { win, doc } = await boot([
    { match: (u) => u.includes('/notary/session/request'), reply: () => throttled(null) },
  ]);
  await win.Nota.notary.signIn('me@etude.example');
  const txt = errorsText(doc);
  assert.match(txt, /Réessayez plus tard/, 'sans figure de l’API, ne rien promettre : ' + txt);
  assert.ok(!/quelques minutes/.test(txt), 'un délai inventé est revenu : ' + txt);
});

test('aucune porte de connexion ne promet « quelques minutes »', () => {
  // La vraie fenêtre est un quart d'heure (NOTARY_LOGIN_RL_WINDOW_SEC).
  assert.ok(!/Trop de demandes\. Réessayez dans quelques minutes\./.test(APP_SRC),
    'app.js promet encore un délai que l’API ne tient pas');
});

test('les deux messages de plafond ont leur côté anglais', () => {
  I18N.force('en');
  for (const fr of ['Trop de tentatives. Réessayez plus tard.', 'Trop de tentatives. Réessayez dans 15 minutes.']) {
    const en = I18N.tEn(fr);
    assert.notEqual(en, fr, 'sans traduction : ' + fr);
    assert.ok(!/[àéèêô]|Réessayez|tentatives/.test(en), 'du français dans l’anglais : ' + en);
  }
});
