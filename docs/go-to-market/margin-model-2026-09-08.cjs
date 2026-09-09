// Analytical scenarios only. Product prices always come from @nota/domain.
// Run: node docs/go-to-market/margin-model-2026-09-08.cjs
const assert = require('node:assert/strict');
const domain = require('../../packages/domain');
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const assumptions = {
  domesticRate: 0.029, cardFixed: 0.30, connectRate: 0.0025,
  activeAccountMonthly: 2, actsPerActiveAccount: 10, actsPerPayout: 1,
  payoutFixed: 0.25, supportPerAct: 30, cacPerAct: 164,
  serviceMix: { financement: 0.4, refinancement: 0.6 },
  tierMix: { standard: 0.7, rapide: 0.18, prioritaire: 0.07, urgence: 0.03, extreme: 0.02 },
};
function margin(h, n, { rate = assumptions.domesticRate, rail = 'card',
  acts = assumptions.actsPerActiveAccount, batch = assumptions.actsPerPayout,
  taxCollected = 0 } = {}) {
  const total = h + n + taxCollected;
  const processing = rail === 'pad' ? Math.min(total * 0.01 + 0.40, 5) : total * rate + assumptions.cardFixed;
  const connect = h * assumptions.connectRate + assumptions.activeAccountMonthly / acts + assumptions.payoutFixed / batch;
  return { honoraires: h, nota: n, total, processing, connect, margin: n - processing - connect };
}
function values(c) {
  if (c.type === 'choice') return c.options.map(o => o.id);
  if (c.type === 'flag') return [false, true];
  if (c.type === 'bracket') return c.brackets.map((b, i) => i ? c.brackets[i - 1].max + 1 : 1);
  throw new Error(`Unhandled criterion: ${c.type}`);
}
function enumerate(s) {
  const bases = new Set(); let combinations = 0;
  function visit(i, answers) {
    if (i === s.pricing.criteria.length) {
      combinations++; bases.add(domain.computeBasePrice(s.id, answers)); return;
    }
    const c = s.pricing.criteria[i];
    for (const v of values(c)) visit(i + 1, { ...answers, [c.id]: v });
  }
  visit(0, {});
  return { combinations, uniqueBases: bases.size, min: Math.min(...bases), max: Math.max(...bases) };
}
const catalogue = domain.SERVICES.map(s => ({ service: s.id, ...enumerate(s) }));
const profiles = { domestic: 0.029, international: 0.037, internationalWithFx: 0.057 };
const rows = [];
for (const s of domain.SERVICES) for (const t of domain.TIERS) {
  const n = domain.prixNota(s.id, t.id).totalCents / 100;
  const range = catalogue.find(c => c.service === s.id);
  const h = domain.computeBasePrice(s.id, {}) * domain.tierMultiplier(t.id);
  rows.push({ service: s.id, tier: t.id, ...margin(h, n),
    maxHonoraires: range.max * domain.PREMIUM_CAP,
    worstMargin: margin(range.max * domain.PREMIUM_CAP, n).margin,
    breakEvenHonoraires: (n * (1 - assumptions.domesticRate) - assumptions.cardFixed - 0.45) / (assumptions.domesticRate + assumptions.connectRate),
    byCardProfile: Object.fromEntries(Object.entries(profiles).map(([k, rate]) => [k, margin(h, n, { rate }).margin])),
  });
}
function mix(prices = {}, options = {}) {
  const out = { honoraires: 0, nota: 0, total: 0, processing: 0, connect: 0, margin: 0 };
  for (const row of rows) {
    const service = domain.SERVICES.find(s => s.id === row.service);
    const n = row.nota + (prices[row.service] ?? service.prixNotaCents / 100) - service.prixNotaCents / 100;
    const result = margin(row.honoraires, n, options);
    const weight = assumptions.serviceMix[row.service] * assumptions.tierMix[row.tier];
    for (const key of Object.keys(out)) out[key] += result[key] * weight;
  }
  return out;
}
const baseline = mix();
const candidates = [
  { name: 'current', prices: {} },
  { name: '249/289', prices: { financement: 249, refinancement: 289 } },
  { name: '279/289', prices: { financement: 279, refinancement: 289 } },
  { name: '289/289', prices: { financement: 289, refinancement: 289 } },
].map(({ name, prices }) => {
  const result = mix(prices);
  return { name, ...result, gain: result.margin - baseline.margin,
    maxRelativeConversionLoss: 1 - (baseline.margin - assumptions.supportPerAct) / (result.margin - assumptions.supportPerAct),
  };
});
const sensitivities = {
  cardProfiles: Object.fromEntries(Object.entries(profiles).map(([k, rate]) => [k, mix({}, { rate })])),
  padBeforeVerificationAndRisk: mix({}, { rail: 'pad' }),
  connectVolume: [1, 5, 10, 20].map(acts => ({ actsPerNotaryMonth: acts, ...mix({}, { acts }) })),
  payoutBatch10: mix({}, { batch: 10 }),
  contributionAfterIllustrativeSupportAndCac: baseline.margin - assumptions.supportPerAct - assumptions.cacPerAct,
  expectedUnrecoveredPrincipalLoss: [0.001, 0.005, 0.01].map(rate => ({ rate, costPerAct: baseline.honoraires * rate })),
  extraTaxProcessingPer100Collected: 100 * assumptions.domesticRate,
};
// Reconcile the accounting identity and boundary behavior; scenarios are not frequencies.
assert.equal(round(Object.values(assumptions.serviceMix).reduce((a, b) => a + b)), 1);
assert.equal(round(Object.values(assumptions.tierMix).reduce((a, b) => a + b)), 1);
for (const row of rows) {
  assert.ok(Math.abs(row.total - row.honoraires - row.processing - row.connect - row.margin) < 1e-8);
  assert.ok(Math.abs(margin(row.breakEvenHonoraires, row.nota).margin) < 1e-8);
  assert.ok(row.worstMargin <= row.margin);
  assert.ok(row.byCardProfile.internationalWithFx < row.byCardProfile.domestic);
}
assert.ok(margin(9000, domain.prixNota('financement', 'standard').totalCents / 100).margin < 0);
assert.ok(sensitivities.padBeforeVerificationAndRisk.margin > baseline.margin);
console.log(JSON.stringify({ date: '2026-09-08', assumptions, catalogue, rows, baseline, candidates, sensitivities }, (_, v) => typeof v === 'number' ? Number(v.toFixed(8)) : v, 2));
