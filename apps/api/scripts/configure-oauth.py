#!/usr/bin/env python3
"""Configure Nota production OAuth without printing or putting secrets in argv.

The private input JSON must live outside the repository with mode 0600:
{"google":{"client_id":"...","client_secret":"..."},
 "microsoft":{"client_id":"...","client_secret":"..."},
 "linkedin":{"client_id":"...","client_secret":"..."}}

By default this only checks production. --apply --credentials-file PATH requires
an OAuth-capable API and secret loaders already deployed to both public Lambdas.
Uses the caller's AWS environment/profile. Never changes unrelated configuration.
"""
import argparse
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import tempfile
import urllib.request
import uuid
import zipfile

REGION = 'ca-central-1'
ORIGIN = 'https://gonota.ca'
PROVIDERS = ('google', 'microsoft', 'linkedin')


def aws(service, operation, **payload):
    # AWS CLI on macOS does not reliably read JSON from /dev/stdin.
    # NamedTemporaryFile uses mode 0600 and is removed after the CLI returns.
    with tempfile.NamedTemporaryFile(mode='w+', suffix='.json') as request:
        json.dump(payload, request)
        request.flush()
        result = subprocess.run(['aws', service, operation, '--region', REGION, '--output', 'json', '--cli-input-json', 'file://' + request.name], capture_output=True, text=True, env={**os.environ, 'AWS_PAGER': ''})
    if result.returncode:
        # AWS errors may quote request content. Only expose the operation name.
        raise RuntimeError(f'AWS {service} {operation} failed; no response or credential content logged')
    return json.loads(result.stdout or '{}')


def validate_credentials(value):
    if not isinstance(value, dict) or not value or set(value) - set(PROVIDERS):
        raise ValueError('Expected only google, microsoft and/or linkedin objects')
    for provider, fields in value.items():
        if not isinstance(fields, dict) or set(fields) != {'client_id', 'client_secret'}:
            raise ValueError(f'{provider} requires client_id and client_secret')
        if any(not isinstance(v, str) or not v.strip() or v != v.strip() or len(v) > 4096 for v in fields.values()):
            raise ValueError('Credentials must be nonempty strings without surrounding whitespace')
    return value


def prepare(old_secret, old_env, credentials):
    validate_credentials(credentials)
    merged, variables = dict(old_secret), dict(old_env)
    if merged.get('NOTA_OAUTH_ENCRYPTION_KEY') and not re.fullmatch('[a-fA-F0-9]{64}', merged['NOTA_OAUTH_ENCRYPTION_KEY']):
        raise ValueError('Existing OAuth encryption key is invalid; refusing automatic rotation')
    merged.setdefault('NOTA_OAUTH_ENCRYPTION_KEY', secrets.token_hex(32))
    variables['NOTA_OAUTH_ORIGIN'] = ORIGIN
    for provider, fields in credentials.items():
        prefix = 'NOTA_OAUTH_' + provider.upper()
        merged[prefix + '_CLIENT_SECRET'] = fields['client_secret']
        variables[prefix + '_CLIENT_ID'] = fields['client_id']
    return merged, variables


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--credentials-file', type=Path)
    args = parser.parse_args()
    cfg = aws('lambda', 'get-function-configuration', FunctionName='nota-api')
    variables = cfg['Environment']['Variables']
    secret_arn = variables['NOTA_RUNTIME_SECRET_ARN']
    current = aws('secretsmanager', 'get-secret-value', SecretId=secret_arn)
    existing = json.loads(current['SecretString'])
    if not args.apply:
        print(json.dumps({'origin_configured': variables.get('NOTA_OAUTH_ORIGIN') == ORIGIN, 'encryption_key_present': bool(existing.get('NOTA_OAUTH_ENCRYPTION_KEY')), 'providers': {p: {'client_id_present': bool(variables.get('NOTA_OAUTH_' + p.upper() + '_CLIENT_ID')), 'secret_present': bool(existing.get('NOTA_OAUTH_' + p.upper() + '_CLIENT_SECRET'))} for p in PROVIDERS}}, indent=2))
        return
    if not args.credentials_file:
        raise ValueError('--apply requires --credentials-file')
    path = args.credentials_file.resolve()
    if path.is_relative_to(Path(__file__).resolve().parents[3]) or path.stat().st_mode & 0o077:
        raise ValueError('Credential file must be outside this repository and readable only by its owner (chmod 600)')
    credentials = validate_credentials(json.loads(path.read_text()))
    # Both functions share this strict JSON secret loader. An old loader would
    # reject new keys and break requests or reminder delivery after rotation.
    for function in ('nota-api', 'nota-reminders'):
        deployed = aws('lambda', 'get-function', FunctionName=function)
        with urllib.request.urlopen(deployed['Code']['Location'], timeout=30) as response:
            archive = zipfile.ZipFile(io.BytesIO(response.read()))
        loader = archive.read('src/runtime-secrets.js').decode()
        if any(key not in loader for key in ['NOTA_OAUTH_ENCRYPTION_KEY'] + ['NOTA_OAUTH_' + p.upper() + '_CLIENT_SECRET' for p in PROVIDERS]):
            raise ValueError(f'Deploy the OAuth secret loader to {function} before configuring credentials')
        if function == 'nota-api' and 'src/oauth.js' not in archive.namelist():
            raise ValueError('Deploy the account OAuth routes first')
    merged, updated = prepare(existing, variables, credentials)
    version = str(uuid.uuid4())
    label = 'nota-oauth-' + version
    aws('secretsmanager', 'put-secret-value', SecretId=secret_arn, ClientRequestToken=version, SecretString=json.dumps(merged), VersionStages=[label])
    # Optimistic version promotion: a concurrent secret writer must not be lost.
    aws('secretsmanager', 'update-secret-version-stage', SecretId=secret_arn, VersionStage='AWSCURRENT', MoveToVersionId=version, RemoveFromVersionId=current['VersionId'])
    aws('lambda', 'update-function-configuration', FunctionName='nota-api', RevisionId=cfg['RevisionId'], Environment={'Variables': updated})
    print(json.dumps({'configured_providers': list(credentials), 'origin': ORIGIN, 'status': 'configuration submitted; live provider sign-in still requires verification'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Never dump a traceback (which may expose locals in some runners).
        if isinstance(error, (ValueError, RuntimeError)):
            print(str(error))
        else:
            print('OAuth configuration failed; credential values were not logged')
        raise SystemExit(1)
