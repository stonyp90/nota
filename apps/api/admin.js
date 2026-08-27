'use strict';

/**
 * Admin Lambda entry point (admin.nota.ca). Adapts the API Gateway HTTP API
 * payload-format-2.0 event to the transport-agnostic request shape and wires
 * the admin app over BOTH tables: read-only on the main table (analytics) and
 * read/write on the separate nota-admin table (identity/sessions/audit). Table
 * names, the admin secret and the allowlist come from the environment set by
 * Terraform (infra/admin.tf). Deliberately separate from index.js.
 */
const { createAdminApp } = require('./src/admin-handler');
const { createDynamoRepo } = require('./src/repo-dynamo');

const repo = createDynamoRepo({
  tableName: process.env.TABLE_NAME,
  adminTableName: process.env.ADMIN_TABLE_NAME,
  region: process.env.AWS_REGION,
});

// Minimal SES v2 mailer for the magic-link email. Built lazily so a cold start
// that only serves analytics never loads the SES client. Best-effort: the admin
// use-case swallows a send failure (the operator can request another link).
// Sends BOTH bodies like createSesAdapter (notify-port.js): the branded HTML
// built by emails.adminMagicLink plus the plain-text alternative — dropping
// either one degrades the operator's inbox for no reason.
let sesClient = null;
const mailer = {
  async send({ to, subject, html, text }) {
    if (!process.env.NOTA_FROM_EMAIL) return;
    const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2');
    if (!sesClient) sesClient = new SESv2Client({ region: process.env.AWS_REGION });
    const body = {};
    if (html) body.Html = { Data: html, Charset: 'UTF-8' };
    if (text) body.Text = { Data: text, Charset: 'UTF-8' };
    await sesClient.send(
      new SendEmailCommand({
        FromEmailAddress: process.env.NOTA_FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: body,
          },
        },
      })
    );
  },
};

const app = createAdminApp(repo, { mailer });

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || 'GET';
  const path = event?.rawPath || '/';
  const query = event?.queryStringParameters || {};
  const headers = event?.headers || {};
  // The TRUSTED viewer IP as seen by API Gateway. Passed explicitly so the
  // rate-limit + audit key cannot be forged with a client X-Forwarded-For header.
  const sourceIp = event?.requestContext?.http?.sourceIp || null;
  let body = event?.body || '';
  if (event?.isBase64Encoded && body) body = Buffer.from(body, 'base64').toString('utf8');

  const res = await app.handle({ method, path, query, headers, body, sourceIp });
  return { statusCode: res.statusCode, headers: res.headers, body: res.body };
};
