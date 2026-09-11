# GoNota.ca deployment and email operations

Target: `https://gonota.ca`, `https://www.gonota.ca` (redirect),
`https://admin.gonota.ca`, the pitch deck at `https://pitch.gonota.ca/`, and
the shareable plan at `https://plan.gonata.ca/`.
GoDaddy stays the registrar; Route 53 becomes the
authoritative DNS provider. The app retains the Nota brand.

The plan hostname is configured with `plan_domain_name = "plan.gonata.ca"`.
That exact hostname is in the retained legacy `gonata.ca` Route 53 zone; the
legacy zone must therefore be delegated at GoDaddy (or `plan_hosted_zone_id`
must point at the authoritative zone) before ACM validation and DNS can work.
The active public application zone remains `gonota.ca`.

The pitch hostname is configured with `pitch_domain_name = "pitch.gonota.ca"`.
It is an alternate CloudFront alias that opens the interactive pitch deck at
`pitch-deck.html`. Its ACM validation and A/AAAA aliases use the authoritative
`gonota.ca` zone, or the explicit `pitch_hosted_zone_id` when the hostname is
delegated elsewhere.

## Current deployment boundary

DNS bootstrap has been applied in AWS account `436136277668` using the existing
Terraform state. The Route 53 zone is `Z030833035KR62N8OK4LD`; certificates and
SES identity/DKIM/MAIL FROM/DMARC records have been created. Public, www and
admin A/AAAA aliases target the existing CloudFront distributions and are
tracked in Terraform. Both runtime secret bundles are populated with the existing signing keys. The SES configuration
set, bounce/complaint suppression, SNS feedback topic, restricted publishing
policy and alert-email subscription have been applied. Confirm the SNS email
to activate its subscription.

Delegate GoDaddy to these nameservers:

- `ns-1737.awsdns-25.co.uk`
- `ns-1524.awsdns-62.org`
- `ns-171.awsdns-21.com`
- `ns-597.awsdns-10.net`

SES production access and sending are enabled in `ca-central-1`. The domain
itself still needs DNS verification. CloudFront custom-domain activation,
and actual mailbox delivery tests are not complete. The current web/admin builds
and all three Lambda entry points have been deployed; Node 22 and runtime Secrets
Manager loading are active, and inline credential variables have been removed. The business mailing address and monitored incoming
mailbox setup remain outstanding. Use `infra/gonata.tfvars` for subsequent
plans, alongside the existing default inputs; it is intentionally ignored by Git.

## Infrastructure migration

Use the existing Terraform state for this account. Do not initialize a new
empty state against the live resources. The stack currently uses local state;
back it up securely before applying. It contains legacy signing keys. Changing
storage for new secrets does not remove values from old state backups.

1. Refresh the AWS login for account `436136277668` and verify it with
   `aws sts get-caller-identity --profile aws-prod`.
2. Copy `infra/gonata.tfvars.example` to an ignored environment file. Fill
   `admin_emails`, `operator_email`, `alert_email`, `sender_address`, and mailbox
   provider records. Keep regional resources in `ca-central-1`.
3. First provision **only** the zone and empty Secrets Manager containers,
   using the existing state. For this bootstrap phase set
   `create_runtime_secrets=true` and leave `use_secrets_manager=false`.
   If using an existing zone, set `create_hosted_zone=false` and supply its ID;
   never create a second authoritative zone by accident.

   ```sh
   AWS_PROFILE=aws-prod terraform -chdir=infra plan -var-file=gonata.tfvars \
     -target=aws_route53_zone.public \
     -target=aws_secretsmanager_secret.public \
     -target=aws_secretsmanager_secret.admin
   # Review, then run apply with the same arguments for this bootstrap only.
   terraform -chdir=infra output registrar_nameservers
   ```

4. Populate the secret versions outside Terraform as described below. Deploy
   the runtime-loader code before enabling Secrets Manager in Lambda settings.
5. At GoDaddy, replace the domain's authoritative nameservers with **all four**
   values from `registrar_nameservers`. Adding NS records inside the old zone
   is not delegation. Copy existing MX, SPF, verification and DKIM records from
   the mailbox provider into Route 53 before changing delegation.
6. Set `use_secrets_manager=true`, clear legacy Stripe/password input values,
   set `stripe_mode` to the verified payment mode, then plan/apply the **entire**
   stack. Review any replacement or deletion before applying. ACM validation
   waits for delegation; public and admin certificates are in `us-east-1`.
7. Deploy the app surfaces through GitHub Actions, check the public, admin,
   plan, and pitch domains and SES,
   and perform actual mailbox delivery tests before calling the migration done.

DNS records cover apex/WWW/admin, ACM validation, SES Easy DKIM, a custom
MAIL FROM subdomain (`courriel.gonota.ca`), SPF and DMARC. Incoming inbox MX/TXT
records are supplied separately through `inbound_mx_records` and
`mailbox_txt_records`. Mailbox-provider CNAME records, if needed, use
`mailbox_cname_records`.

## Runtime secrets

Terraform creates two containers, uses AWS-managed encryption and grants only
`GetSecretValue` on the appropriate ARN. There are no Terraform-managed secret
versions. This keeps new secret values out of plans, state and Lambda settings.
The two bundles separate admin credentials from public/payment credentials;
caching limits Secrets Manager requests. No VPC/NAT gateway is needed.

Public bundle (`nota/production/public`), JSON string keys:

- `NOTA_NOTARY_SECRET`: preserve the existing signing key during migration.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`: existing payment credentials.
- `ANTHROPIC_API_KEY`: optional assistant credential, replacing the legacy SSM path.

Admin bundle (`nota/production/admin`):

- `NOTA_ADMIN_SECRET`: preserve the existing admin signing key.
- `NOTA_ADMIN_PASSWORD_HASH`: SHA-256 password hash, 64 hex characters.
- `NOTA_NOTARY_SECRET`: same signing key as public, for shared unsubscribe links.

For Stripe credentials, run `python3 apps/api/scripts/stage-stripe-secrets.py
--profile aws-prod --mode test` from the repository root. The private terminal
prompts hide input, preserve the current signing bundle and stage AWSPENDING
without activating it. Values travel through stdin rather than disk files or
command arguments. The tool verifies the AWS account and Stripe server key;
webhook delivery and sandbox payment checks must pass before promotion. See
`docs/qa/2026-09-08-stripe-aws-readiness.md` for the verification gate. Do not paste
values into chat, GitHub variables or Terraform inputs. Preserve signing keys:
rotating them immediately invalidates existing signed links/sessions.

Lambdas load secrets before constructing handlers, coalesce concurrent loads,
cache for five minutes, observe rotations, remove deleted optional keys and
fail closed when required values cannot be loaded. Local development has no
Secrets Manager requirement; it keeps environment variables and `.local-mail`.

## Email and notification configuration

Every registered template uses the shared bilingual HTML/plain-text shell,
brand palette, contact links, mailing address and unsubscribe footer. The
admin email editor now includes `signatureFr`/`signatureEn` (240 characters),
with validation, preview, audit, storage and reset. Login copy/signatures are
editable while their real authentication URL and delivery remain intact.

Every SES adapter inherits `NOTA_SES_CONFIGURATION_SET` and
`NOTA_REPLY_TO_EMAIL`. The public API, admin API and reminders all receive the
same sender, address and public origin. SES bounce/complaint suppression is
configured, with a dedicated SNS feedback topic restricted to SES from this
account and configuration set. The SNS email subscription needs confirmation.
See [AWS's SES-to-SNS policy](https://docs.aws.amazon.com/ses/latest/dg/event-publishing-add-event-destination-sns.html).

The app's email preference centre is available from each email footer and from
client/notary profile controls. Preferences are stored by recipient on the
server and checked at send time, including template-based campaigns. Disabling
a type does not remove its in-app history. Login and explicitly requested
partner access messages remain available. Existing in-app bell controls remain
separate. The global marketing unsubscribe still wins over re-enabling an
individual template; editing a preference does not restore marketing consent.

`GET/POST /api/notification-preferences` accepts a signed preference token, a
notary session, or a client token plus its matching bid ID/date. Signed email
links keep the token in the URL fragment; the app removes it on opening and
sends it as an Authorization header. They grant no dossier access.

SES sends mail but does not provision reply inboxes. `info@gonota.ca` must be a real monitored inbox at the chosen
provider. Verify DKIM and `ProductionAccessEnabled` in SES `ca-central-1`;
AWS approval to leave the sandbox is an external prerequisite. Confirm SNS
subscriptions and test inbox receipt, replies, unsubscribe and preferences.

## GitHub Actions

Existing public/admin deploy workflows keep their reusable CI gates, OIDC
roles and separate admin environment. Public deployment now supports manual
dispatch; both workflows wait for Lambda updates and smoke-test routing after
asset publication. The IAM policies include the configuration read needed by
the Lambda waiter. No long-lived AWS keys belong in GitHub.

Set existing AWS role/bucket/distribution variables from Terraform outputs.
Also set `PUBLIC_URL` and `ADMIN_URL` to the domains currently serving production
(the existing CloudFront URLs until delegation is ready, then gonota.ca and
admin.gonota.ca). Set `PITCH_URL=https://pitch.gonota.ca` and
`PLAN_URL=https://plan.gonata.ca` after DNS and ACM are live. Apply waiter IAM
permissions before releasing the new workflow.
Infrastructure itself is applied with Terraform using the existing state;
these deployment workflows ship application code and assets, not Terraform.

```sh
npm test
npm run test:web
npm run test:admin
npm test --prefix features
npm run test:e2e
npm run build
npm run build:admin
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
npm run local:check
```

The stack remains serverless: S3/CloudFront, Lambda, API Gateway, on-demand
DynamoDB, SES and SNS. Added standing resources are a hosted zone and two secret
containers; no dedicated IP, always-on server, NAT gateway or extra database.
Existing WAF, KMS, storage and monitoring charges still apply. Mailbox hosting
cost depends on the provider chosen by the owner.


## Domain correction and demo rollout — 2026-09-07

The owner confirmed **gonota.ca**. The earlier gonata.ca zone is retained as
`aws_route53_zone.legacy_gonata` during migration. The corrected zone is
`Z030833035KR62N8OK4LD`; a reusable delegation set
`N0281980306RRFDJYUKEE` preserves the same four registrar nameservers above.
All six website aliases and ACM/SES verification records are managed in the
existing Terraform state for the corrected zone.

The reply inbox supplied by the owner is `info@gonota.ca`. The mailbox provider
and business postal address are still outstanding. The .ca registry now delegates gonota.ca to AWS and both Google/Cloudflare DNS
resolvers agree. No root MX exists yet. Do not claim email delivery or HTTPS cutover until resolved.

The public/admin Secrets Manager bundles now contain the existing signing keys;
public and reminders share their preserved signing value. Neither Stripe keys,
an assistant API key, nor an admin password hash was available in production.
Magic-link authentication remains supported; optional services must not prevent
email startup. Secret values were migrated outside Terraform and are not in git.


Runtime cutover: all three Lambdas now use Node 22 and Secrets Manager; public
health returns 200 and admin unauthenticated access returns 401. The domain's
DKIM and MAIL FROM both report SUCCESS. SES accepted a technical delivery test
to success@simulator.amazonses.com (message ID
010d01a07f00e577-e5dc4b72-b141-401f-8184-533829fd4c9e-000000).
This is acceptance evidence, not proof of receipt in the owner's mailbox.
The public custom-domain endpoint passes certificate validation and API health;
www returns 308 and preserves the query string. Runtime sender IAM constraints
and sender variables are being switched to bonjour@gonota.ca, with Reply-To
info@gonota.ca. Operator/admin destinations retain the working existing inbox
until tony's incoming mailbox is configured. The new workflow changes remain
local; prior GitHub deployment runs succeeded, but these edits are not yet
pushed or exercised by Actions. All test suites, 40 browser E2E checks, both
builds, Terraform validation, and actionlint passed for the current tree.


Final domain checks: public API health returns 200 over gonota.ca HTTPS;
www redirects to the apex with 308; admin.gonota.ca serves noindex HTML over
verified HTTPS and its unauthenticated /api/admin/me returns 401. Both ACM
certificates are issued. GitHub PUBLIC_URL and ADMIN_URL variables point to
the custom domains. All three runtime sender variables and SES IAM sender
constraints now use bonjour@gonota.ca; Reply-To is info@gonota.ca. Public
site/base URLs use https://gonota.ca and the admin sign-in origin uses
https://admin.gonota.ca. Full mailbox receipt and the real postal signature
remain blocked on owner-provided mailbox details and address. No inbound
provider has been invented and no production secret was committed.


## Default email language

`NOTA_EMAIL_LANGUAGE=fr` is the default in every local and Lambda entry point.
Terraform's `email_language` controls the same setting for all three Lambdas.
Supported values are `fr`, `en`, and explicit `bilingual`. Subjects, previews,
bodies, buttons, signatures and footer links all use the selected language.
The template library retains explicit bilingual rendering for translation
checks; stored overrides still contain both translations. Recipient-specific
language preferences are not persisted yet.
