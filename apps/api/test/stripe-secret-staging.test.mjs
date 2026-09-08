import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('secure Stripe credential staging preserves signing keys and never exposes credentials', () => {
  execFileSync('python3', ['-B', fileURLToPath(new URL('./stage-stripe-secrets.test.py', import.meta.url))], { stdio: 'pipe' });
});
