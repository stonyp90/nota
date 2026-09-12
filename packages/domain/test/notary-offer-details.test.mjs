import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const D = createRequire(import.meta.url)('../index.js');

for (const svc of D.SERVICES) {
  test(`notaryOfferDetails exposes all declared catalogue answers for ${svc.id}`, () => {
    const answers = Object.fromEntries(svc.pricing.criteria.map(c => [c.id, c.type === 'choice' ? c.options[0].id : c.type === 'flag' ? false : 2]));
    const details = D.notaryOfferDetails(svc.id, answers);
    assert.deepEqual(details.map(d => d.id), svc.pricing.criteria.map(c => c.id));
    for (const c of svc.pricing.criteria) {
      const detail = details.find(d => d.id === c.id);
      assert.equal(detail.label, c.label);
      assert.equal(detail.value, c.type === 'choice' ? c.options[0].label : c.type === 'flag' ? 'Non' : c.unit === '$' ? D.money(2) : '2');
    }
    assert.ok(D.notaryOfferDetails(svc.id, {}).every(d => d.value === null), 'missing answers never become defaults');
  });
}

test('notaryOfferDetails formats amounts, zero counts and false answers; excludes arbitrary text and identity', () => {
  const details = D.notaryOfferDetails('financement', {
    valeur_pret: '350000', coemprunteur: false, approbation_bancaire: 'obtenue',
    preteur: '<script>secret</script>', preteur_autre: 'Client Name', courriel: 'secret@example.test',
  });
  assert.equal(details.find(d => d.id === 'valeur_pret').value, D.money(350000));
  assert.equal(details.find(d => d.id === 'coemprunteur').value, 'Non');
  assert.equal(details.find(d => d.id === 'preteur').value, null);
  assert.doesNotMatch(JSON.stringify(details), /secret|Client Name|courriel|preteur_autre/);
  assert.equal(D.notaryOfferDetails('testament', { nombre_beneficiaires: 0 }).find(d => d.id === 'nombre_beneficiaires').value, '0');
  for (const invalid of [null, {}, [], true, '', ' ', 'NaN', Infinity, -1]) {
    assert.equal(D.notaryOfferDetails('financement', { valeur_pret: invalid }).find(d => d.id === 'valeur_pret').value, null);
  }
  assert.deepEqual(D.notaryOfferDetails('unknown', { secret: 'text' }), []);
});
