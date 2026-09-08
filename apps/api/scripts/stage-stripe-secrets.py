#!/usr/bin/env python3
"""Stage Stripe credentials in Secrets Manager without terminal echo or disk files.

Writes AWSPENDING only. It never changes the active Lambda credentials.
"""
import argparse
import getpass
import json
import re
import subprocess
import sys
import urllib.request
import uuid
import warnings


class SafeError(Exception):
    pass


def aws(profile, region, service, operation, payload):
    # JSON travels over stdin, never argv, shell history, environment or a file.
    result = subprocess.run(
        ['aws', '--profile', profile, '--region', region, '--no-cli-pager',
         service, operation, '--cli-input-json', 'file:///dev/stdin', '--output', 'json'],
        input=json.dumps(payload), text=True, capture_output=True, timeout=40,
    )
    if result.returncode:
        raise SafeError(f'AWS {service} {operation} failed; no credentials were printed.')
    try:
        return json.loads(result.stdout or '{}')
    except ValueError:
        raise SafeError('AWS returned an invalid response.') from None


def stripe_account(key):
    request = urllib.request.Request('https://api.stripe.com/v1/account',
        headers={'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            data = json.load(response)
        if not re.fullmatch(r'acct_[A-Za-z0-9]+', data.get('id', '')):
            raise ValueError()
        return data
    except Exception:
        raise SafeError('Stripe account validation failed. Check the key and account permissions.') from None


def read_hidden(label):
    # getpass otherwise falls back to echoed stdin on a non-terminal.
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            return getpass.getpass(label).strip()
        except getpass.GetPassWarning:
            raise SafeError('A private interactive terminal is required; input echo fallback is disabled.') from None


def stage(args):
    identity = aws(args.profile, args.region, 'sts', 'get-caller-identity', {})
    if identity.get('Account') != args.aws_account:
        raise SafeError('AWS account mismatch; refusing to read or write secrets.')
    current = aws(args.profile, args.region, 'secretsmanager', 'get-secret-value',
                  {'SecretId': args.secret_id, 'VersionStage': 'AWSCURRENT'})
    try:
        values = json.loads(current['SecretString'])
        if not isinstance(values, dict) or len(values.get('NOTA_NOTARY_SECRET', '')) < 32:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise SafeError('The current signing bundle is missing or invalid; it will not be replaced.') from None

    key = read_hidden(f'Stripe {args.mode} server secret key (sk_{args.mode}_…): ')
    if not re.fullmatch(r'sk_' + args.mode + r'_[A-Za-z0-9]{16,}', key):
        raise SafeError('Wrong key type or mode. Hosted Checkout needs a server secret key, not pk_.')
    account = stripe_account(key)
    if args.stripe_account and account['id'] != args.stripe_account:
        raise SafeError('Stripe account mismatch; no secret version was written.')
    signing = read_hidden('Webhook endpoint signing secret (whsec_…): ')
    if not re.fullmatch(r'whsec_[A-Za-z0-9]{16,}', signing):
        raise SafeError('Invalid webhook signing secret format; no secret version was written.')
    values.update(STRIPE_SECRET_KEY=key, STRIPE_WEBHOOK_SECRET=signing)
    # Do not silently copy a stale signing bundle over a concurrent rotation.
    metadata = aws(args.profile, args.region, 'secretsmanager', 'describe-secret', {'SecretId': args.secret_id})
    stages = metadata.get('VersionIdsToStages', {})
    if 'AWSCURRENT' not in stages.get(current.get('VersionId'), []):
        raise SafeError('The active bundle changed during entry; restart to preserve its current signing keys.')
    result = aws(args.profile, args.region, 'secretsmanager', 'put-secret-value', {
        'SecretId': args.secret_id, 'ClientRequestToken': str(uuid.uuid4()),
        'SecretString': json.dumps(values), 'VersionStages': ['AWSPENDING'],
    })
    return {'secretArn': result.get('ARN'), 'pendingVersionId': result.get('VersionId'),
            'stripeAccount': account['id'], 'mode': args.mode,
            'chargesEnabled': bool(account.get('charges_enabled')),
            'payoutsEnabled': bool(account.get('payouts_enabled')),
            'activeCredentialsChanged': False,
            'webhookDeliveryVerified': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', default='aws-prod')
    parser.add_argument('--region', default='ca-central-1')
    parser.add_argument('--aws-account', default='436136277668')
    parser.add_argument('--secret-id', default='nota/production/public')
    parser.add_argument('--stripe-account', help='Expected acct_ ID, if already known')
    parser.add_argument('--mode', choices=['test', 'live'], default='test')
    args = parser.parse_args()
    try:
        print(json.dumps(stage(args), indent=2))
        print('Staged only. Verify payment and webhook tests before promoting this version.')
    except (SafeError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, SafeError) else 'AWS request timed out; check version metadata before retrying.', file=sys.stderr)
        return 1
    except (KeyboardInterrupt, EOFError):
        print('\nCancelled; no secret values were printed.', file=sys.stderr)
        return 1
    except Exception:
        print('Credential staging failed; no secret values were printed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
