'use strict';

// HTTP preference order, including quality weights. Unsupported languages fall
// back to the canonical French; absent headers preserve legacy preferences.
function requestLanguage(request) {
  const header = Object.entries(request.headers || {}).find(([key]) => key.toLowerCase() === 'accept-language');
  if (!header || !header[1]) return undefined;
  const choices = String(header[1]).split(',').map((entry, index) => {
    const [tag, ...params] = entry.trim().split(';');
    const weight = params.find(p => /^\s*q=/i.test(p));
    const q = weight ? Number(weight.trim().slice(2)) : 1;
    return { tag, q, index };
  }).filter(x => Number.isFinite(x.q) && x.q > 0 && x.q <= 1)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of choices) {
    if (/^en(?:-|$)/i.test(tag)) return 'en';
    if (/^fr(?:-|$)/i.test(tag)) return 'fr';
  }
  return 'fr';
}
module.exports = { requestLanguage };
