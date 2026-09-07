'use strict';

/**
 * Lambda entry point for the daily reminder scheduler. Triggered by the
 * EventBridge Scheduler (see infra/notifications.tf), NOT by HTTP. It wires the
 * DynamoDB repo and the SES mailer from the environment, then runs the pure
 * reminder use-case (src/reminders.js).
 *
 * Environment (set by Terraform):
 *   TABLE_NAME          - the single DynamoDB table
 *   AWS_REGION          - set automatically by Lambda at runtime
 *   NOTA_FROM_EMAIL     - verified SES sender ("Nota <bonjour@nota.ca>")
 *   NOTA_BASE_URL       - public site origin, for CTA + unsubscribe links
 *   NOTA_OPERATOR_EMAIL - Nota's own inbox for operator notifications
 *   NOTA_SITE_URL       - public origin of the app, for the client's deep link
 *   NOTA_NOTARY_SECRET  - signs that deep link; MUST match the API Lambda's
 *   NOTA_ADMIN_URL      - where operator alerts land, when a console exists
 *   STRIPE_SECRET_KEY   - ADR 0035: without it the caution pass is skipped
 */
const domain = require('@nota/domain');
const { createDynamoRepo } = require('./src/repo-dynamo');
const { createSesAdapter } = require('./src/notify-port');
const { createNotifier } = require('./src/notifications');
const { signToken, SCOPES } = require('./src/notary-auth');
const { createBilling } = require('./src/billing');
const { createStripeAdapter } = require('./src/stripe-port');
const { runReminders } = require('./src/reminders');

exports.handler = async () => {
  const repo = createDynamoRepo({
    tableName: process.env.TABLE_NAME,
    region: process.env.AWS_REGION,
  });
  const mailer = createSesAdapter({
    from: process.env.NOTA_FROM_EMAIL,
    region: process.env.AWS_REGION,
  });
  // ADR 0033 §2.7 — ces courriels-ci sont les SEULS qui parlent à quelqu'un qui
  // n'est pas devant l'écran : rappels J-7/J-3/J-1, J-0 sans preneur, dossier
  // incomplet, caution refusée, indemnité expirée. Sans `clientLink` leur bouton
  // retombait sur l'espace client générique, derrière une nouvelle
  // authentification — un rappel de la veille qu'on ne suit pas. Le lot frappe
  // donc le même lien signé que le handler HTTP, avec le même secret (voir
  // infra/notifications.tf) ; `clientUrlFor` avale l'échec et retombe sur
  // l'espace, donc un secret absent ne bloque aucun envoi.
  const siteUrl = process.env.NOTA_SITE_URL || process.env.NOTA_BASE_URL || '';
  const CLIENT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const notifier = createNotifier({
    repo,
    mailer,
    baseUrl: process.env.NOTA_BASE_URL,
    apiBaseUrl: process.env.NOTA_API_BASE_URL,
    operatorEmail: process.env.NOTA_OPERATOR_EMAIL,
    clientLink: (bid) =>
      siteUrl && bid && bid.id
        ? siteUrl + '/#offre=' + bid.id + '&d=' + bid.dateISO + '&cle='
          + signToken(bid.id, Date.now() + CLIENT_LINK_TTL_MS, SCOPES.CLIENT)
        : null,
    adminUrl: process.env.NOTA_ADMIN_URL || null,
  });

  // ADR 0035 — la caution. Ce lot quotidien est le seul moment où Nota pose,
  // hors session, l'autorisation de carte qui doit vivre jusqu'à la signature.
  // Sans clés Stripe (déploiement de démonstration), le port n'est pas branché
  // et le lot reste ce qu'il était : des rappels, rien d'autre.
  const billing = process.env.STRIPE_SECRET_KEY
    ? createBilling({
      repo,
      stripe: createStripeAdapter({
        secretKey: process.env.STRIPE_SECRET_KEY,
        // Ce lot ne vérifie aucune signature ; l'adaptateur exige toutefois le
        // secret pour se construire, et la même variable le porte partout.
        webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'unused-in-this-lambda',
      }),
      now: () => new Date().toISOString(),
      timeZone: process.env.NOTA_TIMEZONE,
    })
    : null;

  const result = await runReminders({
    repo,
    notifier,
    billing,
    // The Québec civil day — a UTC slice here fired "demain" reminders a day
    // early every evening (the Lambda host runs at UTC).
    now: () => domain.businessDay(null, process.env.NOTA_TIMEZONE),
  });
  console.log('reminders:', JSON.stringify(result));
  return result;
};
