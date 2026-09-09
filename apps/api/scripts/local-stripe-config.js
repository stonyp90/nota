'use strict';

// Local Stripe is opt-in and uses the in-memory stack. Never accept a live
// key here: a successful local test must not charge a real customer.
function configureLocalStripe(env = process.env) {
  if (!env.NOTA_LOCAL_STRIPE) return false;
  if (env.NOTA_LOCAL_STRIPE !== 'test') throw new Error('NOTA_LOCAL_STRIPE must be test.');
  if (!/^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_SECRET_KEY || '')) {
    throw new Error('Local Stripe requires a sk_test_ server key; live keys are refused.');
  }
  if (!/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET || '')) {
    throw new Error('Local Stripe requires the signing secret printed by stripe listen.');
  }
  if (env.STRIPE_CONNECT_WEBHOOK_SECRET && !/^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_CONNECT_WEBHOOK_SECRET)) {
    throw new Error('Invalid local Connect webhook signing secret.');
  }
  if (env.TABLE_NAME || env.ADMIN_TABLE_NAME || env.NOTA_RUNTIME_SECRET_ARN || env.NODE_ENV === 'production') {
    throw new Error('Local Stripe refuses production mode, AWS secret bundles and persistent tables.');
  }
  // All Checkout, magic-link and onboarding returns belong to the local UI,
  // even when the launching shell inherited production URLs.
  const site = `http://localhost:${Number(env.NOTA_PORT_WEB || 4173)}`;
  env.NOTA_SITE_URL = site;
  env.NOTA_BASE_URL = site;
  env.NOTA_ONBOARDING_RETURN_URL = site + '/#notaires';
  env.NOTA_ONBOARDING_REFRESH_URL = site + '/#notaires';
  return true;
}

module.exports = { configureLocalStripe };
