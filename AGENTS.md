# AGENTS.md — working rules for Nota

Rules for anyone (human or agent) changing this repo. They exist to keep the
business rules in one place and the merge boundaries clean.

## Ownership — who owns what

| Directory | Owns | Must NOT contain |
| --- | --- | --- |
| `packages/domain` | Business rules: prices, tiers, premium cap, offer validation, `money()`, fixtures. | I/O, DOM, network, framework or AWS code. Zero dependencies. |
| `apps/api` | Persistence + HTTP: routing, DynamoDB single-table repo, Lambda/dev adapters. | Business rules — call `@nota/domain` instead of reimplementing them. |
| `apps/web` | UI: the public carnet, offer flow, document intake. | Runtime dependencies (must stay zero). Duplicated business logic. |
| `infra` | Terraform: S3, CloudFront, Lambda, DynamoDB, ACM. | Application logic. |
| `features` | Cucumber (Gherkin) BDD specs against domain + api. | Product code. |

## Rules

1. **Business rules live only in `packages/domain`.** If a number or a tier
   label is meaningful to the product, it is defined there, exported, and
   asserted by a test — never hardcoded in `apps/web` or `apps/api`. Both apps
   import the *same* module (`require('@nota/domain')` in Node,
   `window.NotaDomain` in the browser).

2. **Flat fee, never a commission.** Nota charges notaries a flat subscription.
   Never introduce a percentage/commission of the *acte*, in code, copy or
   docs — the *Code de déontologie* forbids fee-sharing with a non-notaire. See
   `docs/decisions/0001-flat-fee-not-commission.md`.

3. **fr-CA is the product language.** All user-facing copy is Quebec French.
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
  from `apps/api/src/handler.js`).
- `npm test`, `npm run test:web`, and the `features` suite must be green.
