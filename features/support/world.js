'use strict';

const { setWorldConstructor, World } = require('@cucumber/cucumber');

// The system under test. Imported by relative path from the monorepo — the
// domain is pure CommonJS/UMD, the API app is transport-agnostic.
const domain = require('../../packages/domain/index.js');
const { createApp } = require('../../apps/api/src/handler.js');
// La console d'administration — une Lambda distincte, son propre transport.
const { createAdminApp } = require('../../apps/api/src/admin-handler.js');
const { createAdmin } = require('../../apps/api/src/admin.js');
const { createMemoryRepo } = require('../../apps/api/src/repo-memory.js');
const { createNotifier } = require('../../apps/api/src/notifications.js');
const { createFakeMailer } = require('../../apps/api/src/notify-port.js');
const { createFakeSms } = require('../../apps/api/src/sms-port.js');
const { runReminders: runRemindersUseCase } = require('../../apps/api/src/reminders.js');
const { createBilling } = require('../../apps/api/src/billing.js');

// Frozen clock so every scenario is deterministic (matches the task spec).
const TODAY = '2026-08-12';
const BASE = 'https://nota.example';
const OPERATOR_EMAIL = 'operateur@nota.ca';
// L'origine de la console d'administration (CORS + lien magique).
const ADMIN_BASE = 'https://admin.nota.example';
// Le prénom que l'assistant nomme quand il passe la main (ADR 0046).
const OPERATOR_NAME = 'Anthony';

class NotaWorld extends World {
  constructor(options) {
    super(options);
    this.domain = domain;
    this.today = TODAY;
    // L'horloge en MILLISECONDES, gelée comme la date et AVANÇABLE à la main.
    // La continuité d'une séance de signature se mesure en secondes (ADR 0047),
    // et une suite qui dort vraiment dix secondes ne se relit pas.
    this.nowMs = Date.parse(TODAY + 'T14:00:00.000Z');
    this.baseUrl = BASE;
    this.operatorEmail = OPERATOR_EMAIL;

    // Fresh in-memory repo + app per scenario.
    let seq = 0;
    this.repo = createMemoryRepo([]);

    // Fake mailer captures every outbound message on `.sent` so a scenario can
    // assert exactly who was mailed and with which template — no SES, no network.
    this.mailer = createFakeMailer();
    // ADR 0051 — the fake SMS port captures every text on `.sent`, so a
    // scenario can assert that a consented client is texted, and that a
    // silent one never is. No SNS, no carrier.
    this.sms = createFakeSms();

    // The real notifier, wired to the fake mailer and the fake SMS port. This
    // is the same use-case object the handler builds in production and the
    // reminder scheduler drives; only the ports (and the clock) are fakes.
    this.notifier = createNotifier({
      repo: this.repo,
      mailer: this.mailer,
      sms: this.sms,
      baseUrl: BASE,
      operatorEmail: OPERATOR_EMAIL,
      now: () => TODAY,
    });

    // Fake billing so the Stripe webhook route needs neither the SDK nor a real
    // signature: it turns the raw body into a verified event + affected notary,
    // exactly the shape the handler expects from the real adapter.
    this.billing = {
      async handleWebhook(raw, _signature) {
        let event;
        try {
          event = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {};
        } catch {
          return { ok: false };
        }
        const obj = (event && event.data && event.data.object) || {};
        const email = obj.customer_email || obj.email || null;
        const notary = { id: obj.client_reference_id || event.id || 'notary', email };
        return { ok: true, event, notary, duplicate: false };
      },
      async startSubscription({ email } = {}) {
        return { ok: true, url: BASE + '/checkout?email=' + encodeURIComponent(email || '') };
      },
    };

    // A no-SDK, no-network Stripe recorder for the money scenarios: every
    // authorization, capture (full or partial), transfer and hold release is
    // pushed onto `.calls` so a step can assert exactly what moved. Inert
    // until a scenario turns billing on (see `enableBilling`).
    this.stripe = {
      calls: { authorizations: [], setups: [], holds: [], transfers: [], cancels: [], feeCaptures: [], feeTransfers: [], offSessionFees: [], commissions: [] },
    };
    const calls = this.stripe.calls;
    Object.assign(this.stripe, {
      async createOfferAuthorization(args) { calls.authorizations.push(args); return { sessionId: 'cs_' + args.bidId, url: BASE + '/checkout/' + args.bidId }; },
      // ADR 0035 — la carte s'ENREGISTRE à la publication quand la date est
      // hors de la fenêtre de caution ; la caution se pose J-2, hors session.
      async createOfferSetup(args) { calls.setups.push(args); return { sessionId: 'cs_setup_' + args.bidId, url: BASE + '/setup/' + args.bidId }; },
      async placeOfferAuthorization(args) { calls.holds.push(args); return { paymentIntentId: 'pi_' + args.bidId, status: 'requires_capture' }; },
      async captureAndTransfer(args) { calls.transfers.push(args); return { paymentIntentId: args.paymentIntentId, chargeId: 'ch_' + args.bidId, transferId: 'tr_' + args.bidId, applicationFeeCents: args.applicationFeeCents, netCents: args.amountCents - args.applicationFeeCents }; },
      // ADR 0033 — the cancellation fee is captured, then TRANSFERRED whole to
      // the retaining notary when a connected account is named; `feeTransfers`
      // records that leg so a scenario can prove Nota kept nothing.
      async captureCancellationFee(args) {
        calls.feeCaptures.push(args);
        const chargeId = 'chfee_' + args.bidId;
        if (!args.connectAccountId) return { paymentIntentId: args.paymentIntentId, chargeId, transferId: null };
        calls.feeTransfers.push({ bidId: args.bidId, amountCents: args.amountCents, connectAccountId: args.connectAccountId, chargeId });
        return { paymentIntentId: args.paymentIntentId, chargeId, transferId: 'trfee_' + args.bidId };
      },
      // ADR 0035 — les mêmes frais, prélevés hors session quand aucune caution
      // n'est encore posée. Le virement au notaire est identique : entier.
      async chargeCancellationFeeOffSession(args) {
        calls.offSessionFees.push(args);
        const chargeId = 'chhs_' + args.bidId;
        if (!args.connectAccountId) return { paymentIntentId: 'pi_fee_' + args.bidId, chargeId, transferId: null };
        calls.feeTransfers.push({ bidId: args.bidId, amountCents: args.amountCents, connectAccountId: args.connectAccountId, chargeId });
        return { paymentIntentId: 'pi_fee_' + args.bidId, chargeId, transferId: 'trfee_' + args.bidId };
      },
      async cancelOfferAuthorization(args) { calls.cancels.push(args); return { id: args.paymentIntentId, status: 'canceled' }; },
      async chargeActCommission(args) { calls.commissions.push(args); return { id: 'pi_' + (args.bidId || 'x'), applicationFeeCents: args.applicationFeeCents }; },
      constructEvent(rawBody) { return JSON.parse(rawBody || '{}'); },
    });

    const buildApp = () => createApp(this.repo, {
      now: () => TODAY,
      // Lue à CHAQUE appel, pour qu'un scénario qui avance l'horloge soit vu
      // par l'application déjà construite.
      nowMs: () => this.nowMs,
      newId: () => 'bid-' + ++seq,
      notifier: this.notifier,
      billing: this.billing,
      // The default fake billing exists only to serve the Stripe webhook
      // route; most suites document the pre-billing offer flow (offers go
      // live the instant they are posted), so pay-on-accept stays off unless
      // a scenario says « la facturation Stripe est configurée ».
      billingConfigured: this.billingOn === true,
      // The live-chat reply link points back at the site (ADR 0026).
      supportUrl: BASE,
      // Le chemin PAYANT exige une origine de retour : sans elle, Stripe n'a
      // pas où renvoyer le client, et `POST /bids` refuse franchement plutôt
      // que de créer une offre dont le paiement ne pourra jamais aboutir.
      siteUrl: BASE,
      // ADR 0046 — l'assistant de la messagerie. Nul par défaut : la
      // messagerie se comporte alors comme un déploiement sans clé, et chaque
      // question part à l'opérateur. Un scénario le branche explicitement.
      ...(this.assistantPort ? { assistantPort: this.assistantPort } : {}),
      env: {
        ...process.env,
        NOTA_OPERATOR_EMAIL: OPERATOR_EMAIL,
        // Le prénom que l'assistant nomme en passant la main.
        NOTA_OPERATOR_NAME: OPERATOR_NAME,
        // ADR 0047 — le seul fournisseur de signature admissible tant qu'aucun
        // flux reconnu par la Chambre n'est branché : il scelle un procès-verbal
        // et ne délivre AUCUNE minute, et il le dit.
        NOTA_SIGNATURE_FOURNISSEUR: 'demonstration',
      },
    });

    this.billingOn = false;
    this.assistantPort = null;
    this.app = buildApp();

    // --- LA CONSOLE D'ADMINISTRATION ----------------------------------------
    // Une SECONDE application, celle de la Lambda admin.nota.ca : le même
    // dépôt en mémoire, le même faux postier et la même horloge avançable que
    // l'API publique — seul le transport change. Les scénarios d'accès
    // traversent donc le vrai `admin-handler.js`, le vrai use-case `admin.js`
    // et le vrai `rbac.js` ; rien n'est simulé, pas même la session.
    //
    // La liste blanche est la porte EXTÉRIEURE (seule une adresse inscrite
    // peut demander un lien) : elle est laissée VIDE ici pour que ce soit le
    // scénario, et non le World, qui nomme ses opérateurs. Un pas y inscrit
    // une adresse puis rappelle `buildAdminApp()` — tout l'état (comptes,
    // sessions, journal) vit dans le dépôt et survit à la reconstruction.
    this.adminBaseUrl = ADMIN_BASE;
    this.adminAllowlist = [];
    let adminSeq = 0;
    this.buildAdminApp = () => {
      this.adminApp = createAdminApp(this.repo, {
        admin: createAdmin({
          repo: this.repo,
          mailer: this.mailer,
          notifier: this.notifier,
          newId: () => 'adm-' + ++adminSeq,
          now: () => new Date(this.nowMs).toISOString(),
          nowMs: () => this.nowMs,
          config: {
            allowlist: this.adminAllowlist.slice(),
            baseUrl: ADMIN_BASE,
            siteUrl: BASE,
            // Hors production : le lien magique revient dans la réponse, seule
            // façon de traverser l'échange sans vraie boîte aux lettres.
            devEcho: true,
            // Un scénario ouvre plusieurs sessions d'affilée depuis la même IP ;
            // le plafond anti-abus (5) n'est pas le sujet mesuré ici.
            rlMax: 100,
          },
        }),
        adminBaseUrl: ADMIN_BASE,
        now: () => TODAY,
        nowMs: () => this.nowMs,
      });
      return this.adminApp;
    };
    this.buildAdminApp();

    // ADR 0046 — brancher l'assistant sur un scénario en mémoire. Aucun SDK,
    // aucun réseau : le scénario DICTE ce que le modèle répond, et ce qu'on
    // observe est ce que le reste du système en fait.
    this.enableAssistant = (scenario) => {
      if (scenario === null) {
        // L'état d'un déploiement SANS clé : aucun port, donc aucune réponse
        // automatique et chaque question part à l'opérateur.
        this.assistantPort = null;
      } else {
        const { createFakeAssistant } = require('../../apps/api/src/assistant-port.js');
        this.assistantPort = createFakeAssistant(scenario);
      }
      this.app = buildApp();
      return this.assistantPort;
    };

    // Money scenarios (ADR 0015/0023) run the REAL billing use-cases over the
    // Stripe recorder above — only the network is fake. The app is rebuilt on
    // the same repo/notifier, so anything already seeded survives the switch.
    this.enableBilling = () => {
      this.billingOn = true;
      this.billing = createBilling({ repo: this.repo, stripe: this.stripe, now: () => TODAY });
      this.app = buildApp();
    };

    // Scratch state shared between steps of one scenario.
    this.input = {};
    this.result = null;
    this.response = null;
    this.adminResponse = null;
    this.lastBidId = null;
  }

  async request(req) {
    this.response = await this.app.handle(req);
    // The handler fires notifications fire-and-forget (never awaited) so a mail
    // failure can never block the HTTP response. Drain the microtask/timer
    // queues so a following step observes what was captured.
    await this.flush();
    return this.response;
  }

  // Le miroir de `request`, côté console d'administration. La réponse est
  // rangée à part (`adminResponse`) pour qu'un scénario puisse comparer les
  // deux surfaces sans que l'une écrase l'autre.
  async requestAdmin(req) {
    this.adminResponse = await this.adminApp.handle(req);
    await this.flush();
    return this.adminResponse;
  }

  // Let any fire-and-forget notification promise settle before assertions run.
  async flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Drive the daily reminder scheduler over the current repo with the same
  // notifier + frozen clock.
  // ADR 0035 — le lot quotidien porte aussi le geste d'argent : poser la
  // caution des offres qui entrent dans la fenêtre. Le port de facturation ne
  // lui est passé que lorsqu'un scénario l'a branché (`enableBilling`), comme
  // en production sans clés Stripe.
  async runReminders() {
    return runRemindersUseCase({
      repo: this.repo,
      notifier: this.notifier,
      billing: this.billingOn ? this.billing : null,
      now: () => TODAY,
    });
  }

  get responseJson() {
    return JSON.parse(this.response.body);
  }

  get adminResponseJson() {
    return JSON.parse(this.adminResponse.body);
  }

  // Every captured message sent to a given recipient.
  mailsTo(to) {
    return this.mailer.sent.filter((m) => m.to === to);
  }
}

setWorldConstructor(NotaWorld);
