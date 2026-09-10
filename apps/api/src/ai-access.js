'use strict';

const D = require('@nota/domain');

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const MAX_PIECE_QUANTITY = 100;

function cleanPlan(id) {
  return D.notaryAIPlan(id) ? id : D.NOTARY_AI_PLANS[0].id;
}

function emptyAccess() {
  return {
    beta: { enrolledAt: null, granted: D.NOTARY_AI_BETA_TRIAL_USES, used: 0 },
    subscription: { status: 'none', planId: null, customerId: null, subscriptionId: null,
      periodStart: null, periodEnd: null, used: 0 },
    paidUses: 0,
    revision: 0,
  };
}

function normalizeAccess(value) {
  const base = emptyAccess();
  const source = value && typeof value === 'object' ? value : {};
  return {
    beta: { ...base.beta, ...(source.beta || {}), granted: D.NOTARY_AI_BETA_TRIAL_USES,
      used: Math.max(0, Number(source.beta?.used) || 0) },
    subscription: { ...base.subscription, ...(source.subscription || {}), used: Math.max(0, Number(source.subscription?.used) || 0) },
    paidUses: Math.max(0, Number(source.paidUses) || 0),
    revision: Math.max(0, Number(source.revision) || 0),
  };
}

function createNotaryAIAccess({ repo, env = process.env, nowMs = Date.now } = {}) {
  if (!repo) throw new Error('createNotaryAIAccess: repo is required');
  // Launch is an explicit deployment decision. Production alone must not turn
  // on a paid surface before Stripe prices and legal/commercial copy are ready.
  const monetized = () => env.NOTA_AI_MONETIZATION_ENABLED === 'true';

  async function raw(notaryId) {
    const notary = await repo.getNotary(notaryId);
    return { notary, access: normalizeAccess(notary && notary.aiAccess) };
  }

  function view(access, at = nowMs()) {
    const sub = access.subscription;
    const plan = D.notaryAIPlan(sub.planId);
    const periodActive = ACTIVE_SUBSCRIPTION_STATUSES.has(sub.status) &&
      (!sub.periodEnd || at < Date.parse(sub.periodEnd));
    const includedRemaining = periodActive && plan ? Math.max(0, plan.includedUses - sub.used) : 0;
    // The grant exists only after explicit beta opt-in. Keeping an unclaimed
    // grant out of `enabled` prevents an authenticated notary from receiving
    // the AI surface merely by having a profile.
    const trialRemaining = access.beta.enrolledAt
      ? Math.max(0, access.beta.granted - access.beta.used) : 0;
    const paidUses = access.paidUses;
    const allowed = !monetized() || trialRemaining > 0 || includedRemaining > 0 || paidUses > 0;
    let reason = 'beta_non_inscrite';
    if (!monetized()) reason = 'legacy_open';
    else if (trialRemaining > 0) reason = 'essais_beta';
    else if (includedRemaining > 0) reason = 'abonnement';
    else if (paidUses > 0) reason = 'unites_achetees';
    else if (sub.status === 'past_due') reason = 'paiement_requis';
    else reason = access.beta.enrolledAt ? 'quota_epuise' : 'beta_non_inscrite';
    return {
      enabled: allowed,
      reason,
      beta: { enrolled: !!access.beta.enrolledAt, enrolledAt: access.beta.enrolledAt,
        granted: access.beta.granted, used: access.beta.used, remaining: trialRemaining },
      subscription: { status: sub.status, planId: sub.planId, periodStart: sub.periodStart,
        periodEnd: sub.periodEnd, used: sub.used, included: plan ? plan.includedUses : 0,
        remaining: includedRemaining },
      paidUses,
    };
  }

  async function save(notaryId, access, expectedRevision) {
    if (typeof repo.updateNotaryAI !== 'function') throw new Error('AI entitlement persistence unavailable');
    return repo.updateNotaryAI(notaryId, access, expectedRevision);
  }

  async function get(notaryId) {
    const { notary, access } = await raw(notaryId);
    if (!notary) return null;
    return view(access);
  }

  async function enroll(notaryId) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return { ok: false, code: 'notaire_introuvable' };
      if (access.beta.enrolledAt) return { ok: true, access: view(access) };
      const next = { ...access, beta: { ...access.beta, enrolledAt: new Date(nowMs()).toISOString() }, revision: access.revision + 1 };
      if (await save(notaryId, next, access.revision)) return { ok: true, access: view(next) };
    }
    return { ok: false, code: 'conflit' };
  }

  async function consume(notaryId) {
    if (!monetized()) return { ok: true, source: 'legacy_open', access: await get(notaryId) };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return { ok: false, code: 'notaire_introuvable' };
      const before = view(access);
      let source = null;
      const next = { ...access, beta: { ...access.beta }, subscription: { ...access.subscription } };
      if (before.beta.remaining > 0) { source = 'trial'; next.beta.used += 1; }
      else if (before.subscription.remaining > 0) { source = 'subscription'; next.subscription.used += 1; }
      else if (before.paidUses > 0) { source = 'piece'; next.paidUses -= 1; }
      else return { ok: false, code: before.reason === 'paiement_requis' ? 'paiement_requis' : 'quota_epuise', access: before };
      next.revision = access.revision + 1;
      if (await save(notaryId, next, access.revision)) return { ok: true, source, access: view(next) };
    }
    return { ok: false, code: 'conflit', access: await get(notaryId) };
  }

  async function refund(notaryId, source) {
    if (!monetized() || !source || source === 'legacy_open') return true;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return false;
      const next = { ...access, beta: { ...access.beta }, subscription: { ...access.subscription } };
      if (source === 'trial' && next.beta.used > 0) next.beta.used -= 1;
      else if (source === 'subscription' && next.subscription.used > 0) next.subscription.used -= 1;
      else if (source === 'piece') next.paidUses += 1;
      else return false;
      next.revision = access.revision + 1;
      if (await save(notaryId, next, access.revision)) return true;
    }
    return false;
  }

  async function updateSubscription(notaryId, patch) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return null;
      const subscription = { ...access.subscription, ...patch };
      const changedSubscription = patch.subscriptionId && patch.subscriptionId !== access.subscription.subscriptionId;
      const changedPeriod = patch.periodStart && patch.periodStart !== access.subscription.periodStart;
      if (changedSubscription || changedPeriod) subscription.used = 0;
      const next = { ...access, beta: { ...access.beta }, subscription, revision: access.revision + 1 };
      if (await save(notaryId, next, access.revision)) return view(next);
    }
    return null;
  }

  async function addCredits(notaryId, quantity) {
    const count = Number(quantity);
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PIECE_QUANTITY) return null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return null;
      const next = { ...access, beta: { ...access.beta }, subscription: { ...access.subscription }, paidUses: access.paidUses + count, revision: access.revision + 1 };
      if (await save(notaryId, next, access.revision)) return view(next);
    }
    return null;
  }

  async function addCreditsOnce(notaryId, paymentId, quantity, at = new Date(nowMs()).toISOString()) {
    const count = Number(quantity);
    if (!paymentId || !Number.isSafeInteger(count) || count < 1 || count > MAX_PIECE_QUANTITY) return null;
    if (typeof repo.applyNotaryAIPayment !== 'function') return addCredits(notaryId, count);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { notary, access } = await raw(notaryId);
      if (!notary) return null;
      const next = { ...access, beta: { ...access.beta }, subscription: { ...access.subscription }, paidUses: access.paidUses + count, revision: access.revision + 1 };
      const result = await repo.applyNotaryAIPayment(notaryId, paymentId, next, access.revision, at);
      if (result && result.ok) return view(result.aiAccess || next);
    }
    return null;
  }

  return { monetized, get, enroll, consume, refund, updateSubscription, addCredits, addCreditsOnce,
    plan: cleanPlan, maxPieceQuantity: MAX_PIECE_QUANTITY,
    plans: () => D.NOTARY_AI_PLANS.map(D.notaryAIPlanPublic) };
}

function createNotaryAIBilling({ stripe, access, env = process.env, siteUrl = '' } = {}) {
  if (!stripe || !access) throw new Error('createNotaryAIBilling: stripe and access are required');
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const returnUrl = (kind) => (env.NOTA_AI_CHECKOUT_SUCCESS_URL || `${base}/#t=notaires&ai=${kind}`);
  const cancelUrl = env.NOTA_AI_CHECKOUT_CANCEL_URL || `${base}/#t=notaires&ai=cancel`;

  async function subscription({ notaryId, email, planId, language }) {
    const plan = D.notaryAIPlan(planId);
    const priceId = env['NOTA_AI_PRICE_' + String(planId || '').toUpperCase()];
    if (!plan || !priceId) return { ok: false, code: 'prix_non_configure' };
    const current = await access.get(notaryId);
    if (current && ACTIVE_SUBSCRIPTION_STATUSES.has(current.subscription.status)) {
      return { ok: false, code: 'abonnement_deja_actif' };
    }
    const result = await stripe.createNotaryAISubscription({ priceId, planId: plan.id, notaryId,
      customerEmail: email, language, successUrl: returnUrl('subscription'), cancelUrl });
    return { ok: true, ...result };
  }

  async function usage({ notaryId, email, planId, quantity, language, requestId }) {
    const plan = D.notaryAIPlan(planId);
    const count = Number(quantity);
    if (!plan || !Number.isSafeInteger(count) || count < 1 || count > MAX_PIECE_QUANTITY) return { ok: false, code: 'requete_invalide' };
    const result = await stripe.createNotaryAIUsagePayment({ unitAmountCents: plan.overageCents, quantity: count,
      planId: plan.id, notaryId, customerEmail: email, language, requestId,
      successUrl: returnUrl('usage'), cancelUrl });
    return { ok: true, ...result };
  }

  // The main Stripe webhook verifies the signature and idempotency first. This
  // handler only receives trusted events and mutates the notary entitlement.
  async function applyEvent(event) {
    const obj = event && event.data && event.data.object;
    const md = obj && obj.metadata || {};
    const product = md.product;
    if (product === 'nota_ai_subscription' && ['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted'].includes(event.type)) {
      const notaryId = md.notaryId || obj.metadata?.notaryId;
      if (!notaryId) return { handled: false };
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' :
        (event.type === 'checkout.session.completed' ? 'active' : (obj.status || 'active'));
      const planId = cleanPlan(md.planId || obj.metadata?.planId);
      const period = (name) => obj[name] ? new Date(Number(obj[name]) * 1000).toISOString() : null;
      const subscriptionPatch = {
        status, planId, customerId: obj.customer || null,
        subscriptionId: obj.subscription || (event.type.startsWith('customer.subscription.') ? obj.id : null),
        periodStart: period('current_period_start'), periodEnd: period('current_period_end'),
      };
      const updated = await access.updateSubscription(notaryId, subscriptionPatch);
      return { handled: !!updated };
    }
    if (product === 'nota_ai_usage' && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && obj.payment_status !== 'unpaid') {
      const notaryId = md.notaryId;
      const quantity = Number(md.quantity);
      const paymentId = obj.id || event.id;
      const updated = await access.addCreditsOnce(notaryId, paymentId, quantity,
        obj.created ? new Date(Number(obj.created) * 1000).toISOString() : undefined);
      return { handled: !!updated };
    }
    return { handled: false };
  }

  return { subscription, usage, applyEvent };
}

module.exports = { createNotaryAIAccess, createNotaryAIBilling, normalizeAccess, MAX_PIECE_QUANTITY };
