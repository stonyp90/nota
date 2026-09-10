'use strict';

const D = require('@nota/domain');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DEFAULT_MODEL } = require('./assistant-port');

// Operational admission limits, not product pricing or a dollar budget.
const DEFAULT_DAILY_CALL_LIMIT = 100;
const MAX_IN_FLIGHT = 32;

// The current analysis lives on the private bid, with its retention/erasure
// policy. Raw page text is never persisted here or added to the support prompt.
function createFinancingAIRoutes({ repo, env, authenticate, json, parseBody, getSecret,
  port, nowMs = Date.now, newId = randomUUID, audit = async () => {}, learning = null, aiAccess = null }) {
  const error = (status, code) => json(status, { errors: [{ code, message: {
    ai_access_required: 'Activez la bêta IA ou choisissez une formule pour continuer.',
    quota_epuise: 'Votre quota de préparation IA est épuisé. Choisissez une formule ou achetez des unités.',
    paiement_requis: 'Votre abonnement IA nécessite une mise à jour du paiement.',
  }[code] || undefined }] });
  const workPacket = bid => D.financingWorkPacket(bid, { todayISO: D.businessDay(nowMs(), D.BUSINESS_TIMEZONE) });
  const setting = value => typeof value === 'string' ? value.trim() : '';
  const inFlight = new Map();
  let cachedProvider;
  async function learn(method, payload) {
    try {
      if (learning && typeof learning[method] === 'function') await learning[method](payload);
    } catch { /* learning telemetry can never block a notary action */ }
  }
  function configuration() {
    if (port) return { provider: 'injected', region: '',
      model: setting(port.model) || setting(env.NOTA_FINANCING_AI_MODEL) || setting(env.NOTA_ASSISTANT_MODEL) || DEFAULT_MODEL };
    const selectedProvider = setting(env.NOTA_FINANCING_AI_PROVIDER) || 'anthropic';
    const model = setting(env.NOTA_FINANCING_AI_MODEL);
    if (selectedProvider === 'bedrock') {
      const region = setting(env.NOTA_FINANCING_AI_REGION);
      if (!region || !model) return null;
      return { provider: 'bedrock', region, model };
    }
    if (selectedProvider !== 'anthropic') return null;
    return { provider: 'anthropic', region: '', model: model || setting(env.NOTA_ASSISTANT_MODEL) || DEFAULT_MODEL };
  }
  async function provider(config) {
    if (port) return port;
    if (config.provider === 'bedrock') {
      const signature = JSON.stringify(config);
      if (!cachedProvider || cachedProvider.signature !== signature) cachedProvider = { signature,
        port: require('./financing-ai').createBedrockFinancingPort({ region: config.region, model: config.model }) };
      return cachedProvider.port;
    }
    const keyParam = setting(env.NOTA_ASSISTANT_KEY_PARAM);
    const key = setting(env.ANTHROPIC_API_KEY) || setting(env.NOTA_ASSISTANT_API_KEY) ||
      (keyParam ? setting(await getSecret(keyParam)) : '');
    if (!key) return null;
    // Only the last client is retained. A rotated key or changed model replaces
    // it; credentials never enter the persisted analysis/reuse fingerprint.
    const signature = JSON.stringify([config, key]);
    if (!cachedProvider || cachedProvider.signature !== signature) cachedProvider = { signature,
      port: require('./financing-ai').createAnthropicFinancingPort({ apiKey: key, model: config.model }) };
    return cachedProvider.port;
  }
  function reusable(analysis, owner, identity, input) {
    if (!analysis || analysis.preparedBy !== owner || analysis.requestFingerprint !== identity.fingerprint ||
      !isDeepStrictEqual(analysis.provenance, identity.provenance)) return false;
    const checked = D.validateFinancingAIExtraction(input, { fields: analysis.preparation?.fields });
    return checked.ok && isDeepStrictEqual(checked.value, analysis.preparation);
  }
  return async function handle(request, route, method, query = {}) {
    if (!['/notary/financing/preparation', '/notary/financing/review'].includes(route)) return null;
    if (!((route.endsWith('/preparation') && ['GET', 'POST'].includes(method)) ||
      (route.endsWith('/review') && method === 'POST'))) return error(404, 'introuvable');
    const owner = authenticate(request);
    if (!owner) return error(401, 'non_autorise');
    const parsed = method === 'GET' ? { payload: query } : parseBody(request);
    if (parsed.error) return parsed.error;
    const input = parsed.payload;
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.id !== 'string' || !input.id || !D.isISODate(input.dateISO)) return error(422, 'requete_invalide');
    const bid = await repo.get(input.id, input.dateISO, { consistentRead: true });
    if (!bid) return error(404, 'introuvable');
    if (bid.notaryId !== owner) return error(403, 'interdit');
    if (bid.status !== D.STATUS.RETENUE || bid.efface) return error(409, 'dossier_indisponible');
    const entitlement = aiAccess && await aiAccess.get(owner);
    // Existing analyses remain reviewable after a trial or subscription ends;
    // only a new provider call requires an active entitlement. The web client
    // still hides this panel when access is unavailable, so the normal dossier
    // remains the default product experience.
    const needsEntitlement = route.endsWith('/preparation') && method === 'POST';
    if (needsEntitlement && aiAccess && aiAccess.monetized() && (!entitlement || !entitlement.enabled)) return error(402, entitlement?.reason === 'paiement_requis' ? 'paiement_requis' : 'ai_access_required');
    if (method === 'GET') return json(200, { analysis: bid.financingAnalysis || null, workPacket: workPacket(bid) });

    if (route.endsWith('/review')) {
      const v = D.validateFinancingAIReview(bid.financingAnalysis, input);
      if (!v.ok) return json(422, { errors: v.errors });
      const review = { ...v.value, reviewerId: owner, reviewedAt: new Date(nowMs()).toISOString() };
      const saved = await repo.reviewFinancingPreparation(bid, owner, input.analysisId, review);
      if (!saved) return error(409, 'analyse_modifiee');
      await audit('financing_ai_review', { bidId: bid.id, analysisId: input.analysisId,
        accepted: review.decisions.filter(d => d.decision === 'accepted').length,
        corrected: review.decisions.filter(d => d.decision === 'corrected').length,
        rejected: review.decisions.filter(d => d.decision === 'rejected').length,
        activeReviewSeconds: review.activeReviewSeconds }, owner);
      const current = await repo.get(input.id, input.dateISO, { consistentRead: true });
      if (!current || current.notaryId !== owner || current.status !== D.STATUS.RETENUE || current.efface) return error(409, 'dossier_indisponible');
      if (current.financingAnalysis?.id !== input.analysisId) return error(409, 'analyse_modifiee');
      await learn('notaryReview', { bid: current, analysis: current.financingAnalysis, review, owner });
      return json(200, { ok: true, review, workPacket: workPacket(current) });
    }

    if (env.NOTA_FINANCING_AI_ENABLED !== 'true') return error(503, 'financing_ai_disabled');
    if (input.processingAuthorized !== true) return error(422, 'autorisation_traitement_requise');
    const validated = D.validateFinancingAIInput({ serviceId: bid.serviceId, pages: input.pages });
    if (!validated.ok) return json(422, { errors: validated.errors });
    let consumedSource = null;
    try {
      const config = configuration();
      if (!config) return error(503, 'financing_ai_unavailable');
      const { createFinancingAI, financingRequestIdentity } = require('./financing-ai');
      const identity = financingRequestIdentity(validated.value, config);
      let analysisId;
      let reused = reusable(bid.financingAnalysis, owner, identity, validated.value);
      if (reused) analysisId = bid.financingAnalysis.id;
      else {
        const key = JSON.stringify([bid.id, bid.dateISO, owner, identity.fingerprint]);
        let pending = inFlight.get(key);
        reused = !!pending;
        let consumed = null;
        if (!pending) {
          if (inFlight.size >= MAX_IN_FLIGHT) return error(429, 'trop_de_requetes');
          consumed = aiAccess ? await aiAccess.consume(owner) : { ok: true, source: 'legacy_open' };
          if (!consumed.ok) return error(402, consumed.code);
          consumedSource = consumed.source;
          pending = (async () => {
            const rawLimit = setting(env.NOTA_FINANCING_AI_MAX_CALLS_PER_DAY);
            const dailyLimit = rawLimit ? Number(rawLimit) : DEFAULT_DAILY_CALL_LIMIT;
            if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) return { status: 503, code: 'financing_ai_unavailable' };
            // Shared atomic counters bound admitted attempts across workers.
            // Failures consume their reservation; duplicate reuse consumes none.
            const count = await repo.incrNotaryRateCounter('financing_ai', owner, 3600, nowMs());
            if (!Number.isSafeInteger(count) || count < 1) return { status: 503, code: 'financing_ai_unavailable' };
            if (count > 6) return { status: 429, code: 'trop_de_requetes' };
            const daily = await repo.incrNotaryRateCounter('financing_ai_budget', 'application', 86400, nowMs());
            if (!Number.isSafeInteger(daily) || daily < 1) return { status: 503, code: 'financing_ai_unavailable' };
            if (daily > dailyLimit) return { status: 429, code: 'trop_de_requetes' };
            const engine = createFinancingAI({ port: await provider(config), model: config.model });
            const started = nowMs();
            const result = await engine.prepare(validated.value);
            if (!result.ok) return { status: result.code === 'invalid_output' ? 502 : 503, code: 'financing_ai_' + result.code };
            const analysis = { id: newId(), preparation: result.preparation, provenance: result.provenance,
              createdAt: new Date(nowMs()).toISOString(), sourceOrigin: 'notary_supplied_text',
              preparedBy: owner, requestFingerprint: identity.fingerprint,
              performance: { provider: config.provider, region: config.region,
                latencyMs: Math.max(0, nowMs() - started), usage: result.usage } };
            const saved = await repo.saveFinancingPreparation(bid, owner, analysis,
              bid.financingAnalysis?.id || null, bid.financingAnalysis?.review?.reviewedAt || null);
            if (!saved) return { status: 409, code: 'analyse_modifiee' };
            await audit('financing_ai_preparation', { bidId: bid.id, analysisId: analysis.id,
              model: analysis.provenance.model, promptSha256: analysis.provenance.promptSha256,
              fields: analysis.preparation.fields.length, missing: analysis.preparation.missing.length,
              provider: config.provider, region: config.region,
              latencyMs: analysis.performance.latencyMs, usage: result.usage }, owner);
            return { analysisId: analysis.id };
          })();
          inFlight.set(key, pending);
        }
        let result;
        try { result = await pending; }
        finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
        if (result.status) { if (aiAccess && consumed) await aiAccess.refund(owner, consumed.source); consumedSource = null; return error(result.status, result.code); }
        analysisId = result.analysisId;
      }
      // Each waiter rechecks current ownership/erasure and reads current review
      // and customer context. Never return a cached HTTP response or work packet.
      const current = await repo.get(input.id, input.dateISO, { consistentRead: true });
      if (!current || current.notaryId !== owner || current.status !== D.STATUS.RETENUE || current.efface) return error(409, 'dossier_indisponible');
      if (current.financingAnalysis?.id !== analysisId) return error(409, 'analyse_modifiee');
      await learn('aiOutput', { bid: current, analysis: current.financingAnalysis, input: validated.value, owner, reused });
      consumedSource = null;
      return json(200, { ok: true, analysis: current.financingAnalysis, workPacket: workPacket(current), reused });
    } catch {
      if (aiAccess && consumedSource) await aiAccess.refund(owner, consumedSource);
      return error(503, 'financing_ai_unavailable');
    }
  };
}

module.exports = { createFinancingAIRoutes };
