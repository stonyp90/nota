/**
 * LES RASTERS SONT LA MARQUE AUSSI.
 *
 * ADR 0048 dessine la marque une fois et fait de chaque autre copie un `<use>`.
 * Les PNG étaient l'exception : rien ne les régénérait, aucun test ne les
 * lisait, et le 2026-09-12 les trois icônes PWA portaient encore le dessin
 * retiré la veille — le point rond, la tuile rx 12, les jambages arrondis.
 * Les régénérer à la main répare les fichiers, pas le trou.
 *
 * Ce filet lit les PIXELS et les compare aux nombres de `favicon.svg` : si le
 * dessin bouge et que `node apps/web/scripts/render-icons.mjs` n'est pas
 * relancé, les sondes tombent.
 *
 * Il tient aussi la découverte du même jour : les deux manifestes déclaraient
 * `icon-512.png` en `purpose: maskable`. Android ne dessine pas l'icône qu'on
 * lui donne — il la recadre et ne garantit que les 80 % centraux. Le coin
 * extérieur du carré de signal tombe à 33,94 unités de tuile du centre, soit
 * 271 px à 512 pour un rayon sûr de 204,8 : **le signal se faisait couper sur
 * chaque écran d'accueil Android.**
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const bytes = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)));
const text = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

const SVG = text('../public/favicon.svg');

// --- le dessin, lu plutôt que recopié ---------------------------------------
const nombre = (src, re, quoi) => { const m = src.match(re); assert.ok(m, quoi); return m; };
const SIDE = parseFloat(nombre(SVG, /viewBox="0 0 (\d+(?:\.\d+)?) \1"/, 'un viewBox carré')[1]);
const TILE = nombre(SVG, /<rect width="64" height="64"[^>]*fill="(#[0-9a-fA-F]{6})"/i, 'la tuile et sa couleur')[1];
const SIGNAL = nombre(SVG, /<rect x="40" y="8" width="16" height="16"[^>]*fill="(#[0-9a-fA-F]{6})"/i, 'le carré de signal')[1];
const STEM = nombre(SVG, /<rect x="16" y="15" width="([\d.]+)" height="34"/, 'le jambage gauche du N');
const GAUCHE = { x: 16, y: 15, w: parseFloat(STEM[1]), h: 34 };
const CARRE = { x: 40, y: 8, w: 16, h: 16 };

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// --- un lecteur PNG minimal (8 bits, non entrelacé, RGB ou RGBA) ------------
function lirePng(buf) {
  assert.equal(buf.readUInt32BE(0), 0x89504e47, 'signature PNG');
  const largeur = buf.readUInt32BE(16), hauteur = buf.readUInt32BE(20);
  const profondeur = buf[24], type = buf[25], entrelace = buf[28];
  assert.equal(profondeur, 8, '8 bits par canal');
  assert.ok(type === 2 || type === 6, 'RGB ou RGBA');
  assert.equal(entrelace, 0, 'non entrelacé');
  const canaux = type === 6 ? 4 : 3;
  const morceaux = [];
  let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const nom = buf.toString('ascii', o + 4, o + 8);
    if (nom === 'IDAT') morceaux.push(buf.subarray(o + 8, o + 8 + len));
    o += 12 + len;
    if (nom === 'IEND') break;
  }
  const brut = inflateSync(Buffer.concat(morceaux));
  const pas = largeur * canaux;
  const px = Buffer.alloc(hauteur * pas);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (pas + 1)];
    const ligne = brut.subarray(y * (pas + 1) + 1, y * (pas + 1) + 1 + pas);
    for (let i = 0; i < pas; i++) {
      const a = i >= canaux ? px[y * pas + i - canaux] : 0;
      const b = y > 0 ? px[(y - 1) * pas + i] : 0;
      const c = i >= canaux && y > 0 ? px[(y - 1) * pas + i - canaux] : 0;
      let v = ligne[i];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      px[y * pas + i] = v & 0xff;
    }
  }
  return {
    largeur, hauteur, canaux,
    // Une sonde en unités de TUILE : le test parle la langue du dessin.
    sonde(xTuile, yTuile) {
      const x = Math.round((xTuile / SIDE) * largeur), y = Math.round((yTuile / SIDE) * hauteur);
      const i = (Math.min(y, hauteur - 1) * largeur + Math.min(x, largeur - 1)) * canaux;
      return { r: px[i], g: px[i + 1], b: px[i + 2], a: canaux === 4 ? px[i + 3] : 255 };
    },
  };
}

const proche = (lu, hex, quoi, tol = 10) => {
  const [r, g, b] = rgb(hex);
  assert.ok(Math.abs(lu.r - r) <= tol && Math.abs(lu.g - g) <= tol && Math.abs(lu.b - b) <= tol,
    quoi + ' : lu rgb(' + lu.r + ',' + lu.g + ',' + lu.b + '), attendu ' + hex);
};

const CENTRE_JAMBAGE = [GAUCHE.x + GAUCHE.w / 2, GAUCHE.y + GAUCHE.h / 2];
const CENTRE_SIGNAL = [CARRE.x + CARRE.w / 2, CARRE.y + CARRE.h / 2];

test('les deux icônes PWA portent le dessin courant, pas un dessin d’hier', () => {
  for (const f of ['../public/icon-192.png', '../public/icon-512.png']) {
    const png = lirePng(bytes(f));
    proche(png.sonde(...CENTRE_JAMBAGE), '#ffffff', f + ' : le jambage du N est blanc');
    proche(png.sonde(...CENTRE_SIGNAL), SIGNAL, f + ' : le carré de signal porte la couleur du signal');
    proche(png.sonde(32, 58), TILE, f + ' : la tuile porte sa couleur sous le mot');
    assert.equal(png.sonde(0.4, 0.4).a, 0, f + ' : le coin de la tuile reste transparent (rx 7)');
  }
});

test('l’icône iOS est opaque : le noir du système ne passe pas dans les coins', () => {
  const png = lirePng(bytes('../public/apple-touch-icon.png'));
  proche(png.sonde(0.4, 0.4), TILE, 'apple-touch-icon : le coin est aplati sur la tuile');
  proche(png.sonde(...CENTRE_SIGNAL), SIGNAL, 'apple-touch-icon : le signal est là');
  assert.equal(png.canaux, 3, 'aucun canal alpha : iOS ne compose rien derrière');
});

test('l’icône maskable garde le signal DANS le cercle sûr d’Android', () => {
  const png = lirePng(bytes('../public/icon-maskable-512.png'));
  // Le fond couvre le canevas : le lanceur découpe la silhouette lui-même.
  for (const [x, y] of [[0.4, 0.4], [SIDE - 0.4, 0.4], [0.4, SIDE - 0.4], [SIDE - 0.4, SIDE - 0.4]])
    proche(png.sonde(x, y), TILE, 'maskable : le coin (' + x + ',' + y + ') est plein, pas transparent');
  assert.equal(png.canaux, 3, 'maskable : aucun canal alpha');

  // La transformation que render-icons.mjs applique, recalculée ici depuis le SVG.
  const boite = { x0: GAUCHE.x, y0: CARRE.y, x1: CARRE.x + CARRE.w, y1: GAUCHE.y + GAUCHE.h };
  const cx = (boite.x0 + boite.x1) / 2, cy = (boite.y0 + boite.y1) / 2;
  const demiDiagonale = Math.hypot((boite.x1 - boite.x0) / 2, (boite.y1 - boite.y0) / 2);
  const rayonSur = SIDE * 0.4;
  const k = Math.min(1, rayonSur / demiDiagonale);
  const place = ([x, y]) => [SIDE / 2 + k * (x - cx), SIDE / 2 + k * (y - cy)];

  proche(png.sonde(...place(CENTRE_JAMBAGE)), '#ffffff', 'maskable : le jambage du N');
  proche(png.sonde(...place(CENTRE_SIGNAL)), SIGNAL, 'maskable : le carré de signal');

  // Le point du dessin le plus éloigné du centre — le coin extérieur du signal —
  // doit tenir dans le cercle sûr. C'est LE défaut que ce fichier corrige.
  const [sx, sy] = place([CARRE.x + CARRE.w, CARRE.y]);
  const rayon = Math.hypot(sx - SIDE / 2, sy - SIDE / 2);
  assert.ok(rayon <= rayonSur + 0.01,
    'le coin du signal tombe à ' + rayon.toFixed(2) + ' unités du centre, hors du cercle sûr de ' + rayonSur);
});

test('les deux manifestes servent l’icône maskable, pas la tuile pleine bordure', () => {
  for (const f of ['../public/manifest.webmanifest', '../public/manifest.en.webmanifest']) {
    const m = JSON.parse(text(f));
    const maskable = m.icons.filter((i) => String(i.purpose || '').split(/\s+/).includes('maskable'));
    assert.equal(maskable.length, 1, f + ' : une seule icône maskable');
    assert.equal(maskable[0].src, '/icon-maskable-512.png',
      f + ' : la maskable est l’actif dédié — servir icon-512.png y fait couper le signal');
    assert.ok(m.icons.some((i) => i.src === '/icon-512.png' && !/maskable/.test(String(i.purpose || ''))),
      f + ' : l’icône « any » reste la tuile dessinée, coins compris');
  }
});
