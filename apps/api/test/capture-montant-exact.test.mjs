import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createStripeAdapter } = require('../src/stripe-port.js');

/**
 * LA CAPTURE PREND LE MONTANT DU RÈGLEMENT, JAMAIS LE PLEIN BLOCAGE.
 *
 * L'empreinte posée à la publication couvre l'offre du client. Au règlement, le
 * notaire déclare la valeur réelle de l'acte, bornée entre 0,25× et 3× de
 * l'offre (`domain.validateActValue`). Si la capture prend le plein montant
 * autorisé alors que le virement se calcule sur la valeur déclarée, l'écart
 * reste chez Nota — et cet écart est une part des honoraires du notaire.
 *
 * **Art. 32.1 2° de la Loi sur le notariat** — est présumée usurper les
 * fonctions de notaire la personne qui « obtient d'un notaire qu'il abandonne
 * une partie de ses honoraires et frais ». Un écart silencieusement retenu est
 * exactement cela, quelle que soit l'intention.
 *
 * **Art. 32 du Code de déontologie** — le notaire ne peut partager ses
 * honoraires avec un non-membre d'un ordre. La même opération, vue du notaire.
 *
 * Le client, lui, ne doit jamais être débité de plus que l'acte n'a valu :
 * `amount_to_capture` est la seule forme correcte. Le mécanisme existe déjà
 * dans ce même fichier pour les frais d'annulation (ADR 0023) ; il manquait au
 * règlement.
 */

// Un faux SDK Stripe : il enregistre les arguments reçus, sans réseau.
function fakeSdk() {
  const calls = { captures: [], transfers: [] };
  const sdk = {
    paymentIntents: {
      async capture(id, params, opts) {
        calls.captures.push({ id, params, opts });
        return { id, latest_charge: 'ch_' + id };
      },
      async cancel(id) { return { id, status: 'canceled' }; },
    },
    transfers: {
      async create(params, opts) {
        calls.transfers.push({ params, opts });
        return { id: 'tr_' + (params.metadata && params.metadata.bidId) };
      },
    },
  };
  return { sdk, calls };
}

const adapterOn = (sdk) => createStripeAdapter({ secretKey: 'sk_test', webhookSecret: 'whsec', stripe: sdk });

test('la capture porte le montant du règlement, pas le plein blocage', async () => {
  const { sdk, calls } = fakeSdk();
  const port = adapterOn(sdk);

  // Offre retenue à 2 000 $ → blocage de 2 400 $ (honoraires + prix de Nota).
  // L'acte vaut finalement 1 800 $ → le total dû est 2 200 $.
  await port.captureAndTransfer({
    paymentIntentId: 'pi_1', connectAccountId: 'acct_n1',
    amountCents: 220000, applicationFeeCents: 40000, bidId: 'B1',
  });

  assert.equal(calls.captures.length, 1, 'une seule capture');
  assert.deepEqual(calls.captures[0].params, { amount_to_capture: 220000 },
    'le client ne peut jamais être débité de plus que ce que l’acte a valu');
});

test('ART. 32.1 2° — l’écart entre le blocage et le règlement ne reste jamais chez Nota', async () => {
  const { sdk, calls } = fakeSdk();
  const port = adapterOn(sdk);

  const r = await port.captureAndTransfer({
    paymentIntentId: 'pi_2', connectAccountId: 'acct_n2',
    amountCents: 220000, applicationFeeCents: 40000, bidId: 'B2',
  });

  const capture = calls.captures[0].params.amount_to_capture;
  const vire = calls.transfers[0].params.amount;
  assert.equal(capture - vire, 40000,
    'ce que Nota garde est EXACTEMENT son prix — jamais son prix plus un écart');
  assert.equal(vire, 180000, 'le notaire touche la valeur de l’acte, en entier');
  assert.equal(r.netCents, 180000);
});

test('la capture reste idempotente par offre', async () => {
  const { sdk, calls } = fakeSdk();
  const port = adapterOn(sdk);
  await port.captureAndTransfer({
    paymentIntentId: 'pi_3', connectAccountId: 'acct_n3',
    amountCents: 100000, applicationFeeCents: 40000, bidId: 'B3',
  });
  assert.equal(calls.captures[0].opts.idempotencyKey, 'capture:B3');
  assert.equal(calls.transfers[0].opts.idempotencyKey, 'transfer:B3');
});
