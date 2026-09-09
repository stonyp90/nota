import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const DOMAIN = readFileSync(fileURLToPath(new URL('../../../packages/domain/index.js', import.meta.url)), 'utf8');
const APP = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');
const I18N = readFileSync(fileURLToPath(new URL('../public/i18n.js', import.meta.url)), 'utf8');
const HTML = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8');
const windows = [];
after(() => windows.forEach((win) => win.close()));

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const response = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const todayISO = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const addDays = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);

async function boot(experience) {
  const dom = new JSDOM(HTML, { runScripts: 'outside-only', url: 'https://nota.example/?lang=fr', pretendToBeVisual: true,
    beforeParse(win) {
      win.scrollTo = () => {};
      win.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      win.HTMLDialogElement.prototype.close = function () { this.open = false; };
      win.fetch = async (url) => String(url).includes('/bids?')
        ? response({ bids: [], tarif: { grille: { services: {} } }, experience })
        : Promise.reject(new Error('offline'));
    },
  });
  windows.push(dom.window);
  dom.window.eval(I18N);
  dom.window.eval(DOMAIN);
  dom.window.eval(APP);
  await wait(70);
  return dom.window;
}

test('guided experience adds orientation copy after the server mode is loaded', async () => {
  const win = await boot({ version: '2026-09-09.1', mode: 'guided', guidanceLevel: 'guided' });
  const iso = addDays(todayISO(), 6);
  win.document.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(35);
  const guidance = win.document.getElementById('journey-guidance');
  assert.equal(guidance.hidden, false);
  assert.match(guidance.textContent, /Répondez à ce que vous savez/);
  assert.equal(win.NotaExperience.mode, 'guided');
});

test('standard experience keeps the orientation line hidden', async () => {
  const win = await boot({ version: '2026-09-09.1', mode: 'standard', guidanceLevel: 'standard' });
  const iso = addDays(todayISO(), 6);
  win.document.querySelector('.cal-cell[data-date="' + iso + '"]').click();
  await wait(35);
  assert.equal(win.document.getElementById('journey-guidance').hidden, true);
});
