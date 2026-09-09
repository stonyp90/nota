'use strict';

const D = require('@nota/domain');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DEFAULT_MODEL } = require('./assistant-port');

// AI is an accelerator for document triage, never a signing or legal decision.
// This route deliberately mirrors the financing route's ownership, consent,
// evidence and replay boundaries while storing a separate actAnalysis field.
const DEFAULT_DAILY_CALL_LIMIT = 100;
const MAX_IN_FLIGHT = 32;

function createActAIRoutes({ repo, env, authenticate, json, parseBody, getSecret,
  port, nowMs = Date.now, newId = randomUUID, audit = async () => {}, learning = null }) {
  const setting = value => typeof value === 'string' ? value.trim() : '';
  const error = (status, code) => json(status, { errors: [{ code }] });
  const packet = bid => D.actWorkPacket(bid, { todayISO: D.businessDay(nowMs(), D.BUSINESS_TIMEZONE) });
  const inFlight = new Map();
  let cachedProvider;
  async function learn(method, payload) {
    try {
      if (learning && typeof learning[method] === 'function') await learning[method](payload);
    } catch { /* learning telemetry can never block a notary action */ }
  }

  function configuration() {
    if (port) return { provider: 'injected', region: '', model: port.model || setting(env.NOTA_ACT_AI_MODEL) || setting(env.NOTA_ASSISTANT_MODEL) || DEFAULT_MODEL };
    const selected = setting(env.NOTA_ACT_AI_PROVIDER || env.NOTA_FINANCING_AI_PROVIDER) || 'anthropic';
    const model = setting(env.NOTA_ACT_AI_MODEL || env.NOTA_FINANCING_AI_MODEL);
    if (selected === 'bedrock') {
      const region = setting(env.NOTA_ACT_AI_REGION || env.NOTA_FINANCING_AI_REGION);
      if (!region || !model) return null;
      return { provider: 'bedrock', region, model };
    }
    if (selected !== 'anthropic') return null;
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
    const key = setting(env.ANTHROPIC_API_KEY) || setting(env.NOTA_ASSISTANT_API_KEY) || (keyParam ? setting(await getSecret(keyParam)) : '');
    if (!key) return null;
    const signature = JSON.stringify([config, key]);
    if (!cachedProvider || cachedProvider.signature !== signature) cachedProvider = { signature,
      port: require('./financing-ai').createAnthropicFinancingPort({ apiKey: key, model: config.model }) };
    return cachedProvider.port;
  }

  function analysisOf(bid) { return bid && bid.actAnalysis || null; }
  function reusable(analysis, owner, identity, input) {
    if (!analysis || analysis.preparedBy !== owner || analysis.requestFingerprint !== identity.fingerprint ||
      !isDeepStrictEqual(analysis.provenance, identity.provenance)) return false;
    const checked = D.validateActAIExtraction(input, { fields: analysis.preparation?.fields });
    return checked.ok && isDeepStrictEqual(checked.value, analysis.preparation);
  }

  return async function handle(request, route, method, query = {}) {
    if (!['/notary/acts/preparation', '/notary/acts/review'].includes(route)) return null;
    if (!((route.endsWith('/preparation') && ['GET', 'POST'].includes(method)) || (route.endsWith('/review') && method === 'POST'))) return error(404, 'introuvable');
    const owner = authenticate(request);
    if (!owner) return error(401, 'non_autorise');
    const parsed = method === 'GET' ? { payload: query } : parseBody(request);
    if (parsed.error) return parsed.error;
    const input = parsed.payload;
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.id !== 'string' || !input.id || !D.isISODate(input.dateISO)) return error(422, 'requete_invalide');
    const bid = await repo.get(input.id, input.dateISO, { consistentRead: true });
    if (!bid) return error(404, 'introuvable');
    if (bid.notaryId !== owner) return error(403, 'interdit');
    if (!['testament', 'procuration'].includes(bid.serviceId)) return error(422, 'service_inconnu');
    if (bid.status !== D.STATUS.RETENUE || bid.efface) return error(409, 'dossier_indisponible');
    if (method === 'GET') return json(200, { analysis: analysisOf(bid), workPacket: packet(bid) });

    if (route.endsWith('/review')) {
      const v = D.validateActAIReview(analysisOf(bid), input);
      if (!v.ok) return json(422, { errors: v.errors });
      const review = { ...v.value, reviewerId: owner, reviewedAt: new Date(nowMs()).toISOString() };
      const saved = await repo.reviewActPreparation(bid, owner, input.analysisId, review);
      if (!saved) return error(409, 'analyse_modifiee');
      await audit('act_ai_review', { bidId: bid.id, analysisId: input.analysisId,
        serviceId: bid.serviceId, accepted: review.decisions.filter(d => d.decision === 'accepted').length,
        corrected: review.decisions.filter(d => d.decision === 'corrected').length,
        rejected: review.decisions.filter(d => d.decision === 'rejected').length,
        activeReviewSeconds: review.activeReviewSeconds }, owner);
      const current = await repo.get(input.id, input.dateISO, { consistentRead: true });
      if (!current || current.notaryId !== owner || current.status !== D.STATUS.RETENUE || current.efface || current.actAnalysis?.id !== input.analysisId) return error(409, 'analyse_modifiee');
      await learn('notaryReview', { bid: current, analysis: current.actAnalysis, review, owner });
      return json(200, { ok: true, review, workPacket: packet(current) });
    }

    const enabled = env.NOTA_ACT_AI_ENABLED === 'true' || env.NOTA_FINANCING_AI_ENABLED === 'true';
    if (!enabled) return error(503, 'act_ai_disabled');
    if (input.processingAuthorized !== true) return error(422, 'autorisation_traitement_requise');
    const validated = D.validateActAIInput({ serviceId: bid.serviceId, pages: input.pages });
    if (!validated.ok) return json(422, { errors: validated.errors });
    try {
      const config = configuration();
      if (!config) return error(503, 'act_ai_unavailable');
      const { createActAI, actRequestIdentity } = require('./financing-ai');
      const identity = actRequestIdentity(validated.value, config);
      let analysisId;
      let reused = reusable(analysisOf(bid), owner, identity, validated.value);
      if (reused) analysisId = bid.actAnalysis.id;
      else {
        const key = JSON.stringify([bid.id, bid.dateISO, owner, identity.fingerprint]);
        let pending = inFlight.get(key);
        reused = !!pending;
        if (!pending) {
          if (inFlight.size >= MAX_IN_FLIGHT) return error(429, 'trop_de_requetes');
          pending = (async () => {
            const rawLimit = setting(env.NOTA_ACT_AI_MAX_CALLS_PER_DAY || env.NOTA_FINANCING_AI_MAX_CALLS_PER_DAY);
            const dailyLimit = rawLimit ? Number(rawLimit) : DEFAULT_DAILY_CALL_LIMIT;
            if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1) return { status: 503, code: 'act_ai_unavailable' };
            const perOwner = await repo.incrNotaryRateCounter('act_ai', owner, 3600, nowMs());
            if (!Number.isSafeInteger(perOwner) || perOwner < 1) return { status: 503, code: 'act_ai_unavailable' };
            if (perOwner > 6) return { status: 429, code: 'trop_de_requetes' };
            const daily = await repo.incrNotaryRateCounter('act_ai_budget', 'application', 86400, nowMs());
            if (!Number.isSafeInteger(daily) || daily < 1) return { status: 503, code: 'act_ai_unavailable' };
            if (daily > dailyLimit) return { status: 429, code: 'trop_de_requetes' };
            const engine = createActAI({ serviceId: bid.serviceId, port: await provider(config), model: config.model });
            const started = nowMs();
            const result = await engine.prepare(validated.value);
            if (!result.ok) return { status: result.code === 'invalid_output' ? 502 : 503, code: 'act_ai_' + result.code };
            const analysis = { id: newId(), serviceId: bid.serviceId, preparation: result.preparation, provenance: result.provenance,
              createdAt: new Date(nowMs()).toISOString(), sourceOrigin: 'notary_supplied_text', preparedBy: owner,
              requestFingerprint: identity.fingerprint, performance: { provider: config.provider, region: config.region,
                latencyMs: Math.max(0, nowMs() - started), usage: result.usage } };
            const saved = await repo.saveActPreparation(bid, owner, analysis, analysisOf(bid)?.id || null, analysisOf(bid)?.review?.reviewedAt || null);
            if (!saved) return { status: 409, code: 'analyse_modifiee' };
            await audit('act_ai_preparation', { bidId: bid.id, analysisId: analysis.id, serviceId: bid.serviceId,
              model: analysis.provenance.model, fields: analysis.preparation.fields.length, missing: analysis.preparation.missing.length,
              provider: config.provider, region: config.region, latencyMs: analysis.performance.latencyMs, usage: result.usage }, owner);
            return { analysisId: analysis.id };
          })();
          inFlight.set(key, pending);
        }
        let result;
        try { result = await pending; } finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
        if (result.status) return error(result.status, result.code);
        analysisId = result.analysisId;
      }
      const current = await repo.get(input.id, input.dateISO, { consistentRead: true });
      if (!current || current.notaryId !== owner || current.status !== D.STATUS.RETENUE || current.efface || current.actAnalysis?.id !== analysisId) return error(409, 'analyse_modifiee');
      await learn('aiOutput', { bid: current, analysis: current.actAnalysis, input: validated.value, owner, reused });
      return json(200, { ok: true, analysis: current.actAnalysis, workPacket: packet(current), reused });
    } catch { return error(503, 'act_ai_unavailable'); }
  };
}

module.exports = { createActAIRoutes };
