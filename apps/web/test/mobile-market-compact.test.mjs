// The phone market strip (owner, 2026-08-27: « pour la version mobile,
// financing et refinancing, on peut utiliser un autre UI — le but c'est de
// focusser sur les availabilities et le calendrier »).
//
// On a phone the two act rows stacked name / figures / volume bar and cost
// ~300px of the first screen — the calendar started below the fold. The
// mobile UI is now a pair of side-by-side act cards: name above its two
// captioned figures, no volume bar, no book arrow (the hero CTA sits right
// above). Same DOM, so tapping a card still filters the carnet and .is-on
// still marks the active act — only the phone stylesheet changes shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../public/styles.css', import.meta.url)), 'utf8');

test('phone market strip: the two acts sit side by side as compact cards', () => {
  assert.match(css, /\.pulse-rows\s*\{[^}]*grid-template-columns:\s*repeat\(2,/,
    'the phone pulse is a two-column pair, not a stack');
  assert.match(css, /\.pulse-bar\s*,\s*\.pulse-meta\s*\{[^}]*display:\s*none/,
    'the volume bar and counts caption leave the phone cards — figures only');
  assert.match(css, /\.pulse-item\s+\.mini-btn\s*\{[^}]*display:\s*none/,
    'the per-row book arrow goes on phones — the hero CTA right above books');
  assert.match(css, /\.pulse-row\.is-on\s*\{[^}]*border-color:\s*var\(--brand\)/,
    'the active act card is named by its brand edge, not by fill alone');
});

test('phone: the floating guide bubble goes — the calendar owns its corner', () => {
  // Owner, 2026-08-27: « Comment ça marche — remove this ». The fixed « ? »
  // bubble floated OVER the calendar tiles on the very screen the phone now
  // centres on. Phones drop the bubble; the guide keeps its phone doors (the
  // first-visit onboarding and the footer link). Desktop keeps the bubble —
  // the rule must live inside the phone band, not on the base selector.
  const phone = css.slice(css.indexOf('@media (max-width: 767.98px)'));
  assert.notEqual(phone.length, css.length, 'the phone hero band exists');
  assert.match(phone, /\.guide-fab\s*\{[^}]*display:\s*none/,
    'the phone band hides the floating guide bubble');
});

test('phone calendar: the month seam drops to its own line instead of ellipsizing', () => {
  // « MAR 1 SE… » truncated mid-month on offer days (the chevron reserve eats
  // the right edge of an ~82px cell). The seam month now reads whole on a
  // quiet second line: « MAR 1 » then « SEPT » beneath it.
  assert.match(css, /\.cal-daynum\[data-month\]\s*\{[^}]*white-space:\s*normal/,
    'a seam cell may wrap — the date line stays whole');
  assert.match(css, /\.cal-daynum\[data-month\]::after\s*\{[^}]*display:\s*block/,
    'the month owns its own line under the date');
});
