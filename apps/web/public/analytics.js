/* First-party, aggregate diagnostics. No storage, IDs, raw URLs or raw errors. */
(function () {
  'use strict';
  var SOURCES = ['google', 'bing', 'search_other', 'facebook', 'instagram', 'linkedin', 'tiktok', 'ai', 'email', 'partner', 'campaign_other', 'referral_other', 'internal', 'direct_unknown'];
  var initialSource = arrivalSource();
  var initialEntry = entryPage();
  var loadBucket = 'unknown';
  var sentOnce = {};

  function knownHost(host, domain) { return host === domain || host.endsWith('.' + domain); }
  function sourceName(value) {
    return /^(google|bing|facebook|instagram|linkedin|tiktok)$/.test(value) ? value
      : /^(duckduckgo|yahoo|ecosia)$/.test(value) ? 'search_other'
      : /^(chatgpt|perplexity|claude|copilot|gemini)$/.test(value) ? 'ai'
      : /^(email|newsletter|courriel)$/.test(value) ? 'email' : null;
  }
  function arrivalSource() {
    try {
      var params = new URLSearchParams(location.search);
      var declared = (params.get('utm_source') || '').slice(0, 80).toLowerCase();
      var named = sourceName(declared);
      if (named) return named;
      if (/^(email|newsletter)$/.test((params.get('utm_medium') || '').toLowerCase())) return 'email';
      if (declared) return 'campaign_other';
      if (/^[a-zA-Z0-9_-]{3,40}$/.test(params.get('ref') || '')) return 'partner';
      var forwarded = params.get('nota_source');
      if (SOURCES.indexOf(forwarded) !== -1) return forwarded;
      if (!document.referrer) return 'direct_unknown';
      var ref = new URL(document.referrer);
      if (ref.origin === location.origin) return 'internal';
      var host = ref.hostname.toLowerCase();
      var domains = { google: ['google.com', 'google.ca'], bing: ['bing.com'], search_other: ['duckduckgo.com', 'search.yahoo.com', 'ecosia.org'], facebook: ['facebook.com', 'fb.com'], instagram: ['instagram.com'], linkedin: ['linkedin.com', 'lnkd.in'], tiktok: ['tiktok.com'], ai: ['chatgpt.com', 'chat.openai.com', 'perplexity.ai', 'claude.ai', 'copilot.microsoft.com', 'gemini.google.com'] };
      for (var source in domains) if (domains[source].some(function (domain) { return knownHost(host, domain); })) return source;
      return 'referral_other';
    } catch (e) { return 'direct_unknown'; }
  }
  function entryPage() {
    var path = location.pathname;
    var forwarded = new URLSearchParams(location.search).get('nota_entry');
    if ((path === '/' || path === '/index.html') && /^(financement|refinancement)$/.test(forwarded || '')) return forwarded;
    if (/^(\/notaire-refinancement-quebec|\/mortgage-refinancing-notary-quebec-city)\.html$/.test(path)) return 'refinancement';
    if (/^(\/notaire-financement-quebec|\/mortgage-financing-notary-quebec-city)\.html$/.test(path)) return 'financement';
    return path === '/' || path === '/index.html' ? 'home' : 'other';
  }
  function context() {
    var language = document.documentElement.lang || navigator.language || '';
    var width = window.innerWidth;
    var storage = 'unavailable';
    try { if (window.localStorage) { window.localStorage.getItem('nota.lang'); storage = 'available'; } } catch (e) {}
    var result = {
      source: initialSource, entry: initialEntry,
      language: /^fr\b/i.test(language) ? 'fr' : /^en\b/i.test(language) ? 'en' : language ? 'other' : 'unknown',
      viewport: width > 0 ? width < 600 ? 'narrow' : width < 1024 ? 'medium' : 'wide' : 'unknown',
      dialog: typeof HTMLDialogElement !== 'undefined' && typeof HTMLDialogElement.prototype.showModal === 'function' ? 'native' : 'fallback',
      storage: storage, load: loadBucket,
    };
    // iPadOS can declare a desktop Macintosh UA; this coarse hint resolves it.
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) result.device = 'tablet';
    var experience = window.NotaExperience;
    if (experience && (experience.mode === 'standard' || experience.mode === 'guided')) result.journey = experience.mode;
    return result;
  }
  function send(eventId, base) {
    try {
      // UN SEUL battement porte les DEUX lectures : la provenance (acquisition.js,
      // #4) et le contexte borné. analytics.js est toujours chargé et court-circuite
      // le chemin de repli d'app.js : sans cette ligne, le compteur de provenance
      // cesserait de compter en silence, sans qu'aucun test ne le dise.
      var acquisition = window.NotaAcquisition ? window.NotaAcquisition.snapshot() : undefined;
      if (window.NotaAcquisition) window.NotaAcquisition.event(eventId === 'formulaire' ? 'form_start' : eventId);
      var body = JSON.stringify({ event: eventId, context: context(), acquisition: acquisition });
      var request = fetch((base || apiBase()) + '/events', { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true, headers: { 'content-type': 'text/plain' }, body: body });
      if (request && request.catch) request.catch(function () {});
    } catch (e) { /* collection failure never interrupts the journey */ }
  }
  function apiBase() {
    return window.__NOTA_API__ || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:8788' : '/api');
  }
  function once(eventId) {
    if (sentOnce[eventId]) return;
    sentOnce[eventId] = true;
    send(eventId, apiBase());
  }
  // No error message, stack, rejected value, path or line number is collected.
  window.addEventListener('error', function () { once('erreur_script'); });
  window.addEventListener('unhandledrejection', function () { once('promesse_rejetee'); });
  window.addEventListener('load', function () {
    setTimeout(function () {
      try {
        var navigation = performance.getEntriesByType('navigation')[0];
        if (!navigation || !(navigation.loadEventEnd > 0)) return;
        var elapsed = navigation.loadEventEnd - navigation.startTime;
        loadBucket = elapsed < 2000 ? 'fast' : elapsed <= 4000 ? 'moderate' : 'slow';
        once('navigation_mesuree');
      } catch (e) { /* unsupported timing API */ }
    }, 0);
  });
  window.NotaAnalytics = { context: context, send: send };
})();
