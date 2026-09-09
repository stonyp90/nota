'use strict';

const { cleanAnalyticsContext } = require('@nota/domain');

// UA hints are diagnostic observations, never authorization or feature gates.
// Exact versions, device models, IPs and raw headers are not returned/stored.
function analyticsContext(request, supplied) {
  const context = cleanAnalyticsContext(supplied);
  const key = Object.keys(request.headers || {}).find(k => k.toLowerCase() === 'user-agent');
  const ua = String(key ? request.headers[key] : '').slice(0, 1024);
  const ipad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && context.device === 'tablet');
  context.os = /iPhone|iPod/i.test(ua) || ipad ? 'ios' : /Android/i.test(ua) ? 'android'
    : /Windows/i.test(ua) ? 'windows' : /Macintosh|Mac OS X/i.test(ua) ? 'macos'
    : /Linux/i.test(ua) ? 'linux' : ua ? 'other' : 'unknown';
  context.device = ipad || /Tablet|Android(?!.*Mobile)/i.test(ua) ? 'tablet'
    : /Mobile|iPhone|iPod/i.test(ua) ? 'mobile'
    : /Windows|Macintosh|X11|Linux/i.test(ua) ? 'desktop' : 'unknown';
  context.browser = /bot\b|crawler|spider|HeadlessChrome/i.test(ua) ? 'bot'
    : /FBAN|FBAV|Instagram|; wv\)|\bWebView\b/i.test(ua) ? 'in_app'
    : /Edg(?:e|A|iOS)?\//i.test(ua) ? 'edge'
    : /SamsungBrowser\//i.test(ua) ? 'samsung'
    : /OPR\/|Opera|OPiOS\//i.test(ua) ? 'opera'
    : /Firefox\/|FxiOS\//i.test(ua) ? 'firefox'
    : /Chrome\/|CriOS\//i.test(ua) ? 'chrome'
    : /Version\/.+Safari\//i.test(ua) ? 'safari' : ua ? 'other' : 'unknown';
  return context;
}

module.exports = { analyticsContext };
