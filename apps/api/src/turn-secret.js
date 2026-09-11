'use strict';

// Shared by both rehearsal rooms; keep the relay secret in SSM, never in HTML.
function createTurnSecretReader({ env = process.env, nowMs = Date.now, readTurnSecret } = {}) {
  let turnSecretCache = null, turnSecretUntil = 0, ssm;
  async function turnSecret() {
    if (env.NOTA_SIGNING_TURN_SECRET) return env.NOTA_SIGNING_TURN_SECRET;
    if (turnSecretCache && nowMs() < turnSecretUntil) return turnSecretCache;
    const name = env.NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER;
    if (!name) return null;
    let value;
    if (readTurnSecret) value = await readTurnSecret(name);
    else {
      const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
      ssm ||= new SSMClient({ region: env.AWS_REGION || 'ca-central-1' });
      value = (await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: true }))).Parameter?.Value;
    }
    if (typeof value !== 'string' || value.length < 32) throw new Error('TURN secret unavailable');
    turnSecretCache = value; turnSecretUntil = nowMs() + 5 * 60 * 1000;
    return value;
  }
  return turnSecret;
}

module.exports = { createTurnSecretReader };
