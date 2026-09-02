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

// L'expéditeur de la console — le MÊME adaptateur que le notifieur public
// (`notify-port.createSesAdapter`), et pas une seconde implémentation.
//
// Il y en avait deux, et la copie d'ici perdait l'en-tête `List-Unsubscribe` :
// tant qu'elle ne servait qu'au lien magique, la conséquence était nulle. Elle
// ne l'est plus — la console peut désormais envoyer des campagnes, et la LCAP
// (art. 6) exige un mécanisme d'exclusion FONCTIONNEL sur tout message
// électronique commercial. Un second chemin d'envoi est exactement la manière
// dont une garantie se perd : elle tient sur l'un, pas sur l'autre.
//
// Construit paresseusement : un démarrage à froid qui ne sert que des
// statistiques ne charge jamais le client SES.
let sesMailer = null;
const mailer = {
  async send(message) {
    if (!process.env.NOTA_FROM_EMAIL) return;
    if (!sesMailer) {
      const { createSesAdapter } = require('./src/notify-port.js');
      sesMailer = createSesAdapter({
        from: process.env.NOTA_FROM_EMAIL,
        region: process.env.AWS_REGION,
      });
    }
    return sesMailer.send(message);
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
