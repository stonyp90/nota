'use strict';
const { TEMPLATE_META } = require('./emails');

// Login messages are requested explicitly and cannot be disabled accidentally.
// Other per-recipient choices are independent of the global marketing opt-out.
function catalog() {
  return Object.entries(TEMPLATE_META)
    .filter(([, meta]) => meta.audience !== 'operator' && meta.audience !== 'admin' && meta.audience !== 'operateur')
    .map(([key, meta]) => ({ key, labelFr: meta.labelFr, labelEn: meta.labelEn, required: /MagicLink$/.test(key) || ['partnerClaimLink', 'partnerCodeReminder'].includes(key) }));
}
function validate(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return false;
  const known = new Map(catalog().map(item => [item.key, item]));
  return Object.entries(values).every(([key, value]) => known.has(key) && typeof value === 'boolean' && (!known.get(key).required || value));
}
module.exports = { catalog, validate };
