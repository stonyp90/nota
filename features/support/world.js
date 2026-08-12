'use strict';

const { setWorldConstructor, World } = require('@cucumber/cucumber');

// The system under test. Imported by relative path from the monorepo — the
// domain is pure CommonJS/UMD, the API app is transport-agnostic.
const domain = require('../../packages/domain/index.js');
const { createApp } = require('../../apps/api/src/handler.js');
const { createMemoryRepo } = require('../../apps/api/src/repo-memory.js');

// Frozen clock so every scenario is deterministic (matches the task spec).
const TODAY = '2026-08-12';

class NotaWorld extends World {
  constructor(options) {
    super(options);
    this.domain = domain;
    this.today = TODAY;
    // Fresh in-memory repo + app per scenario.
    let seq = 0;
    this.repo = createMemoryRepo([]);
    this.app = createApp(this.repo, {
      now: () => TODAY,
      newId: () => 'bid-' + ++seq,
    });
    // Scratch state shared between steps of one scenario.
    this.input = {};
    this.result = null;
    this.response = null;
  }

  async request(req) {
    this.response = await this.app.handle(req);
    return this.response;
  }

  get responseJson() {
    return JSON.parse(this.response.body);
  }
}

setWorldConstructor(NotaWorld);
