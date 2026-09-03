import { createRequire } from 'node:module';

// ESM twin of ./notary-fixture.js (the CommonJS source of truth, shared with
// the Cucumber steps). See that file for what the block means.
const require = createRequire(import.meta.url);
const fixture = require('./notary-fixture.js');

export const NOTARY_CONTACT = fixture.NOTARY_CONTACT;
export const activeNotary = fixture.activeNotary;
