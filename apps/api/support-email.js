'use strict';

// SES receipt Lambda. It has no HTTP URL and consumes the S3 object written
// by the preceding action in the same receipt rule.
function createSupportEmailLambda({ env = process.env, loadSecrets, repo: suppliedRepo, s3: suppliedS3, notifier: suppliedNotifier, nowMs = Date.now, log = console.info } = {}) {
  const { createRuntimeSecrets } = require('./src/runtime-secrets');
  const load = loadSecrets || createRuntimeSecrets({ env });
  let repo = suppliedRepo, s3 = suppliedS3, receiver, version;
  return async function handler(event) {
    const nextVersion = await load();
    if (!receiver || nextVersion !== version) {
      if (!env.TABLE_NAME || !env.NOTA_SUPPORT_EMAIL_BUCKET || !env.NOTA_SUPPORT_EMAIL_DOMAIN || !env.NOTA_NOTARY_SECRET) {
        throw new Error('Support email runtime is not configured.');
      }
      if (!repo) repo = require('./src/repo-dynamo').createDynamoRepo({ tableName: env.TABLE_NAME, region: env.AWS_REGION });
      if (!s3) {
        const { S3Client } = require('@aws-sdk/client-s3');
        s3 = new S3Client({ region: env.AWS_REGION, maxAttempts: 2 });
      }
      let notifier = suppliedNotifier;
      if (!notifier && env.NOTA_FROM_EMAIL) {
        const { createSesAdapter } = require('./src/notify-port');
        notifier = require('./src/notifications').createNotifier({
          repo,
          mailer: createSesAdapter({ from: env.NOTA_FROM_EMAIL, region: env.AWS_REGION }),
          baseUrl: env.NOTA_BASE_URL,
          operatorEmail: env.NOTA_OPERATOR_EMAIL,
          adminUrl: env.NOTA_ADMIN_URL,
          supportEmailDomain: env.NOTA_SUPPORT_EMAIL_DOMAIN,
          supportEmailSecret: env.NOTA_NOTARY_SECRET,
        });
      }
      const { createSupportConversations } = require('./src/support-conversations');
      const conversations = createSupportConversations({ repo, nowMs, notifier });
      const { createSupportEmailReceiver } = require('./src/support-email');
      const prefix = env.NOTA_SUPPORT_EMAIL_PREFIX || 'support/';
      receiver = createSupportEmailReceiver({ repo, conversations, env, nowMs, getObject(messageId) {
        const { GetObjectCommand } = require('@aws-sdk/client-s3');
        return s3.send(new GetObjectCommand({ Bucket: env.NOTA_SUPPORT_EMAIL_BUCKET, Key: prefix + messageId }));
      } });
      version = nextVersion;
    }
    let result;
    try { result = await receiver.handle(event); } catch {
      log(JSON.stringify({ event: 'support_email', result: 'retryable_failure' }));
      throw new Error('Support email processing unavailable.');
    }
    const counts = {};
    for (const outcome of result.results || [result]) {
      const key = outcome.accepted ? outcome.duplicate ? 'duplicate' : 'accepted' : outcome.reason;
      counts[key] = (counts[key] || 0) + 1;
    }
    // No body, sender, subject, Message-ID or signed recipient enters logs.
    log(JSON.stringify({ event: 'support_email', counts }));
    return result;
  };
}

module.exports = { createSupportEmailLambda, handler: createSupportEmailLambda() };
