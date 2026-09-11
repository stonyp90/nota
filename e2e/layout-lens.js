'use strict';

/**
 * layout-lens — what a person calls « broken » on a screen, measured.
 *
 * Runs INSIDE the page (pass it to page.evaluate). Returns the offences a
 * layout can commit at a given size, so one assertion per surface can hold
 * at every viewport and on every engine:
 *
 *   • sideways      — the page scrolls horizontally, or a box sticks out past
 *                     the right edge without being clipped by an ancestor;
 *   • bands         — a blank vertical band taller than ~14 % of the viewport
 *                     between two consecutive visible blocks of the measured
 *                     column (the « blank space » the owner refuses to add);
 *   • overlaps      — two static siblings covering each other;
 *   • small         — on a touch screen, an interactive control under 40 px
 *                     (24 px for a link inside running text) — the product's
 *                     own promise is 44 px on coarse pointers;
 *   • clipped       — a heading truncated by its box.
 *
 * Deliberately blind to: `display: contents` wrappers (their children are the
 * siblings), `.visually-hidden` text, fixed/absolute layers, the pulse row's
 * 34 px well for its own mini button (by design), and anything under 24×8 px.
 *
 * Written 2026-09-11 after the twelve-viewport audit that separated my
 * heuristics' false positives from the four real defects it found.
 */
function measure({ rootSel, touch, vw, vh, allowOverlap }) {
  const de = document.documentElement;
  const root = document.querySelector(rootSel) || document.body;
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== de; a = a.parentElement) {
      const o = getComputedStyle(a);
      if (o.overflowX !== 'visible' || o.overflow !== 'visible' || o.clipPath !== 'none') return true;
    }
    return false;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const flatten = (el) => [...el.children].flatMap((k) => (getComputedStyle(k).display === 'contents' ? flatten(k) : [k]));

  const offenders = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 8 || r.right <= vw + 1.5) return;
    const p = el.parentElement && el.parentElement.getBoundingClientRect();
    if (p && p.right > vw + 1.5) return; // report the outermost only
    if (clipped(el)) return;
    offenders.push(`${label(el)} right=${Math.round(r.right)}`);
  });

  const GAP = Math.max(96, Math.round(vh * 0.14));
  const bands = [];
  const walk = (el, depth) => {
    if (depth > 6) return;
    const kids = flatten(el).filter(vis);
    let prev = null;
    for (const k of kids) {
      const cs = getComputedStyle(k);
      if (cs.position === 'fixed' || cs.position === 'absolute') continue;
      const r = k.getBoundingClientRect();
      if (prev) {
        const gap = r.top - prev.bottom;
        if (gap > GAP && r.width > vw * 0.3) bands.push(`${Math.round(gap)}px between ${label(prev.el)} and ${label(k)}`);
      }
      prev = { el: k, bottom: r.bottom };
      if (cs.display !== 'inline' && k.children.length) walk(k, depth + 1);
    }
  };
  walk(root, 0);

  const overlaps = [];
  const allow = allowOverlap || [];
  const check = (el, depth) => {
    if (depth > 5) return;
    const kids = flatten(el).filter((k) => vis(k) && ['static', 'relative'].includes(getComputedStyle(k).position));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        if (allow.some((sel) => kids[i].matches(sel) || kids[j].matches(sel))) continue;
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 6 && oy > 6 && ox * oy > 0.2 * Math.min(a.width * a.height, b.width * b.height)) {
          overlaps.push(`${label(kids[i])} × ${label(kids[j])} (${Math.round(ox)}×${Math.round(oy)})`);
        }
      }
    }
    kids.forEach((k) => check(k, depth + 1));
  };
  check(root, 0);

  const small = [];
  if (touch) {
    root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=switch]').forEach((el) => {
      if (!vis(el)) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const inline = el.tagName === 'A' && cs.display === 'inline';
      const min = inline ? 24 : 40;
      // A ::before hit-area extension counts: read the pseudo-element's box.
      const ext = getComputedStyle(el, '::before');
      const grow = ext.content !== 'none' && ext.position === 'absolute' && /^-?\d/.test(ext.inset) ? Math.abs(parseFloat(ext.inset)) * 2 : 0;
      if (r.height + grow < min || (!inline && r.width + grow < min)) {
        small.push(`${label(el)} ${Math.round(r.width)}×${Math.round(r.height)} « ${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)} »`);
      }
    });
  }

  const clippedText = [];
  root.querySelectorAll('h1, h2, h3').forEach((el) => {
    if (!vis(el) || el.children.length) return;
    const cs = getComputedStyle(el);
    if (/visually-hidden|sr-only/.test(el.className)) return;
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 2) clippedText.push(`${label(el)} « ${el.textContent.trim().slice(0, 40)} »`);
  });

  const rr = root.getBoundingClientRect();
  return {
    sideways: de.scrollWidth > de.clientWidth + 1,
    scrollW: de.scrollWidth, clientW: de.clientWidth, pageH: Math.round(de.scrollHeight), rootH: Math.round(rr.height),
    offenders: offenders.slice(0, 6), bands: bands.slice(0, 6), overlaps: overlaps.slice(0, 6), small: small.slice(0, 10), clippedText: clippedText.slice(0, 6),
    headingFonts: [...new Set([...root.querySelectorAll('h1, h2, h3')].filter(vis).map((h) => getComputedStyle(h).fontFamily.split(',')[0].replace(/"/g, '').trim()))],
    theme: de.getAttribute('data-theme'),
  };
}

/** Wait for fonts and every finite animation before reading geometry. */
async function settle(page) {
  await page.evaluate(async () => {
    if (document.fonts) { try { await document.fonts.ready; } catch (e) { /* no font API */ } }
    const finite = document.getAnimations().filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return t && t.iterations !== Infinity; });
    await Promise.race([Promise.all(finite.map((a) => a.finished.catch(() => {}))), new Promise((r) => setTimeout(r, 2000))]);
    await new Promise((r) => setTimeout(r, 120));
  });
}

module.exports = { measure, settle };
