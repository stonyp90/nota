// Planning assumptions only; no production configuration is changed.
// Run from the repository root: node docs/planning/business-plan-model.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const d = require('../../packages/domain');
const serviceMix = { financement: 0.4, refinancement: 0.6 };
const tierMix = { standard: 0.70, rapide: 0.18, prioritaire: 0.07, urgence: 0.03, extreme: 0.02 };
const assumptions = {
  serviceMix, tierMix, cardRate: 0.029, cardFixed: 0.30,
  payoutRate: 0.0025, payoutFixed: 0.25, activeAccountMonthly: 2,
  supportPerAct: 30, lossRateOnCharge: 0.005,
  openingCapital: 250000, protectedCash: 25000,
  annualOperatingBudget: [250000, 720000, 1850000],
  demandBudgetIncluded: [40000, 154000, 440000],
  notaries: [30, 220, 700],
  bids: [534, 6000, 22000], retained: [307, 3500, 13750],
  completed: [244, 2800, 11000],
  monthlyCompleted: [0, 0, 0, 4, 6, 10, 15, 22, 30, 40, 52, 65],
  monthlyOperatingBudget: [20000, 28000, 24000, 22000, 20000, 20000, 20000, 20000, 19000, 19000, 19000, 19000],
};
function validateMix(mix, allowed) {
  assert.ok(Math.abs(Object.values(mix).reduce((a,b)=>a+b,0)-1)<1e-10);
  for (const [id,w] of Object.entries(mix)) {
    assert.ok(allowed.includes(id), `Unknown mix member ${id}`);
    assert.ok(Number.isFinite(w) && w>=0);
  }
}
validateMix(serviceMix, d.SERVICES.map(s=>s.id));
validateMix(tierMix, d.TIERS.map(t=>t.id));
const catalogue = d.SERVICES.map(s=>({id:s.id, name:s.nom, base:s.prixDepart, nota:d.prixNota(s.id,'standard').totalCents/100}));
const rows = d.SERVICES.flatMap(s=>d.TIERS.map(t=>{
  const h=d.computeBasePrice(s.id,{})*d.tierMultiplier(t.id);
  const n=d.prixNota(s.id,t.id).totalCents/100;
  const card=(h+n)*assumptions.cardRate+assumptions.cardFixed;
  const payout=h*assumptions.payoutRate+assumptions.payoutFixed;
  return {service:s.id,tier:t.id,honoraires:h,nota:n,charge:h+n,card,payout,paymentBeforeAccount:n-card-payout};
}));
function blend(mix=tierMix) {
  const out={honoraires:0,nota:0,charge:0,card:0,payout:0,paymentBeforeAccount:0};
  for (const r of rows) {
    const weight=(serviceMix[r.service]??0)*(mix[r.tier]??0);
    for (const key of Object.keys(out)) out[key]+=weight*r[key];
  }
  return out;
}
const baseline=blend();
assert.equal(assumptions.monthlyCompleted.reduce((a,b)=>a+b,0),244);
assert.equal(assumptions.monthlyOperatingBudget.reduce((a,b)=>a+b,0),250000);
let cash=assumptions.openingCapital;
const months=assumptions.monthlyCompleted.map((q,i)=>{
  // Conservative allocation: up to one distinct payout-active notary per act.
  const activeAccounts=Math.min(q,assumptions.notaries[0]);
  const account=activeAccounts*assumptions.activeAccountMonthly;
  const contribution=q*(baseline.paymentBeforeAccount-assumptions.supportPerAct-baseline.charge*assumptions.lossRateOnCharge)-account;
  const opening=cash;
  cash+=contribution-assumptions.monthlyOperatingBudget[i];
  return {month:i+1,completed:q,activeAccounts,account,opening,notaRevenue:q*baseline.nota,
    contribution,operatingBudget:assumptions.monthlyOperatingBudget[i],closing:cash,freeAboveReserve:cash-assumptions.protectedCash};
});
function annual(q,i,unit=baseline,support=30,lossRate=0.005,accountOverride) {
  const account=accountOverride??Math.min(q,12*assumptions.notaries[i])*assumptions.activeAccountMonthly;
  const payment=q*unit.paymentBeforeAccount-account;
  const service=q*support, losses=q*unit.charge*lossRate;
  const contribution=payment-service-losses;
  const operating=assumptions.annualOperatingBudget[i];
  // Marketing is inside operating, so do not subtract CAC again.
  return {completed:q,honoraires:q*unit.honoraires,charges:q*unit.charge,revenue:q*unit.nota,
    card:q*unit.card,payout:q*unit.payout,account,payment,service,losses,contribution,operating,
    operatingResult:contribution-operating,cac:assumptions.demandBudgetIncluded[i]/q,
    breakEvenActs:Math.ceil((operating+12*assumptions.notaries[i]*2)/(unit.paymentBeforeAccount-support-unit.charge*lossRate))};
}
const years=assumptions.completed.map((q,i)=>annual(q,i,baseline,30,0.005,i===0?months.reduce((sum,m)=>sum+m.account,0):undefined));
const scenarios=[
  {name:'Downside',factor:0.5,support:60,lossRate:0.01},
  {name:'Base',factor:1,support:30,lossRate:0.005},
  {name:'Upside',factor:1.5,support:20,lossRate:0.0025},
].map(s=>{
  const outputs=s.name==='Base'?years:assumptions.completed.map((q,i)=>annual(q*s.factor,i,baseline,s.support,s.lossRate));
  let cumulative=0,peak=0;
  for(const y of outputs){cumulative+=y.operatingResult;peak=Math.max(peak,-cumulative);}
  return {...s,years:outputs,peakYearEndDeficit:peak,capitalWithReserve:peak+assumptions.protectedCash,
    extraBeyondRaise:Math.max(0,peak+assumptions.protectedCash-assumptions.openingCapital)};
});
// Primary observed counts and explicit scenario inputs; none is product pricing.
const evidence = require('../pitch-deck/investor-sources.json');
const facts = evidence.sources;
const market = {
  reviewed: evidence.reviewed,
  observed: {
    quebecCmaSales: facts.apciq.facts.quebecCmaSales,
    quebecProvinceSales: facts.apciq.facts.quebecProvinceSales,
    canadaMlsSales: facts.crea.facts.canadaMlsSales,
    quebecTraditionalNotaries: facts.cnq.facts.traditionalPracticeNotaries,
    euNotariesApprox: facts.cnue.facts.euNotariesApprox,
    uinlMemberNotariats: facts.uinl.facts.memberNotariats
  },
  localScenario: {qualifiableShare:0.10,capturedShare:0.25,completionRate:0.80},
  sources: evidence.sources
};
market.localScenario.completed = market.observed.quebecCmaSales * market.localScenario.qualifiableShare * market.localScenario.capturedShare * market.localScenario.completionRate;
market.localSensitivity = [0.05,0.10,0.20].map(qualifiableShare=>({qualifiableShare,completed:market.observed.quebecCmaSales*qualifiableShare*market.localScenario.capturedShare*market.localScenario.completionRate}));
assert.ok(Math.abs(market.localScenario.completed-205.42)<1e-8);
// Partner rewards are already inside the acquisition operating envelopes.
// Allocate their maximum Year 1 cost to completed acts for the unit-economics
// illustration without subtracting them again from the annual result.
const partnerEconomics = {
  clientReward: d.REFERRAL.client,
  notaryReward: d.REFERRAL.notaire,
  rewardedClientRequests: assumptions.retained[0],
  rewardedNotaries: assumptions.notaries[0],
  completed: assumptions.completed[0],
};
partnerEconomics.clientBudget = partnerEconomics.clientReward * partnerEconomics.rewardedClientRequests;
partnerEconomics.notaryBudget = partnerEconomics.notaryReward * partnerEconomics.rewardedNotaries;
partnerEconomics.total = partnerEconomics.clientBudget + partnerEconomics.notaryBudget;
partnerEconomics.perCompletedAct = partnerEconomics.total / partnerEconomics.completed;
partnerEconomics.contributionAfterRewards = years[0].contribution - partnerEconomics.total;
partnerEconomics.contributionPerCompletedAct = partnerEconomics.contributionAfterRewards / partnerEconomics.completed;
partnerEconomics.remainingOperatingBudget = years[0].operating - partnerEconomics.total;
assert.ok(Math.abs(partnerEconomics.contributionAfterRewards - partnerEconomics.remainingOperatingBudget - years[0].operatingResult)<1e-7);
const output={version:'1.8',date:'2026-09-12',scope:'financing-only planning scenarios; four-service code catalogue',assumptions,catalogue,rows,baseline,market,partnerEconomics,months,years,scenarios};
function finite(obj){for(const v of Object.values(obj)){if(typeof v==='number')assert.ok(Number.isFinite(v));else if(v&&typeof v==='object')finite(v);}}
finite(output);
for(const y of years){assert.ok(Math.abs(y.charges-y.honoraires-y.revenue)<1e-7);assert.ok(Math.abs(y.revenue-y.card-y.payout-y.account-y.service-y.losses-y.contribution)<1e-7);}
assert.ok(Math.abs(months.at(-1).closing-assumptions.openingCapital-years[0].operatingResult)<1e-7);
fs.writeFileSync(path.join(__dirname,'business-plan-model.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({baseline,years,scenarios:scenarios.map(({name,capitalWithReserve,extraBeyondRaise})=>({name,capitalWithReserve,extraBeyondRaise})),yearOneClosingCash:cash,market},null,2));
