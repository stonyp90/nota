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
 */
const domain = require('@nota/domain');
const { createDynamoRepo } = require('./src/repo-dynamo');
const { createSesAdapter } = require('./src/notify-port');
const { createNotifier } = require('./src/notifications');
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
  const notifier = createNotifier({
    repo,
    mailer,
    baseUrl: process.env.NOTA_BASE_URL,
    operatorEmail: process.env.NOTA_OPERATOR_EMAIL,
  });

  const result = await runReminders({
    repo,
    notifier,
    // The Québec civil day — a UTC slice here fired "demain" reminders a day
    // early every evening (the Lambda host runs at UTC).
    now: () => domain.businessDay(null, process.env.NOTA_TIMEZONE),
  });
  console.log('reminders:', JSON.stringify(result));
  return result;
};
