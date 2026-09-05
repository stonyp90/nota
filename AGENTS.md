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

## Running it — the local loop

You do not need AWS, Docker or a mailbox to see this product work. **One
command**, from the repo root, after `npm install`:

```bash
npm run local        # carnet :4173 · API :8788 · CONSOLE ADMIN :4174 · API admin :8790
```

All four surfaces come up **seeded** (34 offers, two confirmed referral codes,
four demo notaries, a 28-day analytics history — `apps/api/scripts/dev-fixtures.js`),
in memory, wired to each other. Ctrl-C stops all four.

**Reaching the admin console.** Sign-in is the real single-use magic link;
outside production the API returns it *in the response*, so no mailbox is
involved. The allowlisted dev address is `admin@nota.local` (override with
`NOTA_ADMIN_EMAILS`):

```bash
curl -s -X POST http://localhost:4174/api/admin/auth/request \
  -H 'content-type: application/json' -d '{"email":"admin@nota.local"}'
# -> {"ok":true,"devLink":"http://localhost:4174/#/auth?token=..."}
# open the devLink (or POST its token to /api/admin/auth/verify for a session)
```

**On the real persistence layer** — DynamoDB Local + an S3-compatible store, same
ports:

```bash
docker compose up              # everything, seeded, persisted in named volumes
docker compose run --rm seed   # re-seed whenever (idempotent)
docker compose down -v         # start clean
```

**Before you trust anything you curled:**

```bash
npm run local:check
```

It asks three separate questions: does each of the four surfaces answer, are the
**two APIs** serving the tree in front of you (`x-nota-source`), and is the
carnet the public API returns **not empty**. Note the boundary: only the two
APIs stamp the freshness header, so a stale `web`/`admin` static server is *not*
caught here — restart those by hand if their `run-local.mjs` changed.

The middle one is not paranoia. The containers hold their code in memory and
this stack was caught serving **two-day-old code** with no error and no warning,
so every check made against it was worthless *and looked fine*. Every node
service therefore runs under `apps/api/scripts/dev-watch.js` (a polling content
digest — `node --watch` uses inotify, which never fires for a host write over a
bind mount), and both APIs stamp that digest on every response as
`x-nota-source`. If you edit `apps/api/src` and the answer does not change,
check the header before you debug the code:

```bash
curl -sI "http://localhost:8788/bids?month=2026-09" | grep x-nota-source
docker compose restart api admin-api    # the fix, if it is ever stale
```

`apps/api/test/local-stack.test.mjs` holds all of this to account without
starting a container.

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
