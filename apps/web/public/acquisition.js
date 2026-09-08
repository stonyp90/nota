/* Nota acquisition: optional, event-only measurement. No field values, raw
   URLs, fragments, tokens, click IDs, or document data ever leave this module. */
(function () {
  'use strict';
  var CONSENT = 'nota.analytics-consent', TOUCH = 'nota.acquisition';
  var TTL = 30 * 86400000;
  var sources = ['direct', 'google', 'bing', 'duckduckgo', 'yahoo', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'reddit', 'newsletter', 'partner', 'referral', 'other'];
  var pages = ['/', '/index.html', '/notaire-refinancement-quebec.html', '/notaire-financement-quebec.html', '/mortgage-refinancing-notary-quebec-city.html', '/mortgage-financing-notary-quebec-city.html'];
  var events = ['page_view', 'ui_click', 'form_start', 'form_submit_attempt', 'form_submit_error', 'generate_lead', 'begin_checkout', 'visite', 'jour_ouvert', 'paiement_ok', 'paiement_annule', 'notaire_porte'];
  var params = new URLSearchParams(location.search);
  var config = document.querySelector('meta[name="nota:analytics"]');
  var measurement = config ? config.content : '';
  var consent = read(CONSENT), started = false;
  function read(key) { try { return localStorage.getItem(key); } catch (_) { return null; } }
  function write(key, value) { try { localStorage.setItem(key, value); } catch (_) {} }
  function remove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  function code(value) { return typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value) ? value : ''; }
  function incoming() {
    var source = code(params.get('utm_source')), host = '';
    try { host = new URL(document.referrer).hostname.replace(/^www\./, ''); } catch (_) {}
    if (!source) {
      if (!host || host === location.hostname || host === 'gonota.ca') source = 'direct';
      else {
        source = 'referral';
        ['google', 'bing', 'duckduckgo', 'yahoo', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'reddit'].some(function (name) {
          if (host === name + '.com' || host.endsWith('.' + name + '.com') || (name === 'google' && host === 'google.ca')) { source = name; return true; }
          return false;
        });
        if (host === 't.co') source = 'other';
        if (host === 'lnkd.in') source = 'linkedin';
      }
    }
    var out = { source: sources.indexOf(source) >= 0 ? source : 'other' };
    ['medium', 'campaign', 'content'].forEach(function (key) { var v = code(params.get('utm_' + key)); if (v) out[key] = v; });
    if (!out.medium) out.medium = ['google', 'bing', 'duckduckgo', 'yahoo'].indexOf(out.source) >= 0 ? 'organic' : (['linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'reddit'].indexOf(out.source) >= 0 ? 'organic-social' : (out.source === 'direct' ? 'none' : (out.source === 'newsletter' ? 'email' : 'referral')));
    return out;
  }
  function cleanTouch(value) {
    var v = value || {}, result = { source: sources.indexOf(v.source) >= 0 ? v.source : 'direct' };
    ['medium', 'campaign', 'content'].forEach(function (key) { if (code(v[key])) result[key] = v[key]; });
    return result;
  }
  var current = incoming(), attribution = { version: 1, first: current, last: current };
  function restore() {
    try {
      var saved = JSON.parse(read(TOUCH));
      if (saved && saved.expires > Date.now() && saved.first && saved.last) {
        attribution.first = cleanTouch(saved.first);
        attribution.last = current.source === 'direct' ? cleanTouch(saved.last) : current;
      }
    } catch (_) {}
  }
  function persist() { write(TOUCH, JSON.stringify({ first: attribution.first, last: attribution.last, expires: Date.now() + TTL })); }
  if (consent === 'granted') { restore(); persist(); }
  function safeLocation() { return location.origin + (pages.indexOf(location.pathname) >= 0 ? location.pathname : '/'); }
  function safeReferrer() {
    // A fixed vocabulary, never the visitor's original referring URL.
    var s = current.source;
    return ['google', 'bing', 'duckduckgo', 'yahoo', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'reddit'].indexOf(s) >= 0 ? 'https://' + s + '.com/' : '';
  }
  function gtag() { window.dataLayer.push(arguments); }
  function event(name, action) {
    if (consent !== 'granted' || !started || events.indexOf(name) < 0) return;
    var data = { page_location: safeLocation(), page_referrer: safeReferrer(), page_title: 'Nota', campaign_source: attribution.last.source };
    ['medium', 'campaign', 'content'].forEach(function (key) { if (code(attribution.last[key])) data[key === 'campaign' ? 'campaign_name' : 'campaign_' + key] = attribution.last[key]; });
    if (['link', 'button', 'field', 'background', 'offer_submit', 'main_cta', 'day', 'navigation'].indexOf(action) >= 0) data.action = action;
    gtag('event', name, data);
  }
  function start() {
    if (started || consent !== 'granted' || !/^G-[A-Z0-9]+$/.test(measurement)) return;
    window['ga-disable-' + measurement] = false;
    window.dataLayer = window.dataLayer || [];
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    gtag('js', new Date());
    gtag('config', measurement, { send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: 2592000, page_location: safeLocation(), page_referrer: safeReferrer(), page_title: 'Nota' });
    var script = document.createElement('script'); script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + measurement;
    document.head.appendChild(script); started = true; event('page_view');
  }
  function choose(value) {
    consent = value; write(CONSENT, value);
    if (value === 'granted') {
      persist();
      if (started) { window['ga-disable-' + measurement] = false; gtag('consent', 'update', { analytics_storage: 'granted' }); }
      start();
    }
    else {
      remove(TOUCH); attribution = { version: 1, first: current, last: current };
      window['ga-disable-' + measurement] = true;
      if (started) gtag('consent', 'update', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
      document.cookie.split(';').forEach(function (part) {
        var name = part.trim().split('=')[0];
        if (!/^_ga(?:_|$)/.test(name)) return;
        ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach(function (domain) { document.cookie = name + '=; Max-Age=0; path=/' + domain + '; SameSite=Lax'; });
      });
    }
    var banner = document.getElementById('analytics-consent'); if (banner) banner.hidden = true;
  }
  window.NotaAcquisition = { snapshot: function () { return JSON.parse(JSON.stringify(attribution)); }, event: event };
  function boot() {
    var banner = document.getElementById('analytics-consent');
    var configured = /^G-[A-Z0-9]+$/.test(measurement);
    var preferencesButton = document.getElementById('analytics-preferences');
    if (preferencesButton) preferencesButton.hidden = !configured;
    if (banner && configured) {
      banner.hidden = consent === 'granted' || consent === 'denied';
      document.getElementById('analytics-accept').addEventListener('click', function () { choose('granted'); });
      document.getElementById('analytics-refuse').addEventListener('click', function () { choose('denied'); });
      var preferences = document.getElementById('analytics-preferences');
      if (preferences) preferences.addEventListener('click', function () { banner.hidden = false; document.getElementById('analytics-refuse').focus(); });
    }
    document.addEventListener('click', function (e) {
      var target = e.target && e.target.closest ? e.target.closest('button,a,input,select,textarea,[data-date]') : null;
      if (target && target.closest('#analytics-consent')) return;
      var action = target ? ({ A: 'link', BUTTON: 'button', INPUT: 'field', SELECT: 'field', TEXTAREA: 'field' }[target.tagName] || 'background') : 'background';
      if (target && target.id === 'offer-submit') action = 'offer_submit';
      else if (target && target.id === 'cta-reserver') action = 'main_cta';
      else if (target && target.hasAttribute('data-date')) action = 'day';
      else if (target && target.hasAttribute('data-goto')) action = 'navigation';
      event('ui_click', action);
    }, true);
    start();
    if (location.pathname !== '/' && location.pathname !== '/index.html' && pages.indexOf(location.pathname) >= 0) {
      try {
        var api = window.__NOTA_API__ || (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'http://localhost:8788' : '/api');
        window.fetch(api + '/events', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ event: 'visite', acquisition: attribution }) }).catch(function () {});
      } catch (_) {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
