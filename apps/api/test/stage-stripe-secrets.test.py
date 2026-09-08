import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
import sys
sys.dont_write_bytecode = True
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('stage', Path(__file__).parents[1] / 'scripts/stage-stripe-secrets.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class StageTests(unittest.TestCase):
    def args(self):
        return SimpleNamespace(profile='test-profile', region='ca-central-1', aws_account='123',
                               secret_id='nota/production/public', mode='test', stripe_account='acct_expected')

    def test_stages_without_activating_and_preserves_existing_signing_credentials(self):
        calls = []
        original = {'NOTA_NOTARY_SECRET': 'signing' * 8, 'ANTHROPIC_API_KEY': 'preserve'}
        def aws(profile, region, service, operation, payload):
            calls.append((operation, payload))
            return {
                'get-caller-identity': {'Account': '123'},
                'get-secret-value': {'SecretString': json.dumps(original), 'VersionId': 'old'},
                'describe-secret': {'VersionIdsToStages': {'old': ['AWSCURRENT']}},
                'put-secret-value': {'ARN': 'arn:test', 'VersionId': 'new'},
            }[operation]
        with patch.object(m, 'aws', side_effect=aws), patch.object(m, 'read_hidden', side_effect=['sk_test_' + 'a'*24, 'whsec_' + 'b'*24]), patch.object(m, 'stripe_account', return_value={'id':'acct_expected'}):
            out = m.stage(self.args())
        write = calls[-1][1]
        self.assertEqual(write['VersionStages'], ['AWSPENDING'])
        self.assertEqual(json.loads(write['SecretString'])['NOTA_NOTARY_SECRET'], original['NOTA_NOTARY_SECRET'])
        self.assertEqual(json.loads(write['SecretString'])['ANTHROPIC_API_KEY'], 'preserve')
        self.assertFalse(out['activeCredentialsChanged'])
        self.assertNotIn('sk_test_', json.dumps(out))
        self.assertNotIn('whsec_', json.dumps(out))

    def test_wrong_aws_account_stops_before_prompt_or_secret_read(self):
        with patch.object(m, 'aws', return_value={'Account':'other'}) as aws, patch.object(m, 'read_hidden') as hidden:
            with self.assertRaises(m.SafeError): m.stage(self.args())
            self.assertEqual(aws.call_count, 1)
            hidden.assert_not_called()

    def test_cli_secret_payload_uses_stdin_only_and_errors_are_redacted(self):
        secret = 'unique-secret-value'
        with patch.object(m.subprocess, 'run', return_value=SimpleNamespace(returncode=1, stdout=secret, stderr=secret)) as run:
            with self.assertRaises(m.SafeError) as failure: m.aws('p','r','secretsmanager','put-secret-value',{'SecretString':secret})
            self.assertNotIn(secret, str(failure.exception))
            self.assertNotIn(secret, ' '.join(run.call_args.args[0]))
            self.assertIn(secret, run.call_args.kwargs['input'])
            self.assertNotIn('shell', run.call_args.kwargs)

if __name__ == '__main__': unittest.main()
