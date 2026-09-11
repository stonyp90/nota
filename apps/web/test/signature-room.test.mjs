import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';

const source = name => readFileSync(new URL(name, import.meta.url), 'utf8');
const html = source('../public/signature.html');
const favicon = source('../public/favicon.svg');
const script = source('../public/signature.js');
const domain = source('../../../packages/domain/signing.js');
const wait = () => new Promise(resolve => setTimeout(resolve, 30));
async function boot(t, options = {}) {
  const calls = [], media = [];
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true,
    url: (options.origin || 'https://nota.example') + '/signature.html' + (options.query || ''),
    beforeParse(w) {
      Object.defineProperty(w, 'isSecureContext', { value: true });
      Object.defineProperty(w, 'crypto', { value: webcrypto });
      w.TextEncoder = TextEncoder;
      w.RTCPeerConnection = class {};
      w.HTMLMediaElement.prototype.play = () => Promise.resolve();
      w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
      Object.defineProperty(w.navigator, 'mediaDevices', { value: {
        getUserMedia: async constraints => {
          const tracks = ['audio', 'video'].map(kind => { const track = new w.EventTarget(); Object.assign(track, { kind, enabled: true, muted: false, readyState: 'live', stopped: false,
            stop() { this.stopped = true; this.readyState = 'ended'; } }); return track; });
          const stream = { getTracks: () => tracks, getAudioTracks: () => tracks.filter(t => t.kind === 'audio'), getVideoTracks: () => tracks.filter(t => t.kind === 'video') };
          media.push({ constraints, tracks, stream }); return stream;
        }
      } });
      if (options.notaryToken) w.localStorage.setItem('nota.notary.token', JSON.stringify(options.notaryToken));
      if (options.offers) w.localStorage.setItem('nota.myoffers.v1', JSON.stringify(options.offers));
      w.fetch = async (url, opts = {}) => { calls.push({ url: String(url), ...opts }); return options.fetch ? options.fetch(String(url), opts) : { ok: true, status: 200, json: async () => ({ role: 'notary', capabilities: { enabled: true }, session: null, iceServers: [] }) }; };
    }
  });
  t.after(() => dom.window.close());
  let testHooks = options.gatheringHook ? '  window.__testGathered = gathered;\n' : '';
  if (options.connectionHook) testHooks += `
    window.__testConnection = {
      configure: function (value) {
        session = value.session; pc = value.pc; entered = true; localStream = {};
        verifySignal = async function () {};
        makePeer = function () { if (!pc) pc = value.makePeer(); return pc; };
      },
      advance: advanceConnection,
      signal: function (value) { session.peerSignal = value; }
    };
  `;
  dom.window.eval(domain); dom.window.eval(testHooks ? script.replace('  init();', testHooks + '  init();') : script); await wait();
  return { w: dom.window, doc: dom.window.document, calls, media };
}
function change(w, id, checked = true) { const el = w.document.getElementById(id); el.checked = checked; el.dispatchEvent(new w.Event('change', { bubbles: true })); }

test('public beta is explicit, makes no authenticated requests and does not start media', async t => {
  const { doc, calls, media } = await boot(t);
  assert.equal(doc.getElementById('welcome').hidden, false);
  assert.equal(doc.getElementById('workspace').hidden, true);
  assert.equal(calls.length, 0);
  assert.equal(media.length, 0);
  assert.match(doc.querySelector('.beta-note').textContent, /Répétition technique disponible/);
  assert.match(doc.querySelector('.principles').textContent, /ne représente pas une approbation/);
  assert.equal(doc.querySelectorAll('script:not([src])').length, 0, 'CSP needs no inline executable scripts');
  assert.equal(doc.querySelectorAll('script[src^="http"]').length, 0, 'No third-party scripts');
});

test('every signing entry point uses the shared Nota favicon mark', () => {
  assert.match(html, /class="brand-mark" src="favicon\.svg"/, 'header uses the shared mark');
  assert.match(html, /class="video-brand"><img src="favicon\.svg"/, 'video surface uses the shared mark');
  assert.match(html, /class="paper-brand"><img src="favicon\.svg"/, 'document preview uses the shared mark');
  assert.match(html, /class="footer-brand"><img src="favicon\.svg"/, 'footer uses the shared mark');
  assert.match(favicon, /#264961/i, 'favicon carries the Nota deep-teal square');
  assert.match(favicon, /#407598/i, 'favicon carries the Nota cyan signal dot');
  assert.match(favicon, /#101b26/i, 'favicon carries the Nota dark-ink outline');
  assert.doesNotMatch(favicon, /#315b43|#599a71|#2c5f34|#50b848/i, 'favicon has no legacy green mark');
});

test('all canonical static interface strings have English translations', async t => {
  const { doc } = await boot(t, { query: '?lang=en' });
  assert.equal(doc.documentElement.lang, 'en-CA');
  const unconverted = [...doc.querySelectorAll('[data-i18n]')].filter(el => el.textContent === el.dataset.i18n && !['Document', 'Pause'].includes(el.dataset.i18n));
  assert.deepEqual(unconverted.map(el => el.dataset.i18n), []);
  assert.match(doc.querySelector('.beta-note').textContent, /Technical rehearsal/);
});

test('private preview uses explicit permission and closes all media tracks', async t => {
  const { doc, media } = await boot(t);
  doc.getElementById('public-camera-test').click(); await wait();
  assert.equal(media.length, 1); assert.equal(doc.getElementById('camera-dialog').open, true);
  assert.equal(media[0].tracks.every(track => !track.stopped), true);
  doc.getElementById('close-camera-dialog').click(); await wait();
  assert.equal(media[0].tracks.every(track => track.stopped), true);
  assert.equal(doc.getElementById('test-video').srcObject, null);
});

test('notary auth parses the existing JSON token without putting it in URLs', async t => {
  const { doc, calls, w } = await boot(t, { query: '?bidId=retained-1&dateISO=2026-09-18&role=notary', notaryToken: 'private-notary-token' });
  assert.equal(doc.getElementById('workspace').hidden, false);
  assert.match(calls[0].url, /sessions\?bidId=retained-1&dateISO=2026-09-18/);
  assert.equal(calls[0].headers.authorization, 'Bearer private-notary-token');
  assert.ok(calls.every(call => !call.url.includes('private-notary-token')));
  assert.equal(doc.getElementById('join-button').disabled, true);
  doc.getElementById('camera-test').click(); await wait();
  assert.equal(doc.getElementById('join-button').disabled, true, 'camera does not bypass rehearsal consent');
  change(w, 'beta-consent');
  assert.equal(doc.getElementById('join-button').disabled, false);
  assert.equal(doc.getElementById('sign-button').disabled, true);
});

test('customer access is scoped to the matching bid AND date in their offers', async t => {
  const { calls, doc } = await boot(t, { query: '?bidId=retained-1&dateISO=2026-09-18&role=client', offers: [{ id: 'retained-1', dateISO: '2026-09-19', clientToken: 'other-day' }] });
  assert.equal(calls.length, 0); assert.equal(doc.getElementById('welcome').hidden, false);
  assert.match(doc.getElementById('welcome-auth').textContent, /Reconnectez-vous/);
});

test('reauth-required responses fail closed and preserve tokenless return context', async t => {
  const { w, doc } = await boot(t, { query: '?bidId=retained-1&dateISO=2026-09-18&role=notary', notaryToken: 'old-session', fetch: async () => ({ ok: false, status: 401, json: async () => ({ errors: [{ code: 'reauth_required' }] }) }) });
  assert.equal(doc.getElementById('workspace').hidden, true);
  assert.match(doc.getElementById('notice').textContent, /nouvelle connexion par courriel/);
  doc.getElementById('signin-link').addEventListener('click', event => event.preventDefault());
  doc.getElementById('signin-link').click();
  const context = JSON.parse(w.localStorage.getItem('nota.signing.return'));
  assert.equal(context.path, '/signature.html?bidId=retained-1&dateISO=2026-09-18&role=notary');
  assert.equal(typeof context.createdAt, 'number');
  assert.ok(!JSON.stringify(context).includes('old-session'));
});

test('received document is displayed as text and mismatched bytes cannot be signed', async t => {
  const text = '<img src=x onerror=alert(1)>Not the authorized rehearsal document';
  const { doc } = await boot(t, { query: '?bidId=retained-1&dateISO=2026-09-18&role=notary', notaryToken: 'test-token', fetch: async () => ({ ok: true, status: 200, json: async () => ({ role: 'notary', capabilities: { enabled: true }, iceServers: [], session: {
    id: 'session-1', revision: 1, status: 'released', expiresAt: Date.now() + 100000,
    document: { text, title: 'Test', sha256: createHash('sha256').update(text).digest('hex') },
    participants: { notary: { joined: true, name: 'Me Test', acknowledged: false }, client: { joined: true, name: 'Test', acknowledged: false } }, peerSignal: null
  } }) }) });
  assert.equal(doc.getElementById('document-body').textContent, text);
  assert.equal(doc.getElementById('document-body').querySelector('img'), null);
  assert.match(doc.getElementById('document-integrity').textContent, /ne correspond pas/);
  assert.equal(doc.getElementById('sign-button').disabled, true);
  assert.equal(doc.getElementById('release-button').disabled, true);
});

function fakeGathering(w, { candidate, policy = 'relay', complete = false } = {}) {
  const rtc = new w.EventTarget();
  rtc.iceGatheringState = complete ? 'complete' : 'gathering';
  rtc.signalingState = 'have-local-offer';
  rtc.getConfiguration = () => ({ iceTransportPolicy: policy });
  rtc.localDescription = { type: 'offer', sdp: 'v=0\r\n' + (candidate ? 'a=candidate:1 1 udp 100 192.0.2.15 49152 typ ' + candidate + '\r\n' : '') };
  return rtc;
}

test('TURN gathering deadline accepts an available relay and returns an immutable exact SDP snapshot', async t => {
  const { w } = await boot(t, { gatheringHook: true });
  let deadline;
  w.setTimeout = callback => { deadline = callback; return 77; };
  w.clearTimeout = () => {};
  const rtc = fakeGathering(w, { candidate: 'relay' });
  const result = w.__testGathered(rtc);
  const expected = rtc.localDescription.sdp;
  deadline();
  const snapshot = await result;
  rtc.localDescription = { type: 'offer', sdp: expected + 'a=candidate:2 1 tcp 100 192.0.2.15 49153 typ relay\r\n' };
  assert.equal(snapshot.sdp, expected, 'later candidates cannot alter the SDP that will be signed');
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(rtc.iceGatheringState, 'gathering', 'remaining transports are not forcibly stopped');
});

test('TURN gathering deadline rejects a host-only candidate and no-candidate SDP', async t => {
  const { w } = await boot(t, { gatheringHook: true });
  let deadline;
  w.setTimeout = callback => { deadline = callback; return 78; };
  w.clearTimeout = () => {};
  for (const candidate of ['host', undefined]) {
    const result = w.__testGathered(fakeGathering(w, { candidate }));
    deadline();
    await assert.rejects(result, /ice_timeout/);
  }
});

test('production gathering never falls back to a direct candidate even with an all policy', async t => {
  const { w } = await boot(t, { gatheringHook: true });
  await assert.rejects(w.__testGathered(fakeGathering(w, { candidate: 'host', policy: 'all', complete: true })), /ice_timeout/);
});

test('local rehearsal gathering can finish with a direct candidate when relay policy is not required', async t => {
  const { w } = await boot(t, { gatheringHook: true, origin: 'http://localhost:4173' });
  const rtc = fakeGathering(w, { candidate: 'host', policy: 'all', complete: true });
  const result = await w.__testGathered(rtc);
  assert.equal(result.sdp, rtc.localDescription.sdp);
});

function failedHandshakePeer(counters) {
  return {
    remoteDescription: null,
    localDescription: null,
    connectionState: 'new',
    close() { counters.closed++; },
    async setRemoteDescription(description) { counters.remote++; this.remoteDescription = description; },
    async createAnswer() { counters.answers++; return { type: 'answer', sdp: 'v=0\r\n' }; },
    async createOffer() { counters.offers++; return { type: 'offer', sdp: 'v=0\r\n' }; },
    async setLocalDescription() { throw new Error('Synthetic handshake failure'); }
  };
}

test('failed client answer consumes the offer sequence and retries only a newer offer', async t => {
  const { w } = await boot(t, { connectionHook: true });
  const counters = { remote: 0, answers: 0, offers: 0, closed: 0, created: 0 };
  const peer = failedHandshakePeer(counters);
  w.__testConnection.configure({
    pc: peer, makePeer() { counters.created++; return failedHandshakePeer(counters); },
    session: { id: 'session-retry', status: 'admitted', peerSignal: { seq: 12, type: 'offer', sdp: 'v=0\r\n' } }
  });
  await w.__testConnection.advance();
  await w.__testConnection.advance();
  await w.__testConnection.advance();
  assert.equal(counters.answers, 1, 'polling must not replay the failed answer');
  assert.equal(counters.created, 0, 'polling must not create extra TURN allocations');
  assert.equal(counters.closed, 0);
  w.__testConnection.signal({ seq: 13, type: 'offer', sdp: 'v=0\r\n' });
  await w.__testConnection.advance();
  await w.__testConnection.advance();
  assert.equal(counters.answers, 2, 'a newer notary offer permits exactly one new attempt');
  assert.equal(counters.created, 1);
  assert.equal(counters.closed, 1);
  w.__testConnection.signal({ seq: 12, type: 'offer', sdp: 'v=0\r\n' });
  await w.__testConnection.advance();
  assert.equal(counters.answers, 2, 'stale polling responses cannot replay an older offer');
});

test('failed notary offer remains attempted until an explicit reconnect', async t => {
  const { w } = await boot(t, { connectionHook: true, query: '?role=notary' });
  const counters = { remote: 0, answers: 0, offers: 0, closed: 0, created: 0 };
  w.__testConnection.configure({ pc: failedHandshakePeer(counters),
    makePeer() { counters.created++; return failedHandshakePeer(counters); },
    session: { id: 'session-retry', status: 'admitted', peerSignal: null }
  });
  await w.__testConnection.advance();
  await w.__testConnection.advance();
  await w.__testConnection.advance();
  assert.equal(counters.offers, 1);
  assert.equal(counters.created, 0);
});
