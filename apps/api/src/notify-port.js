'use strict';

/**
 * Mailer port — an outbound-email adapter that mirrors the shape of
 * stripe-port.js and repo-dynamo.js.
 *
 * The AWS SES v2 SDK is required LAZILY inside the factory, exactly like the
 * Stripe and DynamoDB adapters. The test suite injects `createFakeMailer()`
 * (below), which captures every message in memory, so tests never load the SDK
 * and never touch the network.
 *
 * The port surface is a single method:
 *
 *   send({ to, subject, html, text, unsubscribeUrl }) -> { id }
 *
 * `html` and `text` are both provided by every template (a plain-text
 * alternative alongside the HTML), which improves deliverability and gives
 * screen-reader / plain-text clients a first-class body.
 *
 * `unsubscribeUrl` (optional) becomes the List-Unsubscribe header; an https
 * URL additionally gets List-Unsubscribe-Post (RFC 8058 one-click), which
 * Gmail and Yahoo expect from bulk senders. The POST /unsubscribe route
 * records the opt-out with no user interaction.
 */
function createSesAdapter({ from, region, configurationSet = process.env.NOTA_SES_CONFIGURATION_SET, replyTo: defaultReplyTo = process.env.NOTA_REPLY_TO_EMAIL } = {}) {
  if (!from) throw new Error('createSesAdapter: from is required');

  // Lazy import keeps the SES SDK out of the dependency graph for tests.
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const client = new SESv2Client({ ...(region ? { region } : {}) });

  return {
    async send({ to, subject, html, text, unsubscribeUrl, replyTo }) {
      if (!to) throw new Error('send: a recipient (to) is required');
      const body = {};
      if (html) body.Html = { Data: html, Charset: 'UTF-8' };
      if (text) body.Text = { Data: text, Charset: 'UTF-8' };

      const headers = [];
      if (unsubscribeUrl) {
        headers.push({ Name: 'List-Unsubscribe', Value: '<' + unsubscribeUrl + '>' });
        // One-click (RFC 8058) only makes sense for an http(s) endpoint.
        if (/^https?:/i.test(unsubscribeUrl)) {
          headers.push({ Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' });
        }
      }

      const out = await client.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          ...((replyTo || defaultReplyTo) ? { ReplyToAddresses: [replyTo || defaultReplyTo] } : {}),
          ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: body,
              ...(headers.length ? { Headers: headers } : {}),
            },
          },
        })
      );
      return { id: out.MessageId || null };
    },
  };
}

/**
 * In-memory mailer for tests and local development. Captures every message on
 * `.sent` so a test can assert exactly what would have been mailed. Same
 * interface as the SES adapter — the notifier cannot tell them apart.
 */
function createFakeMailer() {
  const sent = [];
  return {
    sent,
    async send(msg) {
      sent.push(msg);
      return { id: 'fake-' + sent.length };
    },
  };
}

/**
 * Adaptateur de DÉVELOPPEMENT : chaque courriel est écrit sur le disque, en
 * .html et en .txt, plus un index.json lisible d'un coup d'œil. Aucune
 * dépendance, aucun SMTP, aucun conteneur de plus — et surtout : la pile
 * locale peut enfin exercer TOUT ce qui passe par le courriel (les liens
 * magiques d'abord, mais aussi chaque gabarit) au lieu de s'arrêter à l'écho
 * de développement.
 *
 * Même surface que l'adaptateur SES : le notifier ne les distingue pas.
 */
function createFileMailer({ dir, log } = {}) {
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
        const safe = String(msg.to || 'inconnu').replace(/[^a-zA-Z0-9._@-]/g, '_');
        const base = path.join(out, `${stamp}__${safe}`);
        if (msg.html) fs.writeFileSync(base + '.html', msg.html);
        if (msg.text) fs.writeFileSync(base + '.txt', msg.text);
        fs.writeFileSync(
          base + '.json',
          JSON.stringify({ to: msg.to, subject: msg.subject, replyTo: msg.replyTo || null, unsubscribeUrl: msg.unsubscribeUrl || null, at: stamp }, null, 2)
        );
        // Le lien est ce qu'on vient chercher neuf fois sur dix : on le sort
        // en clair dans la console pour qu'un test local soit un copier-coller.
        if (log !== false) {
          const lien = (String(msg.html || '').match(/https?:\/\/[^"'\s<>]+#(?:cauth|nauth|pauth)=[^"'\s<>]+/) || [])[0];
          // eslint-disable-next-line no-console
          console.log(`[courriel] → ${msg.to} · ${msg.subject}` + (lien ? `\n[lien]     ${lien}` : ''));
        }
      } catch {
        /* le disque n'est pas une raison de casser une requête */
      }
      return { id: 'file-' + n };
    },
  };
}

module.exports = { createSesAdapter, createFakeMailer, createFileMailer };
