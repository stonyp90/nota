'use strict';

/**
 * Notifier use-cases — the orchestration layer of the notification vertical.
 * Wired from two ports: the single-table Repo and a mailer (see notify-port.js).
 * Framework- and SDK-free — tests drive it with the in-memory repo and the fake
 * mailer, no network.
 *
 * Responsibilities:
 *   - pick the right template (emails.js) for a lifecycle event;
 *   - respect the recipient's consent: never mail a suppressed (unsubscribed)
 *     address (CASL / Law 25);
 *   - be idempotent: a given (refId, kind) is mailed at most once, recorded in
 *     the SENT ledger, so a re-run or a webhook redelivery never double-sends.
 *
 * The notifier never throws to its callers about mail failures: onOfferCreated
 * is wired fire-and-forget into POST /bids and must never break the response.
 */

const emails = require('./emails');
const domain = require('@nota/domain');
// The cancellation barème (ADR 0023) — API data, resolved here exactly like
// the cancel route does, so a retention mail quotes the barème in force.
const cancellationCfg = require('./cancellation-config');

// Unsubscribe token: `base64url(email).signature`, HMAC-SHA-256 over the
// encoded address. The /unsubscribe route (GET and the RFC 8058 one-click POST)
// verifies before recording the opt-out.
//
// It used to be the bare base64url of the address, on the reasoning that CASL
// requires a *working* mechanism, not a signed one. True — but anyone who could
// guess an address (that is, anyone) could unsubscribe its owner, and the harm
// is real: a client silenced that way stops receiving the notices about THEIR
// OWN act — a proposition received, the notary who took it, the eve of the
// signing. The signature does not replace the mechanism; it makes sure the
// opt-out recorded is the one the recipient actually asked for.
//
// The secret is shared with the notary tokens (NOTA_NOTARY_SECRET): one secret
// to rotate, and the same fail-closed rule in production.
const { createHmac, timingSafeEqual } = require('crypto');

const UNSUB_DEV_SECRET = 'nota-dev-unsub-secret-do-not-use-in-prod';
function unsubSecret() {
  const configured = process.env.NOTA_NOTARY_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('NOTA_NOTARY_SECRET is required in production (refusing to sign unsubscribe links with the dev fallback).');
  }
  return UNSUB_DEV_SECRET;
}
function unsubSignature(payload) {
  return createHmac('sha256', unsubSecret()).update(payload).digest('base64url');
}
function encodeUnsubToken(email) {
  const payload = Buffer.from(String(email || ''), 'utf8').toString('base64url');
  return payload + '.' + unsubSignature(payload);
}
function decodeUnsubToken(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return '';
  const payload = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  let expected;
  try {
    expected = unsubSignature(payload);
  } catch {
    return '';
  }
  // Constant-time, and length-guarded: timingSafeEqual throws on a mismatch.
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return '';
  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

// `clientLink(bid)` (ADR 0033 §2.7) mints the signed, device-independent deep
// link to the client's own act — the CTA of every client act mail; the caller
// holds the signing secret, so it is injected. `adminUrl` (NOTA_ADMIN_URL)
// is where operator alerts land when an admin console exists.
function createNotifier({ repo, mailer, baseUrl, apiBaseUrl, operatorEmail, now, clientLink, adminUrl } = {}) {
  if (!repo) throw new Error('createNotifier: repo is required');
  if (!mailer) throw new Error('createNotifier: mailer is required');

  const clock = now || (() => new Date().toISOString());
  const base = baseUrl || '';

  // Le lien de retrait DOIT aboutir sur la route de l'API, pas sur l'application
  // web. Site et API partagent une origine derrière CloudFront, l'API sous
  // `/api/*` ; et la fonction `spa_router` (infra/cloudfront.tf) réécrit tout
  // chemin sans extension qui n'est PAS sous /api vers /index.html. Un lien
  // `<base>/unsubscribe` renvoyait donc l'application en 200 et n'enregistrait
  // rien — sur les 41 gabarits, c'est le SEUL mécanisme de retrait, et la LCAP
  // en exige un qui fonctionne. `apiBaseUrl` permet à un déploiement dont l'API
  // vit ailleurs (le serveur local, par exemple) de le dire.
  const apiBase = String(apiBaseUrl || String(base).replace(/\/+$/, '') + '/api').replace(/\/+$/, '');
  function unsubscribeUrl(email) {
    return apiBase + '/unsubscribe?token=' + encodeUnsubToken(email);
  }

  // --- Admin-parametrizable templates (consumption side) ---------------------
  // The admin console may store a per-template override: { key, actif,
  // subjectFr/En, preheaderFr/En, corpsFr/En, ctaFr/En, updatedAt }. The port is
  // OPTIONAL — repos without repo.getEmailOverride keep the built-in behaviour
  // untouched. Overrides are read through a small TTL cache so a burst of sends
  // (the reminder batch, a busy webhook) costs one repo read per template per
  // minute, not one per mail.
  //
  // The record is handed to the template as `__override`; emails.js `build()`
  // is the single place it turns into copy. The notifier decides only ONE
  // thing here: whether the record silences the send at all.
  //
  // NON-OVERRIDABLE mail, on purpose: the direct mailer.send bypasses
  // (onNotaryLoginRequested, onPartnerClaimRequested) and the admin console's
  // own magic link never consult an override. Those are AUTH-CRITICAL
  // transactional messages — silently disabling one would lock people out, and
  // rewording one blind could break the trust cues (validity, single-use)
  // around a sign-in link. They stay hard-coded.
  const OVERRIDE_TTL_MS = 60_000;
  const overrideCache = new Map(); // templateKey -> { value, fetchedAt }
  function clockMs() {
    // The injected clock returns an ISO string (tests freeze it); parse it so
    // the cache TTL follows the same fake time. Fall back to real time when the
    // clock's output is not parseable.
    const ms = Date.parse(clock());
    return Number.isFinite(ms) ? ms : Date.now();
  }
  async function getOverride(templateKey) {
    if (!templateKey || typeof repo.getEmailOverride !== 'function') return null;
    const nowMs = clockMs();
    const hit = overrideCache.get(templateKey);
    if (hit && nowMs - hit.fetchedAt < OVERRIDE_TTL_MS) return hit.value;
    let value = null;
    try {
      value = (await repo.getEmailOverride(templateKey)) || null;
    } catch {
      value = null; // a broken override store must never block mail
    }
    overrideCache.set(templateKey, { value, fetchedAt: nowMs });
    return value;
  }

  // Send one message at most once, honoring suppression. Returns a small result
  // describing what happened (sent, or why not) so callers/tests can assert.
  // `templateKey` names the emails.js registry entry behind `buildTemplate` and
  // `ctx` is the context that template reads; both ride into the build so a
  // stored override can silence the send or reword its copy.
  async function sendOnce({ refId, kind, to, buildTemplate, templateKey, ctx }) {
    if (!to) return { sent: false, reason: 'no-address', kind };
    if (await repo.isUnsubscribed(to)) return { sent: false, reason: 'unsubscribed', kind };
    if (await repo.wasNotificationSent(refId, kind)) return { sent: false, reason: 'duplicate', kind };

    // Art. 68 — un gabarit transactionnel ne s'éteint pas : emails.js seul sait
    // lesquels, et un enregistrement qui prétend le contraire est sans effet.
    const override = await getOverride(templateKey);
    if (emails.isOverrideDisabled(templateKey, override)) return { sent: false, reason: 'disabled', kind };

    const unsub = unsubscribeUrl(to);
    // `ctx` rides in the environment too: the override's {{jetons}} are
    // interpolated inside the template, and a couple of call sites hand the
    // template less than they declare here (onClientSignup and its {{email}}).
    const msg = buildTemplate({ ...(ctx || {}), unsubscribeUrl: unsub, baseUrl: base, adminUrl: adminUrl || null, __override: override });
    // unsubscribeUrl rides along so the mailer can emit the RFC 8058
    // List-Unsubscribe / List-Unsubscribe-Post headers.
    await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl: unsub });
    await repo.markNotificationSent(refId, kind, clock());
    return { sent: true, kind, to };
  }

  /**
   * L'ENVOI D'UNE CAMPAGNE — la seule porte générique du notifieur.
   *
   * `segments.resolveAudience` a déjà décidé QUI : consentement LCAP,
   * désabonnements, doublons et plafond de fréquence sont tranchés en amont.
   * Cette porte fait l'envoi, et rien de plus — mais elle refait la
   * vérification du désabonnement, parce qu'une garde qui ne tient qu'à
   * l'appelant n'en est pas une : `sendOnce` la refait aussi.
   *
   * Ce qu'elle NE fait PAS, délibérément :
   *
   *   • elle n'écrit pas dans le registre `SENT#`. Sa clé de partition varie
   *     avec le destinataire (`sentPK(refId, kind)`), donc elle est impossible
   *     à borner par `dynamodb:LeadingKeys` : la Lambda admin partirait en
   *     AccessDenied APRÈS avoir envoyé le courriel — le pire moment. Une
   *     campagne est idempotente par `markCampaignSent`, dont la partition est
   *     fixe et autorisable.
   *   • elle ne dédoublonne pas en silence. Un destinataire écarté doit l'être
   *     en amont, avec sa raison, là où l'opérateur la lit.
   *
   * Ce qu'elle garantit, elle : le retrait fonctionnel (RFC 8058), l'extinction
   * décidée par l'admin (art. 68 — un gabarit transactionnel ne s'éteint pas,
   * et `emails.js` seul sait lesquels), et un verdict lisible plutôt qu'un
   * silence.
   */
  async function sendCampaign({ to, templateKey, ctx }) {
    if (!to) return { sent: false, reason: 'no-address' };
    const build = emails.TEMPLATES && emails.TEMPLATES[templateKey];
    if (typeof build !== 'function') return { sent: false, reason: 'unknown-template' };
    if (await repo.isUnsubscribed(to)) return { sent: false, reason: 'unsubscribed' };

    const override = await getOverride(templateKey);
    if (emails.isOverrideDisabled(templateKey, override)) return { sent: false, reason: 'disabled' };

    const unsub = unsubscribeUrl(to);
    const msg = build({ ...(ctx || {}), unsubscribeUrl: unsub, baseUrl: base, adminUrl: adminUrl || null, __override: override });
    try {
      await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl: unsub });
    } catch {
      // Un destinataire perdu ne doit pas emporter la campagne : l'appelant
      // compte l'échec et poursuit.
      return { sent: false, reason: 'send-failed' };
    }
    return { sent: true, to };
  }

  // The client's signed deep link to THEIR act (ADR 0033 §2.7). A minting
  // failure — no secret, no site URL — must never block a mail: the CTA then
  // falls back to the client's space.
  function clientUrlFor(bid) {
    if (typeof clientLink !== 'function' || !bid || !bid.id) return null;
    try {
      return clientLink(bid) || null;
    } catch {
      return null;
    }
  }

  function bidCtx(bid, extra) {
    return {
      serviceId: bid.serviceId,
      dateISO: bid.dateISO,
      montant: bid.montant,
      tier: bid.tier,
      // ADR 0033 — every act mail can open THE act: the notary console on its
      // card (`bidId`), the client's own space on their offer (`clientUrl`).
      bidId: bid.id,
      clientUrl: clientUrlFor(bid),
      ...extra,
    };
  }

  // The retaining notary's profile — passed by the caller when it already
  // holds it, else read once here. Never throws: a missing profile only means
  // fewer facts in the mail.
  async function notaryOf(bid, given) {
    if (given) return given;
    if (!bid || !bid.notaryId || typeof repo.getNotary !== 'function') return null;
    try {
      return await repo.getNotary(bid.notaryId);
    } catch {
      return null;
    }
  }
  // The étude a client reads: the declared étude, then the legacy sign-in
  // label, then the notary's name, then their courriel (domain.notaryEtude).
  const etudeOf = (profile, bid) => domain.notaryEtude(profile) || (bid && bid.etude) || null;

  // The notary's contact block, as the client receives it at retention
  // (ADR 0033 §2.4): name, étude, phone, address, courriel, fiche at the
  // Chambre. Facts only — never a rating (ADR 0030).
  function notaireContact(profile) {
    if (!profile) return null;
    return {
      nom: profile.nom || null,
      etude: domain.notaryEtude(profile),
      telephone: profile.telephone || null,
      adresse: profile.adresse || null,
      courriel: profile.email || null,
      lienCNQ: profile.lienCNQ || null,
    };
  }

  // The barème in force, PRICED on this act (ADR 0023 data): the admin-stored
  // item, else the environment defaults — the same resolution as the cancel
  // route, so what the mail promises is what a cancellation would charge.
  // Each palier carries the fee on THIS montant; the template formats only.
  async function baremeFor(bid) {
    let stored = null;
    try {
      stored = typeof repo.getCancellationConfig === 'function' ? await repo.getCancellationConfig() : null;
    } catch {
      stored = null;
    }
    const paliers = stored && Array.isArray(stored.paliers) ? stored.paliers : cancellationCfg.envDefaults().paliers;
    return paliers.map((p) => ({
      maxJours: p.maxJours,
      taux: p.taux,
      frais: cancellationCfg.feeFor({ montant: bid.montant, joursAvant: p.maxJours, paliers }).frais,
    }));
  }

  // The facts of a demand a notary weighs: the lender (or the name the client
  // typed for « Autre prêteur »), the travel band, the sector.
  function demandeFacts(bid) {
    const lender = domain.bidLender(bid);
    const dep = domain.bidDeplacement(bid);
    return {
      secteur: bid.prefixe || null,
      deplacement: dep ? dep.id : null,
      preteur: lender ? lender.id : null,
      preteurNom: lender ? lender.nom : null,
    };
  }

  // Pay-on-accept: a demand whose card hold is still pending, or lapsed, is
  // not on the carnet — no notary could retain it, so nobody is rung for it.
  const isLive = (bid) => bid.paymentStatus !== 'pending' && bid.paymentStatus !== 'void';
  // The notary's alert preference (ADR 0033 §7), normalized by the domain;
  // absent → the daily digest.
  const alertesOf = (n) =>
    typeof domain.notaryAlertes === 'function'
      ? domain.notaryAlertes(n)
      : { pace: (n && n.alertes && n.alertes.pace) || 'daily', urgentOnly: !!(n && n.alertes && n.alertes.urgentOnly) };

  // --- Instant lead alerts (ADR 0033 §7) ---------------------------------------
  // Every ACTIVE notary who asked for pace « instant », can serve the demand
  // (ADR 0017/0025 reach rules — the same predicate as the feed and the
  // digest) and, when they asked for urgent ones only, only an elevated tier.
  // Idempotent per (bid, notary): the kind carries the notary id. A repo
  // without listNotaries simply rings nobody.
  async function notifyInstantLeads(bid) {
    const results = [];
    if (!bid || !bid.id || !isLive(bid) || typeof repo.listNotaries !== 'function') return results;
    let notaries = [];
    try {
      notaries = (await repo.listNotaries()) || [];
    } catch {
      return results;
    }
    const tier = domain.tierById(bid.tier);
    const facts = demandeFacts(bid);
    for (const n of notaries) {
      if (!n || !n.email || n.status !== 'active') continue;
      const alertes = alertesOf(n);
      if (alertes.pace !== 'instant') continue;
      if (alertes.urgentOnly && !(tier && tier.eleve)) continue;
      if (!domain.notaryCanServe((bid.pricing || {})[domain.DEPLACEMENT_CRITERION_ID], n, bid.prefixe)) continue;
      const distanceKm = typeof domain.fsaDistanceKm === 'function' ? domain.fsaDistanceKm(bid.prefixe, n.prefixe) : null;
      const ctx = bidCtx(bid, { ...facts, distanceKm });
      results.push(
        await sendOnce({
          refId: bid.id,
          kind: 'nouvelleDemande#' + n.id,
          to: n.email,
          templateKey: 'nouvelleDemande',
          ctx,
          buildTemplate: (env) => emails.nouvelleDemande({ ...ctx, ...env }),
        })
      );
    }
    return results;
  }

  // --- Offer lifecycle (client + operator) ---------------------------------

  // Fired from POST /bids (fire-and-forget). Confirms the offer to the client
  // (the offerPublished nudge → dossier) and alerts the operator of a new lead.
  async function onOfferCreated(bid) {
    const results = [];
    try {
      if (bid.courriel) {
        const ctx = bidCtx(bid);
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerPublished',
            to: bid.courriel,
            templateKey: 'offerPublished',
            ctx,
            buildTemplate: (env) => emails.offerPublished({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail) {
        const ctx = bidCtx(bid);
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorNewLead',
            to: operatorEmail,
            templateKey: 'operatorNewLead',
            ctx,
            buildTemplate: (env) => emails.operatorNewLead({ ...ctx, ...env }),
          })
        );
      }
      // ADR 0033 §7 — the notaries who asked to hear of every demand as it
      // lands. A demand still waiting for its card hold rings nobody here; it
      // rings when the hold is authorized (onAccountEvent).
      results.push(...(await notifyInstantLeads(bid)));
    } catch (err) {
      // Never let a mail failure break the caller (the POST /bids response).
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // The ONE retention moment (accept and proposition-accept alike) — the mise
  // en relation is complete (ADR 0033): the CLIENT receives the notary's
  // contact block and the barème; the RETAINING NOTARY receives the client's
  // block, the file's readiness and what binds them; the operator hears of the
  // revenue event. Each at most once per bid. `notary` may be passed by a
  // caller that already holds the profile (retainFor does).
  async function onOfferRetained(bid, { notary } = {}) {
    if (!bid) return { ok: true, results: [] };
    const results = [];
    try {
      const profile = await notaryOf(bid, notary);
      const bareme = await baremeFor(bid);
      const etude = etudeOf(profile, bid);
      if (bid.courriel) {
        const ctx = bidCtx(bid, { etude, notaire: notaireContact(profile), bareme });
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerRetained',
            to: bid.courriel,
            templateKey: 'offerRetained',
            ctx,
            buildTemplate: (env) => emails.offerRetained({ ...ctx, ...env }),
          })
        );
      }
      if (profile && profile.email) {
        const r = domain.leadReadiness(bid.serviceId, bid.dossier || {});
        const facts = demandeFacts(bid);
        const ctx = bidCtx(bid, {
          email: bid.courriel || null,
          client: {
            nom: bid.nom || null,
            courriel: bid.courriel || null,
            telephone: bid.telephone || null,
            secteur: facts.secteur,
            deplacement: facts.deplacement,
            preteur: facts.preteur,
            preteurNom: facts.preteurNom,
          },
          dossier: { ready: r.ready, missing: r.missing, requis: r.requis },
          bareme,
        });
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'demandeRetenueNotaire',
            to: profile.email,
            templateKey: 'demandeRetenueNotaire',
            ctx,
            buildTemplate: (env) => emails.demandeRetenueNotaire({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail) {
        const ctx = bidCtx(bid, { etude });
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorDemandeRetenue',
            to: operatorEmail,
            templateKey: 'operatorDemandeRetenue',
            ctx,
            buildTemplate: (env) => emails.operatorDemandeRetenue({ ...ctx, ...env }),
          })
        );
      }
      // Referral rewards (ADR 0011) — retention is the earning moment for the
      // client track, and the first retained act is the earning moment for the
      // notary track, so BOTH are checked here, on the one retain path every
      // flow funnels through (accept and proposition-accept alike).
      results.push(...(await onReferralRetained(bid)));
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // A reward mail is a payout instruction, so it may bind ONLY a CONFIRMED
  // partner (email-verified, ADR 0011 fraud-hardening) — a pending/unconfirmed
  // claim is never a payee. In practice a PARTNER# record only exists once
  // confirmed, but the `confirmedAt` check is made explicit here so an
  // unconfirmed record can never receive reward mail.
  const isConfirmedPartner = (p) => !!(p && p.courriel && p.confirmedAt);

  // --- Partner referral rewards (ADR 0011) ----------------------------------
  // A reward mail goes only to a partner who actually CONFIRMED their code
  // (POST /partenaires + /partenaires/verify gives us a verified courriel); an
  // unregistered or unconfirmed code still earns in the admin ledger, there is
  // just nowhere to send the news. Two tracks:
  //   • client: the retained bid carries `parrain` -> one mail per bid
  //     (refId = bid id, kind referral_client);
  //   • notaire: the retaining notary's profile carries `parrain` -> one mail
  //     EVER per notary (refId = notary id, kind referral_notaire) — the SENT
  //     ledger is exactly the "first retained act" rule, no counting needed.
  async function onReferralRetained(bid) {
    const results = [];
    if (typeof repo.getPartner !== 'function') return results;
    // Same FRAUD BARRIER the earning ledger enforces (see recordReferralEarnings
    // in handler.js): a reward mail is a payout instruction to the operator, so
    // it may only fire on a LIVE demand — one whose card was authorized, or where
    // billing is off (no paymentStatus, every bid live). A bid still `pending`
    // (never taken through Checkout) is a staged demand and earns no mail on
    // either track. Kept identical to the handler's isLive so the two never
    // drift — the canonical voided value is 'void' (repo markAuthorizationVoided).
    const isLive = bid.paymentStatus !== 'pending' && bid.paymentStatus !== 'void';
    if (!isLive) return results;

    if (bid.parrain) {
      const partner = await repo.getPartner(bid.parrain);
      if (isConfirmedPartner(partner)) {
        const ctx = { ...bidCtx(bid), code: partner.code };
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'referral_client',
            to: partner.courriel,
            templateKey: 'referralRewardClient',
            ctx,
            buildTemplate: (env) => emails.referralRewardClient({ ...ctx, ...env }),
          })
        );
      }
    }

    const notary =
      bid.notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(bid.notaryId) : null;
    if (notary && notary.parrain) {
      const partner = await repo.getPartner(notary.parrain);
      if (isConfirmedPartner(partner)) {
        const ctx = { code: partner.code };
        results.push(
          await sendOnce({
            refId: notary.id,
            kind: 'referral_notaire',
            to: partner.courriel,
            templateKey: 'referralRewardNotary',
            ctx,
            buildTemplate: (env) => emails.referralRewardNotary({ ...ctx, ...env }),
          })
        );
      }
    }
    return results;
  }

  // Fired from POST /partenaires (fire-and-forget): welcome the partner with
  // their shareable link + alert the operator, each at most once per code.
  async function onPartnerRegistered(partner) {
    if (!partner || !partner.code) return { ok: true, results: [] };
    const results = [];
    try {
      if (partner.courriel) {
        const ctx = { code: partner.code, type: partner.type };
        results.push(
          await sendOnce({
            refId: partner.code,
            kind: 'partnerWelcome',
            to: partner.courriel,
            templateKey: 'partnerWelcome',
            ctx,
            buildTemplate: (env) => emails.partnerWelcome({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail) {
        const ctx = { code: partner.code, type: partner.type, courriel: partner.courriel };
        results.push(
          await sendOnce({
            refId: partner.code,
            kind: 'operatorNewPartner',
            to: operatorEmail,
            templateKey: 'operatorNewPartner',
            ctx,
            buildTemplate: (env) => emails.operatorNewPartner({ ...ctx, ...env }),
          })
        );
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Notary actions on an open offer ---------------------------------------
  // Fired fire-and-forget from POST /notary/bids/propose: the client (no account,
  // per-bid token) learns a notary proposed a higher price. Idempotent per
  // proposition id.
  async function onCounterOfferProposed(bid, proposition) {
    if (!bid || !bid.courriel || !proposition) return { ok: true, results: [] };
    try {
      const ctx = {
        ...bidCtx(bid),
        etude: proposition.etude || null,
        proposition: { montant: proposition.montant, delta: proposition.delta, message: proposition.message, etude: proposition.etude },
      };
      const r = await sendOnce({
        refId: proposition.id,
        kind: 'propositionRecue',
        to: bid.courriel,
        templateKey: 'propositionRecue',
        ctx,
        buildTemplate: (env) => emails.propositionRecue({ ...ctx, ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /notary/bids/documents: the client is mailed the list of
  // requested items. Idempotent per demande id.
  async function onDocumentsRequested(bid, demande) {
    if (!bid || !bid.courriel || !demande) return { ok: true, results: [] };
    try {
      const ctx = {
        ...bidCtx(bid),
        etude: demande.etude || null,
        demande: { documents: demande.documents, message: demande.message, etude: demande.etude },
      };
      const r = await sendOnce({
        refId: demande.id,
        kind: 'documentsDemandes',
        to: bid.courriel,
        templateKey: 'documentsDemandes',
        ctx,
        buildTemplate: (env) => emails.documentsDemandes({ ...ctx, ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /client/propositions/accept|decline: tells the notary who
  // made the proposition how the client answered. `notary` is their profile
  // (repo.getNotary); resolved here when the caller did not pass it. One mail
  // per proposition: the kind follows the final status.
  async function onCounterOfferAnswered(bid, proposition, notary) {
    if (!bid || !proposition) return { ok: true, results: [] };
    try {
      const profile =
        notary || (proposition.notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(proposition.notaryId) : null);
      const to = profile && profile.email;
      const accepted = proposition.status === 'acceptee';
      const key = accepted ? 'propositionAcceptee' : 'propositionRefusee';
      const ctx = { ...bidCtx(bid), proposition: { montant: proposition.montant, delta: proposition.delta } };
      const r = await sendOnce({
        refId: proposition.id,
        kind: key,
        to,
        templateKey: key,
        ctx,
        buildTemplate: (env) => (accepted ? emails.propositionAcceptee : emails.propositionRefusee)({ ...ctx, ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // Fired from POST /client/bid/cancel: the client withdrew their offer. The
  // client always gets a confirmation; when the bid was RETAINED, the notary
  // who held it and the operator are told too — a mise en relation (and maybe
  // money) is being unwound. Idempotent per bid and audience.
  async function onOfferCancelled(bid, { notary, wasRetained } = {}) {
    if (!bid) return { ok: true, results: [] };
    const results = [];
    try {
      // ADR 0023/0033 — what the cancellation actually kept, and for whom:
      // `bid.annulation` (null → free) is the record the cancel route wrote.
      const annulation = bid.annulation || null;
      if (bid.courriel) {
        const ctx = bidCtx(bid, { annulation });
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerCancelled',
            to: bid.courriel,
            templateKey: 'offerCancelled',
            ctx,
            buildTemplate: (env) => emails.offerCancelled({ ...ctx, ...env }),
          })
        );
      }
      if (wasRetained) {
        const to = notary && notary.email;
        const ctx = bidCtx(bid, { annulation });
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'offerCancelledNotary',
            to,
            templateKey: 'offerCancelledNotary',
            ctx,
            buildTemplate: (env) => emails.offerCancelledNotary({ ...ctx, ...env }),
          })
        );
        if (operatorEmail) {
          const opCtx = { ...bidCtx(bid), etude: etudeOf(notary, bid), annulation };
          results.push(
            await sendOnce({
              refId: bid.id,
              kind: 'operatorOfferCancelled',
              to: operatorEmail,
              templateKey: 'operatorOfferCancelled',
              ctx: opCtx,
              buildTemplate: (env) => emails.operatorOfferCancelled({ ...opCtx, ...env }),
            })
          );
        }
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // Fired from POST /notary/bids/release: the retaining notary WITHDREW (a
  // detail — often the lender — made the file impossible on their side) and
  // the act is back on the open market. The client is told right away (their
  // date still stands, other notaries can retain it); the operator is alerted
  // when a payment may be in flight, same posture as a cancelled retained bid.
  async function onActReleased(bid, { notary, etude, message, paidOrHeld } = {}) {
    if (!bid) return { ok: true, results: [] };
    const results = [];
    try {
      if (bid.courriel) {
        const ctx = bidCtx(bid);
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'actReleased',
            to: bid.courriel,
            templateKey: 'actReleased',
            ctx,
            buildTemplate: (env) => emails.actReleased({ ...ctx, ...env }),
          })
        );
      }
      // ADR 0033: ALWAYS — a désistement is a signal on the notary's file,
      // whether or not money is in flight or a motif was given.
      if (operatorEmail) {
        const ctx = {
          ...bidCtx(bid),
          etude: etude || etudeOf(notary, null),
          notaireEmail: (notary && notary.email) || null,
          messageNotaire: message || null,
          paidOrHeld: !!paidOrHeld,
        };
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorActReleased',
            to: operatorEmail,
            templateKey: 'operatorActReleased',
            ctx,
            buildTemplate: (env) => emails.operatorActReleased({ ...ctx, ...env }),
          })
        );
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Contact form (nous joindre) ------------------------------------------
  // Fired from POST /contact. The operator gets the message and the sender an
  // acknowledgement; the sender's unsubscribe silences only their own ack —
  // their message still reaches the operator, because writing the form IS the
  // request to be contacted. refId is the contact id minted per submission, so
  // the same person can write twice.
  async function onContactMessage(msg) {
    if (!msg || !msg.courriel || !msg.message) return { ok: true, results: [] };
    const results = [];
    try {
      if (operatorEmail) {
        const ctx = { nom: msg.nom, email: msg.courriel, sujet: msg.sujet, message: msg.message, bidId: msg.bidId };
        results.push(
          await sendOnce({
            refId: msg.id,
            kind: 'operatorContactMessage',
            to: operatorEmail,
            templateKey: 'operatorContactMessage',
            ctx,
            buildTemplate: (env) => emails.operatorContactMessage({ ...ctx, ...env }),
          })
        );
      }
      {
        const ctx = { nom: msg.nom, message: msg.message };
        results.push(
          await sendOnce({
            refId: msg.id,
            kind: 'contactRecu',
            to: msg.courriel,
            templateKey: 'contactRecu',
            ctx,
            buildTemplate: (env) => emails.contactRecu({ ...ctx, ...env }),
          })
        );
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Live support messaging (ADR 0026) -----------------------------------
  // Every visitor message lands live with the operator: one email per message
  // (idempotent by message id) whose CTA is the signed reply link. Wired
  // fire-and-forget from POST /support/messages — never throws to the caller.
  async function onSupportMessage({ message, courriel, replyUrl } = {}) {
    if (!message || !message.texte) return { ok: true, results: [] };
    const results = [];
    try {
      if (operatorEmail) {
        // `email` doubles the courriel so the {{email}} placeholder of a subject
        // override resolves (the template reads `courriel`).
        const ctx = { courriel: courriel || null, email: courriel || null, texte: message.texte, replyUrl };
        results.push(
          await sendOnce({
            refId: message.id,
            kind: 'operatorSupportMessage',
            to: operatorEmail,
            templateKey: 'operatorSupportMessage',
            ctx,
            buildTemplate: (env) => emails.operatorSupportMessage({ ...ctx, ...env }),
          })
        );
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // The operator's reply, copied to the visitor's inbox when they left a
  // courriel — the widget already shows it live. Idempotent by message id.
  async function onSupportReply({ message, courriel } = {}) {
    if (!message || !message.texte || !courriel) return { ok: true, results: [] };
    const results = [];
    try {
      // The CTA reopens the widget on the site (`#messagerie`, consumed on boot).
      const ctx = { texte: message.texte, chatUrl: base.replace(/\/+$/, '') + '/#messagerie' };
      results.push(
        await sendOnce({
          refId: message.id,
          kind: 'supportReponse',
          to: courriel,
          templateKey: 'supportReponse',
          ctx,
          buildTemplate: (env) => emails.supportReponse({ ...ctx, ...env }),
        })
      );
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Client onboarding ---------------------------------------------------
  // Fired when a client signs up (email captured in the sign-in modal, no offer
  // yet). One warm welcome, conversion-first (publish a demand). Idempotent per
  // address, so re-opening the modal or signing in again never re-sends. Wired
  // fire-and-forget from POST /client/welcome — never throws to the caller.
  async function onClientSignup(email) {
    const to = String(email || '').trim().toLowerCase();
    if (!to) return { ok: true, results: [] };
    try {
      const r = await sendOnce({
        refId: to,
        kind: 'clientWelcome',
        to,
        templateKey: 'clientWelcome',
        ctx: { email: to },
        buildTemplate: (env) => emails.clientWelcome({ ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // --- Reminder cadence (called by the daily scheduler) --------------------
  // Maps a domain reminder kind to its template. j7/j3/j1 share the tier-aware
  // dateApproaching template; j0 (the date is today and still no notary) is the
  // dateMissedNoUptake "raise your offer" nudge; dossier_incomplet uses the
  // dossierIncomplete nudge.
  async function onReminderDue(bid, kind, todayISO) {
    if (!bid || !bid.courriel) return { sent: false, reason: 'no-address', kind };
    const days = domain.daysBetween(todayISO, bid.dateISO);
    const templateKey =
      kind === 'dossier_incomplet' ? 'dossierIncomplete' : kind === 'j0' ? 'dateMissedNoUptake' : 'dateApproaching';
    const ctx = bidCtx(bid, { days });
    return sendOnce({
      refId: bid.id,
      kind,
      to: bid.courriel,
      templateKey,
      ctx,
      buildTemplate: (env) => emails[templateKey]({ ...ctx, ...env }),
    });
  }

  // --- Daily carnet digest (called by the same scheduler) --------------------
  // Yesterday's fresh live demands, already filtered to what THIS notary can
  // serve (ADR 0017) by the caller. The kind carries the day, so the SENT
  // ledger yields at most one digest per notary per day and re-arms tomorrow.
  async function onNotaryDigest(notary, bids, todayISO) {
    if (!notary || !notary.email || !Array.isArray(bids) || bids.length === 0) {
      return { sent: false, reason: 'nothing-to-digest', kind: 'newMatchingBids' };
    }
    // Subject counts every matching demand; the table shows the top 8 by
    // montant — the same fixed block the carnet teaser holds on the site.
    const top = [...bids].sort((a, b) => (b.montant || 0) - (a.montant || 0)).slice(0, 8);
    const ctx = { bids: top, n: bids.length };
    return sendOnce({
      refId: notary.id,
      kind: 'newMatchingBids#' + todayISO,
      to: notary.email,
      templateKey: 'newMatchingBids',
      ctx,
      buildTemplate: (env) => emails.newMatchingBids({ ...ctx, ...env }),
    });
  }

  // --- Retained-act conversation (client ↔ notaire) --------------------------
  // Fired fire-and-forget from POST /notary/bids/message and POST
  // /client/bid/message: the other party learns a message landed in the dossier
  // thread. Idempotent PER MESSAGE (refId = message.id), so every message
  // notifies exactly once — a retry or double-post never re-mails, and the next
  // message in the thread mails again. Direction decides everything:
  //   notaire → client : bid.courriel gets messageDuNotaire;
  //   client → notaire : the retaining notary's email gets messageDuClient
  //                      (profile resolved via repo.getNotary when not passed).
  /**
   * Un document déposé dans le fil (ADR 0032). Prévenir est le point : sans
   * cela, un document n'est qu'un événement de second rang qu'on découvre en
   * rouvrant la page — et une pièce attendue dormirait pendant que la date
   * approche.
   *
   * Le NOM du fichier voyage, jamais son contenu ni un lien direct : le
   * document se lit derrière l'authentification, par une autorisation brève.
   */
  async function onChatDocument(bid, document, { notary } = {}) {
    if (!bid || !document || !document.id || document.etat !== 'pret') return { ok: true, results: [] };
    try {
      const profile = await notaryOf(bid, notary);
      if (document.de === domain.CHAT_FROM.NOTAIRE) {
        const ctx = {
          ...bidCtx(bid),
          etude: etudeOf(profile, bid),
          document: document.nom,
        };
        const r = await sendOnce({
          refId: document.id,
          kind: 'documentDuNotaire',
          to: bid.courriel,
          templateKey: 'documentDuNotaire',
          ctx,
          buildTemplate: (env) => emails.documentDuNotaire({ ...ctx, ...env }),
        });
        return { ok: true, results: [r] };
      }
      if (document.de === domain.CHAT_FROM.CLIENT) {
        const ctx = { ...bidCtx(bid), document: document.nom };
        const r = await sendOnce({
          refId: document.id,
          kind: 'documentDuClient',
          to: profile && profile.email,
          templateKey: 'documentDuClient',
          ctx,
          buildTemplate: (env) => emails.documentDuClient({ ...ctx, ...env }),
        });
        return { ok: true, results: [r] };
      }
      return { ok: true, results: [] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  async function onChatMessage(bid, message, { notary } = {}) {
    if (!bid || !message || !message.id || !message.texte) return { ok: true, results: [] };
    try {
      if (message.de === domain.CHAT_FROM.NOTAIRE) {
        const profile = await notaryOf(bid, notary);
        const ctx = {
          ...bidCtx(bid),
          etude: etudeOf(profile, bid),
          message: message.texte,
        };
        const r = await sendOnce({
          refId: message.id,
          kind: 'messageDuNotaire',
          to: bid.courriel,
          templateKey: 'messageDuNotaire',
          ctx,
          buildTemplate: (env) => emails.messageDuNotaire({ ...ctx, ...env }),
        });
        return { ok: true, results: [r] };
      }
      if (message.de === domain.CHAT_FROM.CLIENT) {
        const profile = await notaryOf(bid, notary);
        const ctx = { ...bidCtx(bid), message: message.texte };
        const r = await sendOnce({
          refId: message.id,
          kind: 'messageDuClient',
          to: profile && profile.email,
          templateKey: 'messageDuClient',
          ctx,
          buildTemplate: (env) => emails.messageDuClient({ ...ctx, ...env }),
        });
        return { ok: true, results: [r] };
      }
      return { ok: true, results: [] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // --- Evaluation feedback loop (ADR 0015/0016) ------------------------------
  // Fired fire-and-forget from POST /client/evaluation after the write: the
  // rated notary hears about their new evaluation (it moved their cote — never
  // a public average, ADR 0030),
  // and a LOW note (<= 2) alerts the operator — a churn/moderation signal a
  // human should read. Idempotent per bid: the evaluation itself is write-once.
  async function onEvaluationSubmitted(bid, evaluation) {
    if (!bid || !evaluation || !Number.isFinite(Number(evaluation.note))) return { ok: true, results: [] };
    const results = [];
    try {
      const notary = await notaryOf(bid, null);
      const ctx = {
        ...bidCtx(bid),
        note: Number(evaluation.note),
        commentaire: evaluation.commentaire || null,
        etude: etudeOf(notary, bid),
      };
      if (notary && notary.email) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'evaluationRecueNotaire',
            to: notary.email,
            templateKey: 'evaluationRecueNotaire',
            ctx,
            buildTemplate: (env) => emails.evaluationRecueNotaire({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail && Number(evaluation.note) <= 2) {
        const opCtx = { ...ctx, notaireEmail: (notary && notary.email) || null };
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorLowRating',
            to: operatorEmail,
            templateKey: 'operatorLowRating',
            ctx: opCtx,
            buildTemplate: (env) => emails.operatorLowRating({ ...opCtx, ...env }),
          })
        );
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  // --- Notary onboarding (free Stripe Connect) ------------------------------
  // Fired from POST /notaries/connect (fire-and-forget). Backs up the hosted
  // onboarding link into the notary's inbox so a closed tab is recoverable.
  // Idempotent per address: a double-click never double-sends.
  async function onNotaryConnected(email, onboardingUrl) {
    const to = String(email || '').trim().toLowerCase();
    if (!to) return { ok: true, results: [] };
    try {
      const ctx = { onboardingUrl, email: to };
      const r = await sendOnce({
        refId: to,
        kind: 'notaryOnboardingStarted',
        to,
        templateKey: 'notaryOnboardingStarted',
        ctx,
        buildTemplate: (env) => emails.notaryOnboardingStarted({ ...ctx, ...env }),
      });
      return { ok: true, results: [r] };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results: [] };
    }
  }

  // --- Act paid (capture + transfer done) -----------------------------------
  // Fired after payNotaryOnAccept / completeAct succeeds. Statement to the
  // notary + revenue alert to the operator, at most once per bid.
  // `paye` says whether money actually moved through Nota. On the ADR 0015
  // fallback (no capturable hold — the client paid the notary directly), the
  // act settles but nothing is transferred: the notary must NOT receive a
  // « votre acte est payé » statement for a payment that never happened. The
  // operator alert and the client's evaluation invitation still go out, because
  // the act itself really was signed.
  async function onActPaid({ notaryId, bid, actAmount, paye = true } = {}) {
    if (!bid || !bid.id) return { ok: true, results: [] };
    const results = [];
    try {
      const notary =
        notaryId && typeof repo.getNotary === 'function' ? await repo.getNotary(notaryId) : null;
      const ctx = { ...bidCtx(bid), actAmount };
      if (paye && notary && notary.email) {
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'actPaidNotary',
            to: notary.email,
            templateKey: 'actPaidNotary',
            ctx,
            buildTemplate: (env) => emails.actPaidNotary({ ...ctx, ...env }),
          })
        );
      }
      if (operatorEmail) {
        const opCtx = { ...ctx, notaryEmail: notary && notary.email };
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'operatorActCompleted',
            to: operatorEmail,
            templateKey: 'operatorActCompleted',
            ctx: opCtx,
            buildTemplate: (env) => emails.operatorActCompleted({ ...opCtx, ...env }),
          })
        );
      }
      // The signed act closes the loop for the CLIENT too: invite them to
      // evaluate their notary (ADR 0015 — evaluation follows the settlement).
      if (bid.courriel) {
        const inviteCtx = bidCtx(bid);
        results.push(
          await sendOnce({
            refId: bid.id,
            kind: 'evaluationInvite',
            to: bid.courriel,
            templateKey: 'evaluationInvite',
            ctx: inviteCtx,
            buildTemplate: (env) => emails.evaluationInvite({ ...inviteCtx, ...env }),
          })
        );
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Stripe account lifecycle (notary + client + operator) ----------------
  // Driven from the Stripe webhook route with the verified event, the affected
  // notary, and — for pay-on-accept events — the affected bid. Switches on
  // event type; unknown types produce nothing.
  async function onAccountEvent(event, notary, bid) {
    const type = event && event.type;
    const obj = (event && event.data && event.data.object) || {};
    const email = (notary && notary.email) || obj.customer_email || obj.email || null;
    const refId =
      (notary && notary.id) || (obj.metadata && obj.metadata.notaryId) || (event && event.id) || 'account';
    const results = [];

    // The `kind` used in the SENT ledger doubles as the emails.js registry key
    // for every event handled below, so it also names the admin override.
    async function toNotary(kind, tmpl) {
      const ctx = { email };
      results.push(
        await sendOnce({
          refId,
          kind,
          to: email,
          templateKey: kind,
          ctx,
          buildTemplate: (env) => tmpl({ ...ctx, ...env }),
        })
      );
    }
    async function toOperator(kind, tmpl, extra) {
      if (!operatorEmail) return;
      const ctx = { ...(extra || {}) };
      results.push(
        await sendOnce({
          refId,
          kind,
          to: operatorEmail,
          templateKey: kind,
          ctx,
          buildTemplate: (env) => tmpl({ ...ctx, ...env }),
        })
      );
    }

    try {
      switch (type) {
        // Connect onboarding cleared — the notary can now take requests and be
        // paid. Welcomed at most once ever (the SENT ledger), so later
        // account.updated deliveries never re-send.
        case 'account.updated':
          if (notary && notary.status === 'active') {
            await toNotary('notaryActive', emails.notaryActive);
            await toOperator('operatorNotaryActive', emails.operatorNotaryActive, {
              notaryEmail: email,
              email, // {{email}} token for a subject override
            });
          }
          break;
        // Notary disconnected their payment account from the platform — keep
        // the door open with a win-back (once ever, via the SENT ledger).
        case 'account.application.deauthorized':
          await toNotary('notaryDisconnectedWinback', emails.notaryDisconnectedWinback);
          break;
        // Under the pay-on-accept model, checkout.session.completed is the CLIENT
        // authorizing their offer card (bound in billing.applyEvent). It must NOT
        // trigger a notary subscription welcome/receipt or a "notaire abonné"
        // operator alert — it confirms to the CLIENT that their offer is live.
        case 'checkout.session.completed':
          if (bid && bid.courriel) {
            const ctx = bidCtx(bid);
            results.push(
              await sendOnce({
                refId: bid.id,
                kind: 'offerAuthorized',
                to: bid.courriel,
                templateKey: 'offerAuthorized',
                ctx,
                buildTemplate: (env) => emails.offerAuthorized({ ...ctx, ...env }),
              })
            );
          }
          // ADR 0033 §7 — the hold is authorized: the demand is on the carnet
          // now, so the instant notaries hear of it (idempotent per bid+notary).
          if (bid) results.push(...(await notifyInstantLeads(bid)));
          break;
        // The hold lapsed or was cancelled before any notary accepted — the offer
        // silently dropped off the carnet, so tell the client how to come back.
        case 'checkout.session.expired':
        case 'payment_intent.canceled':
          if (bid && bid.courriel) {
            const ctx = bidCtx(bid);
            results.push(
              await sendOnce({
                refId: bid.id,
                kind: 'offerAuthorizationVoided',
                to: bid.courriel,
                templateKey: 'offerAuthorizationVoided',
                ctx,
                buildTemplate: (env) => emails.offerAuthorizationVoided({ ...ctx, ...env }),
              })
            );
          }
          break;
        // No subscription exists under the commission model, so the legacy
        // invoice.* / customer.subscription.* events are intentionally ignored.
        default:
          break;
      }
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
    return { ok: true, results };
  }

  // --- Notary console sign-in (passwordless magic link) ---------------------
  // Fired from POST /notary/session/request (fire-and-forget). Emails the
  // single-use sign-in link on the shared branded template. Unlike every other
  // notifier this bypasses sendOnce: an auth link is TRANSACTIONAL — it must
  // resend on each request (a fresh single-use link every time) and must never
  // be suppressed by an unsubscribe or a dedupe ledger. Best-effort: a mail
  // failure must never break the request response (which stays generic anyway).
  async function onNotaryLoginRequested({ email, link, ttlMinutes } = {}) {
    const to = String(email || '').trim().toLowerCase();
    if (!to || !link) return { ok: true, sent: false };
    try {
      const unsub = unsubscribeUrl(to);
      const msg = emails.notaryMagicLink({
        link,
        ttlMinutes,
        baseUrl: base,
        unsubscribeUrl: unsub,
      });
      await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl: unsub });
      return { ok: true, sent: true, to };
    } catch (err) {
      return { ok: false, sent: false, error: String((err && err.message) || err) };
    }
  }

  // --- Partner code claim (email verification, ADR 0011 fraud-hardening) -----
  // Fired from POST /partenaires (fire-and-forget). Emails the single-use
  // confirmation link on the shared branded template. Like the notary magic link
  // this bypasses sendOnce: a verification link is TRANSACTIONAL — it must resend
  // on each request (a fresh single-use link every time) and must never be
  // suppressed by an unsubscribe or a dedupe ledger. Best-effort: a mail failure
  // must never break the request response (which stays generic anyway).
  async function onPartnerClaimRequested({ email, link, code, ttlMinutes } = {}) {
    const to = String(email || '').trim().toLowerCase();
    if (!to || !link) return { ok: true, sent: false };
    try {
      const unsub = unsubscribeUrl(to);
      const msg = emails.partnerClaimLink({
        link,
        code,
        ttlMinutes,
        baseUrl: base,
        unsubscribeUrl: unsub,
      });
      await mailer.send({ to, subject: msg.subject, html: msg.html, text: msg.text, unsubscribeUrl: unsub });
      return { ok: true, sent: true, to };
    } catch (err) {
      return { ok: false, sent: false, error: String((err && err.message) || err) };
    }
  }

  // Record an opt-out (used by GET /unsubscribe).
  async function unsubscribe(email) {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean) return { ok: false };
    await repo.putUnsubscribe(clean, clock());
    return { ok: true, email: clean };
  }

  // --- Free notary signup (2026-09-02) --------------------------------------
  // Fired from POST /notaries/signup (fire-and-forget) while the file is still
  // waiting for the operator. Two messages, once per address each (the SENT
  // ledger): the notary is told the vetting sequence — no payout talk at the
  // door — and the operator is pointed at the admin console's Notaires screen
  // (`adminUrl`), where the activation button lives.
  async function onNotarySignedUp({ email, lienCNQ } = {}) {
    const to = String(email || '').trim().toLowerCase();
    if (!to) return { ok: true, results: [] };
    const results = [];
    try {
      const ctx = { email: to, lienCNQ: lienCNQ || null };
      results.push(
        await sendOnce({
          refId: to,
          kind: 'notaryPendingReview',
          to,
          templateKey: 'notaryPendingReview',
          ctx,
          buildTemplate: (env) => emails.notaryPendingReview({ ...ctx, ...env }),
        })
      );
      if (operatorEmail) {
        const opCtx = { ...ctx, notaryEmail: to, adminUrl: adminUrl || null };
        results.push(
          await sendOnce({
            refId: to,
            kind: 'operatorNotarySignedUp',
            to: operatorEmail,
            templateKey: 'operatorNotarySignedUp',
            ctx: opCtx,
            buildTemplate: (env) => emails.operatorNotarySignedUp({ ...opCtx, ...env }),
          })
        );
      }
      return { ok: true, results };
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), results };
    }
  }

  return {
    onOfferCreated,
    onOfferRetained,
    onPartnerClaimRequested,
    onPartnerRegistered,
    onCounterOfferProposed,
    onDocumentsRequested,
    onCounterOfferAnswered,
    onOfferCancelled,
    onActReleased,
    onContactMessage,
    onSupportMessage,
    onSupportReply,
    onClientSignup,
    onChatMessage,
    onChatDocument,
    onEvaluationSubmitted,
    onReminderDue,
    onNotaryDigest,
    onNotaryConnected,
    onNotarySignedUp,
    onNotaryLoginRequested,
    onActPaid,
    onAccountEvent,
    sendCampaign,
    unsubscribe,
    unsubscribeUrl,
  };
}

module.exports = { createNotifier, encodeUnsubToken, decodeUnsubToken };
