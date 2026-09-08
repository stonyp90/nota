/* Preserve campaign labels and real referral codes across acquisition links.
 * No cookies, visitor IDs, network beacons or personal query parameters. */
(() => {
  const incoming = new URLSearchParams(location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
  document.querySelectorAll('[data-acquisition-link]').forEach((link) => {
    const url = new URL(link.getAttribute('href'), location.href);
    if (url.origin !== location.origin) return;
    for (const key of keys) {
      const value = incoming.get(key);
      if (value && /^[a-zA-Z0-9_-]{1,80}$/.test(value)) url.searchParams.set(key, value);
    }
    link.href = url.pathname + url.search + url.hash;
  });
})();
