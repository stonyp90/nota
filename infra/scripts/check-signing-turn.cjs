#!/usr/bin/env node
// Real browser ICE/DTLS data-channel check. Credentials stay in process memory.
const { chromium } = require('playwright');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { createHmac, randomBytes } = require('node:crypto');

(async () => {
  const ssm = new SSMClient({ region: 'ca-central-1' });
  const { Parameter } = await ssm.send(new GetParameterCommand({
    Name: '/nota/production/signing/turn-secret', WithDecryption: true,
  }));
  const auth = role => {
    const username = `${Math.floor(Date.now() / 1000) + 1800}:transport-check:${role}:${randomBytes(6).toString('hex')}`;
    return { username, credential: createHmac('sha1', Parameter.Value).update(username).digest('base64') };
  };
  const browser = await chromium.launch({ headless: true });
  try {
    const defaults = [
      'turn:turn.gonota.ca:3478?transport=udp',
      'turn:turn.gonota.ca:3478?transport=tcp',
      'turns:turn.gonota.ca:443?transport=tcp',
    ];
    for (const url of (process.argv.length > 2 ? process.argv.slice(2) : defaults)) {
      const page = await browser.newPage();
      const result = await page.evaluate(async ({ url, leftAuth, rightAuth }) => {
        const config = identity => ({ iceTransportPolicy: 'relay', iceServers: [{ urls: url, ...identity }] });
        const left = new RTCPeerConnection(config(leftAuth)), right = new RTCPeerConnection(config(rightAuth));
        const wait = (promise, ms, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms))]);
        const gather = pc => pc.iceGatheringState === 'complete' ? Promise.resolve() : wait(new Promise(resolve => {
          pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') resolve(); });
        }), 20000, 'ICE gathering timeout');
        try {
          const sent = 'nota-real-relay-transport-check';
          const received = new Promise(resolve => { right.ondatachannel = event => { event.channel.onmessage = message => resolve(message.data); }; });
          const channel = left.createDataChannel('transport-check');
          const opened = new Promise(resolve => { channel.onopen = resolve; });
          await left.setLocalDescription(await left.createOffer()); await gather(left);
          await right.setRemoteDescription(left.localDescription);
          await right.setLocalDescription(await right.createAnswer()); await gather(right);
          await left.setRemoteDescription(right.localDescription);
          await wait(opened, 20000, 'DTLS data channel timeout');
          channel.send(sent);
          if (await wait(received, 5000, 'Peer payload timeout') !== sent) throw new Error('Peer payload mismatch');
          const stats = await left.getStats();
          const transport = [...stats.values()].find(value => value.type === 'transport' && value.selectedCandidatePairId);
          const pair = transport && stats.get(transport.selectedCandidatePairId);
          if (!pair) throw new Error('No selected candidate pair');
          const local = stats.get(pair.localCandidateId), remote = stats.get(pair.remoteCandidateId);
          if (local.candidateType !== 'relay' || remote.candidateType !== 'relay') throw new Error('Connection bypassed relay');
          return { ok: true, localType: local.candidateType, remoteType: remote.candidateType,
            relayProtocol: local.relayProtocol, transport: local.protocol, dtlsState: transport.dtlsState };
        } catch (error) {
          const diagnostics = [];
          for (const pc of [left, right]) {
            const stats = await pc.getStats();
            diagnostics.push({ ice: pc.iceConnectionState, connection: pc.connectionState,
              pairs: [...stats.values()].filter(v => v.type === 'candidate-pair').map(v => ({ state: v.state, nominated: v.nominated })),
              candidates: [...stats.values()].filter(v => v.type === 'local-candidate' || v.type === 'remote-candidate').map(v => ({ type: v.type, candidateType: v.candidateType, protocol: v.protocol, relayProtocol: v.relayProtocol })) });
          }
          throw new Error(`${error.message}: ${JSON.stringify(diagnostics)}`);
        } finally { left.close(); right.close(); }
      }, { url, leftAuth: auth('left'), rightAuth: auth('right') });
      console.log(JSON.stringify({ url, ...result }));
      await page.close();
    }
    const page = await browser.newPage();
    const rejected = await page.evaluate(async ({ username }) => {
      const pc = new RTCPeerConnection({ iceTransportPolicy: 'relay', iceServers: [{
        urls: 'turns:turn.gonota.ca:443?transport=tcp', username, credential: 'invalid-credential',
      }] });
      let relayCount = 0;
      pc.onicecandidate = event => { if (event.candidate?.type === 'relay') relayCount++; };
      try {
        pc.createDataChannel('rejected-auth'); await pc.setLocalDescription(await pc.createOffer());
        await new Promise(resolve => setTimeout(resolve, 12000));
        return relayCount === 0;
      } finally { pc.close(); }
    }, { username: auth('invalid').username });
    if (!rejected) throw new Error('Invalid credentials obtained a relay candidate');
    console.log(JSON.stringify({ invalidCredentialsRejected: true }));
  } finally { await browser.close(); ssm.destroy(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
