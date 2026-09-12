'use strict';

/**
 * form-one-rail.spec — les champs du formulaire commencent tous au même endroit.
 *
 * Retour du propriétaire (2026-09-12) : « there's a lot of field in the form
 * that are not aligned, make sure that they are fully aligned ». Les questions
 * d'une section tombaient à un pixel les unes des autres — le volet des
 * précisions portait son propre cadre autour des rangs qu'il ouvre, la case à
 * cocher traînait les marges par défaut du navigateur, et le « $ » posé À CÔTÉ
 * du montant raccourcissait ce champ-là de dix pixels. Un pixel ne se nomme
 * pas, mais il se voit : deux cadres presque alignés lisent comme une erreur.
 *
 * Ce que la mesure exige, à chaque largeur :
 *   1. les rangs d'une section (y compris la barre « Ajouter des précisions »)
 *      partagent EXACTEMENT les mêmes rails gauche et droit — une colonne, une
 *      valeur ; jamais deux valeurs voisines ;
 *   2. dans un rang, chaque contrôle part du rail intérieur du rang et ne le
 *      déborde pas ;
 *   3. deux champs de la même colonne (le montant, la liste des prêteurs)
 *      finissent sur la même verticale.
 *
 * La mesure est faite sur le produit réel : c'est la seule façon de voir un
 * décalage d'un pixel, qu'aucune lecture de la feuille de style ne donnerait.
 */
const { test, expect } = require('@playwright/test');
const { gotoHome } = require('./helpers');

// Deux valeurs distinctes mais séparées de moins de ça sont un décalage, pas
// une intention : aucune mise en page du produit ne range deux colonnes à six
// pixels l'une de l'autre.
const NEAR_MISS = 6;
// La tolérance de mesure : un rail est « le même » au demi-pixel près (les
// sous-pixels du navigateur), pas au pixel près.
const SAME = 0.5;

/** Ouvre la feuille de réservation et va jusqu'à l'écran des questions. */
async function openQuestions(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await gotoHome(page, { suppressOnboarding: true });
  await page.locator('#cta-reserver').click();
  const sheet = page.locator('#day-dialog');
  await expect(sheet).toBeVisible();
  const form = sheet.locator('#offer-form');
  const next = sheet.locator('#book-next');

  await expect(form).toHaveAttribute('data-at', '1');
  await sheet.locator('#o-service-chips button[data-svc="financement"]').click();
  await next.click();

  await expect(form).toHaveAttribute('data-at', '2');
  // Les réponses requises : sans elles la section « Le prêt » reste en attente
  // et le volet des précisions ne dit pas encore ce qu'il cache.
  await sheet.locator('#crit-valeur_pret').fill('350000');
  await sheet.locator('#crit-contexte__propriete_detenue').click();
  await sheet.locator('#crit-approbation_bancaire__obtenue').click();
  await sheet.locator('#crit-preteur').selectOption('banque_nationale');

  // Tout est ouvert : un volet replié ne montre pas le rang qui dérive.
  await sheet.locator('.crit-sec[data-fold="true"] .crit-sec-fold').evaluateAll((bs) => bs.forEach((b) => b.click()));
  await sheet.locator('details.crit-more').evaluateAll((ds) => ds.forEach((d) => { d.open = true; }));
  await page.waitForTimeout(250);
  return sheet;
}

/** Les rails mesurés, section par section, dans le produit tel qu'il est peint. */
async function rails(sheet) {
  return sheet.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        left: r.left,
        right: r.right,
        inL: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft),
        inR: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
      };
    };
    const shown = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const step = [...document.querySelectorAll('#day-dialog .book-step')].find(shown);
    return [...step.querySelectorAll('.crit-sec')].filter(shown).map((sec) => ({
      name: sec.querySelector('.crit-sec-t').textContent.trim(),
      rows: [...sec.querySelectorAll('.crit-row, .crit-more > summary')].filter(shown).map((row) => {
        const b = box(row);
        return {
          tag: row.tagName.toLowerCase(),
          crit: row.dataset.crit || '',
          ...b,
          kids: [...row.children].filter(shown).map((kid) => {
            const k = kid.getBoundingClientRect();
            return { cls: kid.className.toString().split(' ')[0], left: k.left, right: k.right };
          }),
        };
      }),
    }));
  });
}

/** Les valeurs voisines mais différentes — le décalage qu'on ne nomme pas. */
function nearMisses(values) {
  const uniq = [...new Set(values.map((v) => Math.round(v * 100) / 100))].sort((a, b) => a - b);
  const out = [];
  for (let i = 1; i < uniq.length; i += 1) {
    const gap = uniq[i] - uniq[i - 1];
    if (gap > SAME && gap < NEAR_MISS) out.push(`${uniq[i - 1]} ≠ ${uniq[i]}`);
  }
  return out;
}

for (const width of [390, 900, 1440]) {
  test(`les questions partagent un seul rail à ${width}px`, async ({ page }) => {
    const sheet = await openQuestions(page, width);
    const secs = await rails(sheet);
    expect(secs.length, 'les trois sections du financement sont à l’écran').toBeGreaterThan(0);

    for (const sec of secs) {
      expect(sec.rows.length, `${sec.name} pose au moins une question`).toBeGreaterThan(0);

      // 1 — les rangs d'une section, la barre des précisions comprise.
      expect(nearMisses(sec.rows.map((r) => r.left)), `${sec.name} : rail gauche`).toEqual([]);
      expect(nearMisses(sec.rows.map((r) => r.right)), `${sec.name} : rail droit`).toEqual([]);
      // Et leur rail INTÉRIEUR : c'est là que commencent les libellés, les
      // pistes de réponse et les cases à cocher.
      expect(nearMisses(sec.rows.map((r) => r.inL)), `${sec.name} : rail des libellés`).toEqual([]);
      expect(nearMisses(sec.rows.map((r) => r.inR)), `${sec.name} : rail droit intérieur`).toEqual([]);

      // 2 — dans un rang, chaque contrôle part du rail et n'en sort pas. La
      // barre des précisions est une LIGNE (son libellé, puis son compte) :
      // ses enfants se suivent, ils ne s'empilent pas sur le rail.
      for (const row of sec.rows.filter((r) => r.tag !== 'summary')) {
        for (const kid of row.kids) {
          expect(kid.left - row.inL, `${sec.name} · ${row.crit || row.tag} · ${kid.cls} commence sur le rail`)
            .toBeLessThanOrEqual(SAME);
          expect(kid.left - row.inL, `${sec.name} · ${row.crit || row.tag} · ${kid.cls} ne rentre pas`)
            .toBeGreaterThanOrEqual(-SAME);
          expect(kid.right - row.inR, `${sec.name} · ${row.crit || row.tag} · ${kid.cls} ne déborde pas`)
            .toBeLessThanOrEqual(SAME);
        }
      }
    }

    // 3 — deux champs de même colonne finissent sur la même verticale : le
    // montant (qui porte son « $ ») et la liste des prêteurs.
    const fields = await sheet.evaluate(() => {
      const r = (sel) => {
        const el = document.querySelector(sel);
        const b = el.getBoundingClientRect();
        return { left: b.left, right: b.right, w: b.width };
      };
      return { montant: r('#crit-valeur_pret'), preteur: r('#day-dialog .crit-row[data-crit="preteur"] .nselect') };
    });
    expect(Math.abs(fields.montant.w - fields.preteur.w), 'le montant et la liste ont la même largeur utile')
      .toBeLessThanOrEqual(SAME);
  });
}
