'use strict';
const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const CLOUDFRONT = readFileSync(join(__dirname, '../infra/cloudfront.tf'), 'utf8');
const LAMBDA = readFileSync(join(__dirname, '../infra/lambda.tf'), 'utf8');

// La CSP de production, interpolations de Terraform résolues. `ice` tient la
// place de local.csp_ice_sources, que Terraform calcule depuis var.stun_urls et
// var.turn_urls — espace de tête compris, exactement comme le bloc locals.
function politique(ice = '') {
  const match = /content_security_policy\s*=\s*"([^"]+)"/.exec(CLOUDFRONT);
  expect(match).not.toBeNull();
  return match[1]
    .replaceAll('${aws_s3_bucket.documents.bucket}', 'nota-csp-test')
    .replaceAll('${var.region}', 'ca-central-1')
    .replaceAll('${local.csp_ice_sources}', ice ? ` ${ice}` : '');
}

// La politique en table directive -> sources, pour qu'un élargissement se voie
// comme une différence et non comme une sous-chaîne qu'on aurait oublié de
// chercher.
function directives(policy) {
  const carte = {};
  for (const part of policy.split(';')) {
    const mots = part.trim().split(/\s+/).filter(Boolean);
    if (mots.length) carte[mots[0]] = mots.slice(1);
  }
  return carte;
}

function permissionsPolicy() {
  const match = /header\s*=\s*"Permissions-Policy"[\s\S]*?value\s*=\s*"([^"]+)"/.exec(CLOUDFRONT);
  expect(match).not.toBeNull();
  return match[1];
}

// Sert une page vide sous les en-têtes demandés. Chemin distinct par appel :
// deux routes sur le même motif se recouvrent, et un test qui croit mesurer la
// politique A mesurerait la B.
async function sonde(page, chemin, headers) {
  await page.route(`**${chemin}`, route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Sonde</title>',
    headers,
  }));
  await page.goto(chemin);
}

// Une caméra et un micro factices, pour tout le fichier : Playwright refuse un
// `launchOptions` local à un groupe (il forcerait un second worker). Les tests
// de CSP n'en font rien ; ceux de la salle mesurent la POLITIQUE et non la
// présence de matériel dans un conteneur qui n'en a aucun.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['camera', 'microphone'],
});

test('production CSP permits signed document uploads only to the configured S3 bucket', async ({ page }) => {
  const policy = politique();
  await page.route('**/csp-probe', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>CSP probe</title>', headers: { 'Content-Security-Policy': policy } }));
  let allowedRequests = 0, deniedRequests = 0;
  await page.route('https://nota-csp-test.s3.ca-central-1.amazonaws.com/**', route => {
    allowedRequests++;
    return route.fulfill({ status: 200, body: '', headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT, OPTIONS' } });
  });
  await page.route('https://other-bucket.s3.ca-central-1.amazonaws.com/**', route => { deniedRequests++; return route.fulfill({ body: '', headers: { 'access-control-allow-origin': '*' } }); });
  await page.goto('/csp-probe');
  const result = await page.evaluate(async () => {
    const allowed = await fetch('https://nota-csp-test.s3.ca-central-1.amazonaws.com/document?signature=test', { method: 'PUT', body: 'synthetic document' });
    let blocked = false;
    try { await fetch('https://other-bucket.s3.ca-central-1.amazonaws.com/document'); } catch { blocked = true; }
    return { allowed: allowed.ok, blocked };
  });
  expect(result).toEqual({ allowed: true, blocked: true });
  expect(allowedRequests).toBeGreaterThan(0);
  expect(deniedRequests).toBe(0);
});

// ---------------------------------------------------------------------------
// ADR 0047 — la salle de signature.
//
// L'infrastructure devait ROUVRIR ce qu'elle avait fermé. Ces tests tiennent
// les deux moitiés de cette réouverture : qu'elle suffise à la salle, et
// qu'elle n'aille pas plus loin. Ils lisent le Terraform et le rejouent dans un
// vrai navigateur, parce qu'une politique lue est une intention et qu'une
// politique appliquée est un fait.
// ---------------------------------------------------------------------------
test.describe('la salle de signature (ADR 0047)', () => {
  test('G1 — la Permissions-Policy de production ouvre caméra et micro sur Nota seulement', async ({ page }) => {
    // `(self)` et non `*` : la page elle-même et ses cadres de même origine,
    // jamais un tiers qui nous encadrerait. Rien d'autre n'a été ouvert au
    // passage — l'égalité stricte le tient mieux qu'un `toContain`.
    expect(permissionsPolicy()).toBe('camera=(self), microphone=(self), geolocation=(), display-capture=()');

    async function ouvrirLesPistes(chemin, entete) {
      await sonde(page, chemin, { 'Permissions-Policy': entete });
      return page.evaluate(async () => {
        try {
          const flux = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
          const pistes = flux.getTracks().length;
          flux.getTracks().forEach(p => p.stop());
          return { ouvert: true, pistes };
        } catch (e) {
          return { ouvert: false, nom: e.name };
        }
      });
    }

    // Ce que la production servait AVANT l'ADR. La salle y était une page
    // blanche : le navigateur refuse, et il refuse sans rien afficher.
    const avant = await ouvrirLesPistes('/sonde-permissions-avant', 'camera=(), microphone=(), geolocation=(), display-capture=()');
    expect(avant.ouvert).toBe(false);
    expect(avant.nom).toBe('NotAllowedError');

    // Ce qu'elle sert maintenant : le notaire voit et entend, et est vu et
    // entendu.
    const apres = await ouvrirLesPistes('/sonde-permissions-apres', permissionsPolicy());
    expect(apres).toEqual({ ouvert: true, pistes: 2 });
  });

  test('G2 — la CSP rend la séance enregistrée à la page, et rien de plus', async ({ page }) => {
    // La table complète, en toutes lettres. Élargir la politique demande donc
    // de modifier CE tableau : un ajout silencieux n'existe pas.
    expect(directives(politique('stun:stun.exemple.net:19302'))).toEqual({
      'default-src': ["'self'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
      'frame-ancestors': ["'none'"],
      'img-src': ["'self'", 'data:'],
      'media-src': ["'self'", 'blob:'],
      // Nota sert ses propres polices depuis le 2026-09-12 : aucun hôte tiers
      // n'est plus nommé ici, donc une feuille tierce ajoutée par mégarde est
      // simplement bloquée. `data:` reste, les deux documents partagés (deck,
      // plan d'affaires) embarquant leurs fontes en base64.
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'", 'data:'],
      'script-src': ["'self'", "'unsafe-inline'", 'https://www.googletagmanager.com'],
      'connect-src': [
        "'self'",
        'https://www.google-analytics.com',
        'https://region1.google-analytics.com',
        'https://analytics.google.com',
        'https://nota-csp-test.s3.ca-central-1.amazonaws.com',
        'stun:stun.exemple.net:19302',
      ],
    });

    // Sans relais configuré, la politique doit être MOT POUR MOT celle d'avant
    // l'ADR à `media-src` près : pas d'espace en fin de ligne, qui se lirait
    // comme une source vide.
    expect(politique()).not.toMatch(/[\s;]$/);
    expect(directives(politique())['connect-src']).toHaveLength(5);

    async function violations(chemin, policy) {
      await sonde(page, chemin, { 'Content-Security-Policy': policy });
      return page.evaluate(async () => {
        const vues = [];
        document.addEventListener('securitypolicyviolation', e => vues.push(e.violatedDirective));
        const video = document.createElement('video');
        video.src = URL.createObjectURL(new Blob([new Uint8Array(64)], { type: 'video/webm' }));
        document.body.appendChild(video);
        video.load();
        await new Promise(r => setTimeout(r, 500));
        return vues;
      });
    }

    // MediaRecorder rend ses octets à la page sous forme d'URL blob:. Sans
    // `blob:` dans media-src, la relecture d'un enregistrement consenti meurt
    // en silence — le test le prouve en la faisant mourir.
    const sansBlob = await violations('/sonde-media-sans-blob', politique().replace("media-src 'self' blob:", "media-src 'self'"));
    expect(sansBlob).toContain('media-src');

    const avecBlob = await violations('/sonde-media-avec-blob', politique());
    expect(avecBlob.filter(d => d.startsWith('media-src'))).toEqual([]);
  });

  test('G2 — la CSP et la Lambda ne peuvent pas nommer des relais différents', () => {
    // Un relais que la page reçoit mais que la CSP ignore est une connexion qui
    // échoue sans erreur de console et sans indice. Les deux côtés lisent donc
    // les MÊMES variables, et ce test est ce qui les y oblige.
    expect(CLOUDFRONT).toMatch(/ice_urls\s*=\s*compact\(concat\(var\.stun_urls,\s*var\.turn_urls\)\)/);
    expect(CLOUDFRONT).toContain('${local.csp_ice_sources}');
    expect(CLOUDFRONT).toContain('distinct(concat(local.ice_urls, local.signing_ice_urls))');
    expect(CLOUDFRONT).toContain('"turn:${var.signing_turn_hostname}:3478"');
    expect(CLOUDFRONT).toContain('"turns:${var.signing_turn_hostname}:443"');
    expect(LAMBDA).toMatch(/NOTA_STUN_URLS\s*=\s*join\(",",\s*var\.stun_urls\)/);
    expect(LAMBDA).toMatch(/NOTA_TURN_URL\s*=\s*join\(",",\s*var\.turn_urls\)/);

    // Le secret TURN part vers la Lambda et JAMAIS vers la page : il signe des
    // identifiants d'une heure, il n'en est pas un.
    expect(LAMBDA).toMatch(/NOTA_TURN_SECRET\s*=\s*var\.turn_secret/);
    expect(politique('turn:relais.exemple.net:3478')).not.toContain('turn_secret');
  });
});
