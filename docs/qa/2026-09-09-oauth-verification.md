> Follow-up: implementation and provider setup progressed after this initial audit. See [current OAuth production status](../oauth-production.md). Live sign-in remains unverified.

# OAuth browser verification — 2026-09-09

## Result

Google, Microsoft/Outlook, and LinkedIn authentication are **not operational end to end**. This was checked against the live `https://gonota.ca` site and authenticated provider consoles. No successful OAuth sign-in or provider token exchange was observed. No application code, deployment, provider permissions, or credentials were changed by this verification.

## Browser evidence

| Surface | Observation | Consequence |
| --- | --- | --- |
| Nota sign-in, Google | Button is marked `À VENIR`. Clicking displays `La connexion avec Google arrive bientôt. D’ici là, votre courriel suffit.` | No Google authorization redirect. |
| Nota sign-in, LinkedIn | Button is marked `À VENIR`. Clicking displays the equivalent LinkedIn message. | No LinkedIn authorization redirect. |
| Nota sign-in, Microsoft | No Microsoft/Outlook sign-in option; displayed providers are Google, Facebook, LinkedIn. | Microsoft account authentication is not implemented in this UI. |
| Live Outlook callback | Opening `https://gonota.ca/api/calendar/outlook/callback` returns `{"errors":[{"code":"calendar_unconfigured"}]}`. No code or state was submitted. | The deployed calendar connection is disabled by configuration. This is not a test of a valid callback. |
| Google Cloud | Current account's project selector returns `No resources to display` for `nota`. Initially selected unrelated project `Ursly` has no OAuth clients. | No Nota project/client located; this does not prove it is absent under another project name or account. |
| LinkedIn Developers | App list contains JurisClaim; no Nota app appears. | Nota needs its own registration. |
| Microsoft Entra | `Nota Calendar`, application ID `93d6c709-8e5d-4814-9d7e-1a4cd320fed6`, supports all Microsoft account users. Certificates, client secrets, and federated credentials each show zero. | Existing confidential-client code cannot exchange authorization codes without its configured secret. |

The LinkedIn create-app form was prepared with name `Nota` and privacy URL `https://gonota.ca/#t=confidentialite`, but **not submitted**. It requires a LinkedIn company Page, logo, and acceptance of its API Terms of Use. The Page association is stated to be irreversible. The correct company Page URL and, if applicable, the differently named GCP project were requested from the owner.

The Microsoft overview also displays a warning concerning consent to new multitenant applications without verified publishers. This needs validation against the intended Microsoft account populations before calling the integration production-ready.

## Source and test evidence

- `apps/web/public/app.js`, `authRenderProviders`: social buttons are explicitly disabled placeholders and do not make OAuth requests.
- `apps/api/src/outlook.js`: an Outlook **calendar connection** port, not a Nota account sign-in implementation. Requires `NOTA_OUTLOOK_CLIENT_ID`, `NOTA_OUTLOOK_CLIENT_SECRET`, `NOTA_OUTLOOK_REDIRECT_URI`, and `NOTA_CALENDAR_ENCRYPTION_KEY`.
- `apps/api/src/handler.js`: Outlook routes require an existing notary session except for the browser-bound callback. They do not establish a Nota account session.
- No Google or LinkedIn account OAuth implementation was found in the inspected application code.

Executed:

```sh
node --test apps/api/test/outlook.test.mjs apps/web/test/auth-onboarding.test.mjs apps/web/test/auth-signup.test.mjs
```

Result: **31 passed, 0 failed**. Outlook tests stub provider responses. Web tests assert coming-soon behavior. Passing these tests must not be cited as evidence of live OAuth success. jsdom printed existing `window.scrollTo` not-implemented diagnostics; the tests still passed.

`npm run local:check` found all local surfaces unreachable, so browser findings above concern production, not a running local stack.

## Remaining work

1. Identify/create the correct Nota GCP project and OAuth application; identify the correct LinkedIn company Page and register the Nota application with its sign-in product.
2. Implement server-side account authentication for the requested providers, separate from calendar access. Include state/browser binding, code exchange, OIDC validation, replay prevention, safe identity linking, and client/notary session handling. Merely enabling the current placeholder buttons is insufficient.
3. Configure exact implemented callback URLs and minimum sign-in scopes; keep calendar permissions a separate consent flow. Store credentials only in server-side secret storage.
4. Wire bilingual UI and API contracts, then test actual consent, callback, authenticated session, denial, expiry, replay, and sign-out against designated provider accounts.
5. For the existing Outlook calendar connection, supply its missing credential/configuration and perform a real notary connection test. Successful connection alone would not prove calendar synchronization.

## Browser test side effect

The existing client session in the Nota browser was signed out. A logout click raised a confirmation describing removal of device-local profile, offers, dossier, messages, and notifications. An Escape dismissal was attempted, but the next observed page displayed `Vous êtes déconnecté.` The implementation clears its client local-storage keys on sign-out; no server-side deletion was requested. Device-local data recovery was not verified. The source also permits sign-out if the confirmation throws, which merits a separate regression fix.
