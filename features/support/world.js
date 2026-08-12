'use strict';

const { setWorldConstructor, World } = require('@cucumber/cucumber');

// The system under test. Imported by relative path from the monorepo — the
// domain is pure CommonJS/UMD, the API app is transport-agnostic.
const domain = require('../../packages/domain/index.js');
const { createApp } = require('../../apps/api/src/handler.js');
const { createMemoryRepo } = require('../../apps/api/src/repo-memory.js');
const { createNotifier } = require('../../apps/api/src/notifications.js');
const { createFakeMailer } = require('../../apps/api/src/notify-port.js');
const { runReminders: runRemindersUseCase } = require('../../apps/api/src/reminders.js');

// Frozen clock so every scenario is deterministic (matches the task spec).
const TODAY = '2026-08-12';
const BASE = 'https://nota.example';
const OPERATOR_EMAIL = 'operateur@nota.ca';

class NotaWorld extends World {
  constructor(options) {
    super(options);
    this.domain = domain;
    this.today = TODAY;
    this.baseUrl = BASE;
    this.operatorEmail = OPERATOR_EMAIL;

    // Fresh in-memory repo + app per scenario.
    let seq = 0;
    this.repo = createMemoryRepo([]);

    // Fake mailer captures every outbound message on `.sent` so a scenario can
    // assert exactly who was mailed and with which template — no SES, no network.
    this.mailer = createFakeMailer();

    // The real notifier, wired to the fake mailer. This is the same use-case
    // object the handler builds in production and the reminder scheduler drives;
    // only the mailer (and the clock) are fakes.
    this.notifier = createNotifier({
      repo: this.repo,
      mailer: this.mailer,
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

    this.app = createApp(this.repo, {
      now: () => TODAY,
      newId: () => 'bid-' + ++seq,
      notifier: this.notifier,
      billing: this.billing,
    });

    // Scratch state shared between steps of one scenario.
    this.input = {};
    this.result = null;
    this.response = null;
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

  // Let any fire-and-forget notification promise settle before assertions run.
  async flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

  // Drive the daily reminder scheduler over the current repo with the same
  // notifier + frozen clock.
  async runReminders() {
    return runRemindersUseCase({ repo: this.repo, notifier: this.notifier, now: () => TODAY });
  }

  get responseJson() {
    return JSON.parse(this.response.body);
  }

  // Every captured message sent to a given recipient.
  mailsTo(to) {
    return this.mailer.sent.filter((m) => m.to === to);
  }
}

setWorldConstructor(NotaWorld);
