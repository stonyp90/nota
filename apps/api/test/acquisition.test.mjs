import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { acquisition } = require('../src/acquisition');
const { createApp } = require('../src/handler');
const { createMemoryRepo } = require('../src/repo-memory');
const { createAnalytics } = require('../src/analytics');
const stats = require('../src/stats');
const day = '2026-09-08';
test('acquisition drops unknown fields and unsafe identifiers, defaults missing source to unknown', () => {
  assert.deepEqual(acquisition({last:{source:'linkedin',campaign:'launch',email:'secret',url:'https://private',medium:'user@example.com',content:'x'.repeat(100)}}),{version:1,first:{source:'linkedin',campaign:'launch'},last:{source:'linkedin',campaign:'launch'}});
  assert.equal(acquisition(null).last.source,'unknown');
});
test('lead attribution is persisted privately and reflected in acquisition rollups; API waits for notification', async () => {
  const repo = createMemoryRepo(); let delivered = false;
  const app = createApp(repo,{now:()=>day,newId:()=> 'lead',notifier:{onOfferCreated:async()=>{await new Promise(r=>setTimeout(r,20));delivered=true;}}});
  const response = await app.handle({method:'POST',path:'/bids',body:JSON.stringify({serviceId:'refinancement',dateISO:'2026-09-20',montant:2400,prefixe:'G1R',courriel:'client@example.ca',acquisition:{first:{source:'google'},last:{source:'linkedin',campaign:'launch'}},pricing:{valeur_pret:250000,succession:'non',approbation_bancaire:'obtenue',preteur:'banque_nationale',deplacement:'client_50'}})});
  assert.equal(response.statusCode,201); assert.equal(delivered,true);
  assert.equal(JSON.parse(response.body).bid.acquisition,undefined);
  const bid = await repo.get('lead','2026-09-20'); assert.equal(bid.acquisition.last.source,'linkedin');
  const publicResponse = await app.handle({method:'GET',path:'/bids',query:{month:'2026-09'}});
  assert.doesNotMatch(publicResponse.body,/acquisition|notificationRecoveryVersion/);
  await repo.applyStatsDeltas(stats.statsDeltasForRetain(bid,day));
  const overview = await createAnalytics({repo,now:()=>day}).overview({from:day,to:day});
  const row = overview.acquisition.find(x=>x.source==='linkedin'); assert.equal(row.publie,1);assert.equal(row.retenue,1);
});

test('browser beacons cannot invent saved leads or notary signups', async () => {
  const repo = createMemoryRepo(); const app = createApp(repo,{now:()=>day});
  for (const event of ['publie','notaire_inscrit']) await app.handle({method:'POST',path:'/events',body:JSON.stringify({event,acquisition:{last:{source:'linkedin'}}})});
  const overview = await createAnalytics({repo,now:()=>day}).overview({from:day,to:day});
  assert.equal(overview.acquisition.find(x=>x.source==='linkedin').publie,0);
  assert.equal(overview.entonnoir.find(x=>x.id==='publie').total,0);
});
