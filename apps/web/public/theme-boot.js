/**
 * The viewer's theme, settled BEFORE the stylesheet paints.
 *
 * The signing room may carry no inline script — its CSP allows executable
 * script from 'self' only, and signature-room.test.mjs pins that there are
 * zero inline ones (ADR 0047). So the first-paint decision index.html makes
 * in its head lives here instead, as a file the room can load blocking.
 *
 * The saved choice wins (the same `nota.theme` key the carnet writes, same
 * JSON shape); with no saved choice, the viewer's system preference decides.
 * Stamping the attribute either way means the room never opens dark on a
 * light visitor — and never flashes one theme before settling on the other.
 */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('nota.theme') || 'null');
    if (t !== 'dark' && t !== 'light') t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}());
