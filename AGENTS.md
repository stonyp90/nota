# AGENTS.md — working rules for Nota

Rules for anyone (human or agent) changing this repo. They exist to keep the
business rules in one place and the merge boundaries clean.

## Ownership — who owns what

| Directory | Owns | Must NOT contain |
| --- | --- | --- |
| `packages/domain` | Business rules: prices, tiers, premium cap, offer validation, `money()`, fixtures. | I/O, DOM, network, framework or AWS code. Zero dependencies. |
| `apps/api` | Persistence + HTTP: routing, DynamoDB single-table repo, Lambda/dev adapters. | Business rules — call `@nota/domain` instead of reimplementing them. |
| `apps/web` | UI: the public carnet, offer flow, document intake. | Runtime dependencies (must stay zero). Duplicated business logic. |
| `apps/admin` | UI: the private admin console (admin.nota.ca) — magic-link gate, metrics overview. | Runtime dependencies (must stay zero). Business rules. Anything indexable (it ships `noindex` everywhere). |
| `infra` | Terraform: S3, CloudFront, Lambda, DynamoDB, ACM. | Application logic. |
| `features` | Cucumber (Gherkin) BDD specs against domain + api. | Product code. |

## Rules

1. **Business rules live only in `packages/domain`.** If a number or a tier
   label is meaningful to the product, it is defined there, exported, and
   asserted by a test — never hardcoded in `apps/web` or `apps/api`. Both apps
   import the *same* module (`require('@nota/domain')` in Node,
   `window.NotaDomain` in the browser).

2. **Free marketplace, commission on completed acts — billing layer only.**
   Notaries join and browse for free; Nota collects a configurable commission
   (`NOTA_COMMISSION_RATE`) on a retained act's value, only when the act
   completes, as a Stripe Connect application fee. The commission concept lives
   ONLY in `apps/api/src/billing.js` — `packages/domain` must never expose a
   commission, cut, or percentage concept (asserted by
   `features/deontologie.feature`). The *Code de déontologie* restricts sharing
   professional fees with a non-notaire: this model is an explicit owner
   decision and requires a legal review with the Chambre des notaires before
   launch. See `docs/decisions/0008-free-commission-marketplace.md`
   (supersedes 0001 and 0005).

3. **The product is bilingual; fr-CA is canonical.** All user-facing copy is
   written in Quebec French in the source. English comes from:
   - `apps/web/public/i18n.js` and `apps/admin/public/i18n.js` — FR→EN
     dictionaries plus pattern rules, applied to the DOM at runtime (EN/FR
     toggle in each header; persisted under `nota.lang`; `?lang=en|fr` forces
     and persists it). When you add or change user-facing French copy,
     add/update its English entry — `apps/web/test/i18n.test.mjs` and
     `apps/admin/test/i18n.test.mjs` fail CI on any uncovered string.
   - Emails (`apps/api/src/emails.js`) and ICS feeds (`apps/api/src/ics.js`)
     are bilingual in one message: French first, English below. Service/tier
     English names come from the domain's `nomEn`/`nomCourtEn` fields, money
     from `money()` / `moneyEn()` — never inline.
   Technical docs and code identifiers are English.

4. **Money goes through `money()`.** Every user-facing amount is formatted by
   `@nota/domain`'s `money()` (fr-CA: `1 350 $`). Never format currency inline.

5. **ISO dates in state.** Dates are stored as `YYYY-MM-DD` strings and parsed
   at UTC midnight so day math is timezone-stable. The month partition key is
   derived from the date (`MONTH#YYYY-MM`).

6. **`apps/web` has zero runtime dependencies.** `jsdom` (test-only) is the only
   allowed dev dependency. The UI is vanilla JS.

7. **Server is authoritative.** The API revalidates every offer through
   `domain.validateOffer` and enforces anonymity server-side — never trust the
   client's tier, premium, total, or the `nom` field on an anonymous bid.

## Before you merge

- Domain change → update/extend its tests **and** any BDD feature it affects.
- New API behavior → keep `apps/api/openapi.yaml` in sync by hand (it is derived
  from `apps/api/src/handler.js`). Admin API behavior → same for
  `apps/api/admin-openapi.yaml` (derived from `apps/api/src/admin-handler.js`).
- `npm test`, `npm run test:web`, `npm run test:admin`, and the `features`
  suite must be green.
