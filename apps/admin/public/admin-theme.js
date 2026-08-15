/* Pre-paint theme setter. Loaded as the FIRST, render-blocking <script> in the
   <head> — external (not inline) so the strict admin CSP can forbid
   'unsafe-inline' scripts entirely. Applies a saved explicit theme choice before
   the stylesheet paints, avoiding a light→dark flash. Mirrors apps/web's inline
   pre-paint snippet, on an admin-scoped storage key. */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('nota.admin.theme') || 'null');
    if (t === 'dark' || t === 'light') {
      document.documentElement.setAttribute('data-theme', t);
    }
  } catch (e) {}
})();
