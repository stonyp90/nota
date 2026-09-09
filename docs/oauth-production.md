# Production OAuth — 2026-09-09

## Current status

| Integration | Production configuration | Live verification |
| --- | --- | --- |
| Google account sign-in | Deployed; external audience; in production; branding verified and published | Passed: real Google consent, callback, mailbox confirmation, and authenticated Nota client session |
| Microsoft / Outlook account sign-in | Deployed; client credential created | Passed: real Microsoft consent, callback, mailbox confirmation, and authenticated Nota client session |
| LinkedIn account sign-in | Company Page created; app association verified; OpenID Connect provisioned; credentials deployed | Live test reached LinkedIn password sign-in; awaiting the owner to authenticate |
| Outlook calendar connection | Existing API configured with Microsoft client, registered callback, and separate encryption key | Not verified against a live calendar; account sign-in success does not establish calendar access |

Google and Microsoft were tested with the owner's signed-in account. No notary approval gate was bypassed and no offers were created. This proves those tested account flows, not every tenant policy, user account, or calendar provider combination. Microsoft publisher domain is now verified as gonota.ca. The Partner Center verified-publisher badge remains outstanding, so some organizational tenants may require administrator approval.

## Provider identities and branding

- Google project: `gonota-production`; client ID `40395079894-pj19t5o6hulr93r5o0omiv3m1dk3ah5l.apps.googleusercontent.com`. External audience is in production. Google reports: “Your branding has been verified and is being shown to users.” Support contact is the owner's Gmail; developer contact entered in Google is `tony@nota.ca`.
- Microsoft app ID: `93d6c709-8e5d-4814-9d7e-1a4cd320fed6`; display name updated from Nota Calendar to Nota. Client credential expires **2027-03-08**; rotate it before expiry. The publisher domain was verified and saved as gonota.ca using the hosted Microsoft identity-association document. The Partner Center verified-publisher badge still requires an MPN ID.
- LinkedIn company Page https://www.linkedin.com/company/gonota/ and developer app `263686191` are created. Client ID `86odvyiq884lte`; company association verified and OpenID Connect product provisioned. The owner must complete password reauthentication to finish the live sign-in test.
- Reused `apps/web/public/icon-512.png` (512×512, 12,973 bytes). Google, Microsoft, and LinkedIn app logos are saved; the public LinkedIn company Page uses the same logo. Existing provider logos on sign-in buttons remain provider identifiers.

All providers use `openid profile email` for account sign-in. No mail, calendar, or offline permissions are requested by account login. Outlook calendar is separate and uses its existing calendar scopes.

| Provider | Exact account callback |
| --- | --- |
| Google | `https://gonota.ca/api/auth/oauth/google/callback` |
| Microsoft | `https://gonota.ca/api/auth/oauth/microsoft/callback` |
| LinkedIn | `https://gonota.ca/api/auth/oauth/linkedin/callback` |

Outlook calendar callback: `https://gonota.ca/api/calendar/outlook/callback`.

## Deployed behavior

The API validates issuer, audience, signature, nonce, token lifetime, state, and browser binding. Google and Microsoft use PKCE. OAuth tickets are encrypted, expire, and are single use. Provider account-login tokens are not persisted or returned. Microsoft signing keys are restricted to their allowed issuer.

First use requires a same-browser Nota mailbox confirmation before linking the stable provider subject. Provider email claims never silently link an existing account. Existing client sessions and approved-notary gates are reused. Enabled buttons reflect complete API configuration. OAuth calls use the same origin for HttpOnly cookies; the local server proxies these routes.

The first live Google test uncovered an adapter gap: Lambda Function URL payload-format-2.0 supplies request cookies in `event.cookies`, which the old adapter dropped. `apps/api/index.js` now reconstructs the cookie header and emits response cookies using the native array. A regression test covers both directions. The corrected deployment passed the real Google and Microsoft flows.

## Release and configuration

OAuth code is isolated in `codex/oauth-production` at `/private/tmp/nota-oauth-production`; the OAuth edits are also present in the original worktree. Other work remains uncommitted in the original tree.

Production contained changes absent from that baseline. Releases were built from freshly downloaded live artifacts, applying only the OAuth patch and preserving existing production behavior. Both `nota-api` and `nota-reminders` received the expanded strict secret whitelist before adding new keys to their shared public secret bundle. The API includes jose and the OAuth routes. The frontend was patched from current S3 assets, preserving unrelated production changes, then fingerprinted and published with a CloudFront invalidation. Conditional revision/ETag checks guarded the updates.

Original ZIPs, static assets, scoped release scripts, and deployment metadata are under `/private/tmp/nota-oauth-production-evidence`. Private credential files there use owner-only permissions and must never be committed. Google/Microsoft secrets and encryption keys are stored in the existing AWS Secrets Manager public runtime bundle, not in frontend assets or Terraform.

The configuration helper `apps/api/scripts/configure-oauth.py` uses private temporary JSON requests because macOS AWS CLI did not reliably read `/dev/stdin`. Request files are removed after each call; secrets are not passed in argv or printed. It preserves unrelated secret/env values and checks deployment prerequisites and revisions.

`infra/oauth-production.tfvars.example` records public IDs and origin. Existing local `infra/gonata.tfvars`, when present, was updated with these public settings. Use those values on subsequent Terraform applies to prevent removing OAuth configuration. No full Terraform apply was performed.

## Verification evidence

- Before deployment: domain/API suite, 796 web tests, 221 admin tests, 186 BDD scenarios / 1,069 steps passed; public/admin builds passed.
- Production-based API: 17 OAuth security/session tests passed.
- Cookie adapter plus Lambda entry and OAuth tests: 20 passed.
- Configuration helper: 3 tests passed.
- Final domain/API rerun passed; API: 1,553 tests. Log: `/tmp/nota-oauth-production-final-tests.log`.
- Terraform validation and isolated local stack freshness checks passed.
- Live health endpoint returns success. Live provider discovery reports Google=true, Microsoft=true, LinkedIn=true.
- Real Google and Microsoft consent and email-link flows each resulted in `Mon compte … CLIENT` in the production account menu. Google branding verification and publication completed.

Remaining work: the owner must complete LinkedIn password sign-in in the browser, then finish the callback/mailbox confirmation and verify the resulting Nota session. Independently complete Microsoft Partner Center publisher verification if required for target organizational tenants and test the optional Outlook calendar connection.

## LinkedIn company and application

Created https://www.linkedin.com/company/gonota/ (company ID `143744056`) with the owner-confirmed 0–1 employee size and Privately held type, Internet Marketplace Platforms industry, French description, gonota.ca website, and Nota logo. The owner explicitly approved the LinkedIn Pages Terms before publication.

Created developer app `263686191`, client ID `86odvyiq884lte`, associated with the new Page. LinkedIn confirmed the company association as verified and provisioned Sign In with LinkedIn using OpenID Connect. Registered the exact production callback and stored its generated credential in the existing AWS runtime secret. All three providers now report configured. A real login attempt reached LinkedIn's password form; the developer-console session did not bypass this reauthentication. A successful Nota callback/session has not yet been claimed for LinkedIn.

## Azure publisher domain

Published `apps/web/public/.well-known/microsoft-identity-association.json` at its production HTTPS URL, preserving it in the build output. Microsoft successfully verified and saved **gonota.ca** as this app's publisher domain. This is domain ownership verification, not the Partner Center verified-publisher badge; that separate step needs the organization's valid MPN ID. No claim is made that all organizational tenant consent policies will accept an unbadged app.
