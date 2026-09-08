'use strict';

// Secrets Manager stores JSON bundles, separated by privilege (public/admin).
// Terraform manages their metadata only. Values never enter plans or Lambda
// configuration. Local development keeps using environment variables.
const KEYS = new Set([
  'NOTA_NOTARY_SECRET', 'NOTA_ADMIN_SECRET', 'NOTA_ADMIN_PASSWORD_HASH',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ANTHROPIC_API_KEY',
  'NOTA_OUTLOOK_CLIENT_SECRET', 'NOTA_CALENDAR_ENCRYPTION_KEY',
]);

function createRuntimeSecrets({ env = process.env, read, now = Date.now, ttlMs = 300000 } = {}) {
  let cached = null;
  let expires = 0;
  let pending;
  let client;
  async function fetchSecret(id) {
    if (read) return read(id);
    const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    client ||= new SecretsManagerClient({ region: env.AWS_REGION });
    const result = await client.send(new GetSecretValueCommand({ SecretId: id }));
    return result.SecretString;
  }
  return async function load() {
    if (!env.NOTA_RUNTIME_SECRET_ARN) return null;
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      let values;
      try {
        values = JSON.parse(await fetchSecret(env.NOTA_RUNTIME_SECRET_ARN));
        if (!values || Array.isArray(values) || typeof values !== 'object') throw new Error();
        for (const [key, value] of Object.entries(values)) {
          if (!KEYS.has(key) || typeof value !== 'string' || !value.trim()) throw new Error();
        }
        for (const key of ['NOTA_NOTARY_SECRET', 'NOTA_ADMIN_SECRET']) {
          if (values[key] && values[key].length < 32) throw new Error();
        }
        if (values.NOTA_ADMIN_PASSWORD_HASH && !/^[0-9a-fA-F]{64}$/.test(values.NOTA_ADMIN_PASSWORD_HASH)) throw new Error();
        const required = (env.NOTA_REQUIRED_SECRETS || 'NOTA_NOTARY_SECRET').split(',').filter(Boolean);
        for (const key of required) if (!values[key]) throw new Error();
      } catch {
        // Never log SDK errors or JSON: they can contain sensitive context.
        throw new Error('Runtime secrets unavailable or invalid; refusing to start with fallback credentials.');
      }
      // Removed keys must not survive rotation in a warm Lambda.
      for (const key of KEYS) delete env[key];
      Object.assign(env, values);
      const serialized = JSON.stringify(values);
      if (!cached || cached.serialized !== serialized) cached = { serialized };
      expires = now() + ttlMs;
      return cached;
    })();
    try { return await pending; } finally { pending = null; }
  };
}

module.exports = { createRuntimeSecrets, loadRuntimeSecrets: createRuntimeSecrets() };
