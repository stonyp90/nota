/* Preserve campaign labels and real referral codes across acquisition links.
 * Only a coarse arrival category is forwarded; analytics has no visitor IDs.
 * No cookies, visitor IDs, network beacons or personal query parameters. */
(() => {
  const analytics = window.NotaAnalytics;
  if (analytics) analytics.send('page_service_vue');
  const incoming = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
  document.querySelectorAll('[data-acquisition-link]').forEach((link) => {
    const url = new URL(link.getAttribute('href'), location.href);
    if (url.origin !== location.origin) return;
    if (analytics) {
      url.searchParams.set('nota_source', analytics.context().source);
      url.searchParams.set('nota_entry', analytics.context().entry);
      if (url.pathname === '/' || url.pathname === '/index.html') {
        link.addEventListener('click', () => analytics.send('page_service_vers_carnet'));
      }
    }
    for (const key of keys) {
      const value = incoming.get(key);
      if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) url.searchParams.set(key, value);
    }
    link.href = url.pathname + url.search + url.hash;
  });
})();
