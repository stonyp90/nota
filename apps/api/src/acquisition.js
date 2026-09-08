'use strict';
// Storage vocabulary, not product rules. Never accept arbitrary counter names,
// raw URLs, click IDs, search terms, or personal data from an analytics beacon.
const SOURCES = ['unknown', 'direct', 'google', 'bing', 'duckduckgo', 'yahoo', 'linkedin', 'facebook', 'instagram', 'youtube', 'tiktok', 'reddit', 'newsletter', 'partner', 'referral', 'other'];
const STAGES = ['visite', 'formulaire', 'publie', 'retenue'];
function touch(value) {
  const v = value && typeof value === 'object' ? value : {};
  const out = { source: SOURCES.includes(v.source) ? v.source : 'unknown' };
  for (const key of ['medium', 'campaign', 'content']) {
    if (typeof v[key] === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(v[key])) out[key] = v[key];
  }
  return out;
}
function acquisition(value) {
  const v = value && typeof value === 'object' ? value : {};
  return { version: 1, first: touch(v.first || v.last), last: touch(v.last || v.first) };
}
function sourceOf(value) { return acquisition(value).last.source; }
function counter(value, stage) {
  return STAGES.includes(stage) ? { ['acq_' + sourceOf(value) + '_' + stage]: 1 } : {};
}
module.exports = { SOURCES, STAGES, acquisition, sourceOf, counter };
