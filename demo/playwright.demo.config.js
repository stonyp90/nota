'use strict';

/**
 * Configuration de la VIDÉO de démonstration — pas une suite de tests.
 *
 * `npm run demo:salle` joue la cérémonie complète dans deux navigateurs réels
 * et en sort un enregistrement. C'est la même pile que les journées E2E (API en
 * mémoire + serveur web local), sur des ports à elle pour qu'une démonstration
 * ne marche jamais sur les pieds d'une suite en cours.
 *
 * Le scénario, la narration, les chapitres et le texte de publication sont dans
 * docs/go-to-market/video-salle-signature.md.
 */
const { defineConfig } = require('@playwright/test');

const API_PORT = Number(process.env.DEMO_API_PORT || 8821);
const WEB_PORT = Number(process.env.DEMO_WEB_PORT || 4321);
const API_BASE = `http://localhost:${API_PORT}`;
const WEB_BASE = `http://localhost:${WEB_PORT}`;

module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'salle-demo.spec.js',
  workers: 1,
  retries: 0,
  // Une cérémonie complète, une suspension observée en temps réel et une reprise.
  timeout: 6 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  use: {
    baseURL: WEB_BASE,
    headless: true,
    // Le cadrage de la vidéo. 720p : lisible sur un téléphone, léger à publier.
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // Une caméra et un micro factices : la mire de Chromium suffit à montrer
      // que deux flux circulent, et aucune personne réelle n'est filmée pour
      // une démonstration.
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--allow-loopback-in-peer-connection',
      ],
      // Échappatoire pour une machine dont le Chromium épinglé n'est pas
      // installé (conteneur, image d'entreprise). Vide = celui de Playwright.
      ...(process.env.DEMO_CHROMIUM ? { executablePath: process.env.DEMO_CHROMIUM } : {}),
    },
  },
  webServer: [
    {
      command: 'node e2e/servers/api-server.js',
      cwd: `${__dirname}/..`,
      env: { NOTA_DEMO_OPEN: 'true', NOTA_SITE_URL: WEB_BASE, PORT: String(API_PORT), NODE_ENV: 'test' },
      url: `${API_BASE}/health`,
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      command: 'node apps/web/run-local.mjs',
      cwd: `${__dirname}/..`,
      env: { NOTA_API_BASE: API_BASE, PORT: String(WEB_PORT) },
      url: WEB_BASE,
      reuseExistingServer: true,
      timeout: 30_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
