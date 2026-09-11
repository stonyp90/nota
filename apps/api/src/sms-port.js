'use strict';

/**
 * SMS port — an outbound text-message adapter that mirrors notify-port.js
 * (the mail port) one for one: the same three adapters, the same lazy SDK
 * import, the same single-method surface, so the notifier composes the two
 * channels without knowing which is behind either.
 *
 *   send({ to, text }) -> { id }
 *
 * `to` is an E.164 number (`+14185550100`), produced by the domain's
 * `toE164()` from whatever the person typed — the port never parses phones.
 * `text` is one short bilingual line the notifier derives from the template's
 * (admin-editable) subject and the deep link the email carries: a text is a
 * signal to open the email or the app, never a second copy of it.
 *
 * Consent is NOT this port's business. LCAP / CASL treats a text message as a
 * commercial electronic message like any other, and unlike the transactional
 * exemption the notifier applies to email (art. 6(6)), Nota only ever texts a
 * person who expressly ticked the SMS box (client, at booking) or switched the
 * alert on (notary, in their profile). The notifier reads that consent record
 * before it calls send(); this file only delivers.
 */

/**
 * Amazon SNS, direct-to-phone publish (no topic). The SDK is required lazily
 * so tests and the local stack never load it. Transactional type asks the
 * carrier for the delivery lane meant for time-critical messages (the notary
 * retained your request, your signing is tomorrow); the sender id is what a
 * handset shows where the network supports alphanumeric ids.
 */
function createSnsSmsAdapter({ region, senderId = process.env.NOTA_SMS_SENDER_ID || 'Nota' } = {}) {
  const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
  const client = new SNSClient({ ...(region ? { region } : {}) });
  return {
    async send({ to, text }) {
      if (!to) throw new Error('send: a recipient (to) is required');
      if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error('send: `to` must be E.164');
      if (!text) throw new Error('send: text is required');
      const out = await client.send(new PublishCommand({
        PhoneNumber: to,
        Message: String(text).slice(0, 320),
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
          ...(senderId ? { 'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: String(senderId).slice(0, 11) } } : {}),
        },
      }));
      return { id: out.MessageId || null };
    },
  };
}

/** In-memory adapter for tests: every text lands on `.sent`. */
function createFakeSms() {
  const sent = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      return { id: 'fake-sms-' + sent.length };
    },
  };
}

/**
 * Development adapter — each text is written next to the local mail
 * (`.local-mail/`, the same folder createFileMailer uses) as a small .json,
 * and echoed to the console, so the local stack exercises the whole SMS path
 * without a carrier, a phone or a container.
 */
function createFileSms({ dir, log } = {}) {
  const fs = require('fs');
  const path = require('path');
  const out = dir || path.join(process.cwd(), '.local-mail');
  const sent = [];
  return {
    dir: out,
    sent,
    async send(msg) {
      const n = sent.length + 1;
      sent.push(msg);
      try {
        fs.mkdirSync(out, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safe = String(msg.to || 'inconnu').replace(/[^0-9+]/g, '_');
        fs.writeFileSync(path.join(out, `${stamp}__sms__${safe}.json`), JSON.stringify({ to: msg.to, text: msg.text, at: stamp }, null, 2));
        if (log !== false) {
          // eslint-disable-next-line no-console
          console.log(`[texto]    → ${msg.to} · ${msg.text}`);
        }
      } catch {
        /* le disque n'est pas une raison de casser une requête */
      }
      return { id: 'file-sms-' + n };
    },
  };
}

module.exports = { createSnsSmsAdapter, createFakeSms, createFileSms };
