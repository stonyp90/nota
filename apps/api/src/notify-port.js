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
function createSesAdapter({ from, region, configurationSet } = {}) {
  if (!from) throw new Error('createSesAdapter: from is required');

  // Lazy import keeps the SES SDK out of the dependency graph for tests.
  const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
  const client = new SESv2Client({ ...(region ? { region } : {}) });

  return {
    async send({ to, subject, html, text, unsubscribeUrl }) {
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

module.exports = { createSesAdapter, createFakeMailer };
