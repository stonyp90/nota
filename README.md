# Nota

**Nota** is a public marketplace for notarial acts in Quebec City. A client posts
the date they need an *acte notarié* signed and what they are willing to pay for
it; notaries watch a public calendar (the *carnet*) and pick up the work that
fits their schedule. Closer dates command a higher premium — the market prices
urgency.

> **How Nota makes money — the one rule that shapes everything.** Notaries
> join and browse for **free**; Nota collects a configurable **commission on
> completed acts** (a Stripe Connect application fee), and nothing else. The
> commission concept lives only in the billing layer — never in the domain.
> Quebec's *Code de déontologie des notaires* restricts sharing professional
> fees with a non-notaire, so this model is an explicit owner decision that
> requires a legal review before launch. See
> [`docs/decisions/0008-free-commission-marketplace.md`](docs/decisions/0008-free-commission-marketplace.md).

## Services and pricing

Nota is **financing-first**: the catalogue is the acts a lender's deadline
presses on. Testament and procuration were retired — see
[`docs/decisions/0010-financing-first-catalogue.md`](docs/decisions/0010-financing-first-catalogue.md).
The price is derived from a handful of answers (never from uploaded
documents); the base amount below is the **starting price** (*prix de
départ*), and the client may offer more, up to a hard **3× cap**.

| Service | `serviceId` | Prix de départ |
| --- | --- | --- |
| Refinancement hypothécaire | `refinancement` | **2 000 $** |

Referring professionals (agents immobiliers, courtiers hypothécaires) earn
flat rewards on two tracks — **50 $** when a referred client's demand is
retained by a notary, **250 $** when a referred notary retains their first
act. Attribution is one personal code with two faces — a private `?ref=CODE`
link, or the code typed by hand in the booking/signup form's optional
« Code de référence » field (industry pattern: Wealthsimple, Uber); see
[`docs/decisions/0011-partner-referral-commission.md`](docs/decisions/0011-partner-referral-commission.md).

Amounts are formatted fr-CA through `money()` — a space thousands separator and a
trailing ` $` (e.g. `1 350 $`). All prices, tiers and the cap live in
`packages/domain` and are asserted by tests; they are never hardcoded in the apps.

### Timing tiers

The **tier** is derived from how many days away the requested signing date is. It
is the axis that makes the calendar meaningful — the closer the date, the higher
the premium the market will bear.

| Tier | Days to date | Indicative premium |
| --- | --- | --- |
| `standard` | 15+ | 1.0×–1.4× |
| `rapide` | 4–14 | 1.4×–1.8× |
| `prioritaire` | 2–3 | 3.0×–4.0× |
| `urgence` | 1 | 6.0×–8.0× |
| `extreme` | 0 | 8.0×–10.0× |

`tierForDays(days)` is the single source of truth for this mapping.

## Architecture

Nota is a small npm-workspaces monorepo built around a **domain-centric
(hexagonal) design**: a pure business-rules core with thin adapters for HTTP,
persistence and UI. Framework, I/O and AWS concerns never leak into the core.

```
nota/
├── packages/
│   └── domain/        @nota/domain — pure business rules, ZERO dependencies.
│                      Prices, tiers, premium cap, offer validation, money(),
│                      deterministic fixtures. The core of the hexagon.
├── apps/
│   ├── api/           @nota/api — HTTP + persistence adapter.
│   │                  createApp(repo) routes GET /health, GET/POST /bids and
│   │                  revalidates every offer through @nota/domain. Ports:
│   │                  repo-dynamo (AWS) and repo-memory (dev/tests). Entry
│   │                  points: index.js (Lambda) and local-server.js (dev).
│   ├── web/           @nota/web — static UI adapter, ZERO runtime dependencies.
│   │                  Vanilla JS carnet + offer flow; loads the same
│   │                  @nota/domain module in the browser (window.NotaDomain).
│   └── admin/         @nota/admin — the private admin console (admin.nota.ca).
│                      Magic-link sign-in + metrics overview. Vanilla JS, zero
│                      runtime deps, strict-CSP safe, noindex everywhere. Talks
│                      to its OWN Lambda (apps/api/admin.js) — read-only on the
│                      customer table, read/write on the separate admin table.
├── features/          Cucumber (Gherkin) BDD suite — executable specifications
│                      against @nota/domain and apps/api. Not a workspace.
└── infra/             Terraform: S3 + CloudFront + Lambda + DynamoDB.
```

**Domain at the center.** `packages/domain` depends on nothing. `apps/api` and
`apps/web` depend on it and adapt it to a transport (HTTP/Lambda) and a UI
(browser). The API's `createApp(repo, opts)` takes the repository as an injected
**port**, so the same routing logic runs against DynamoDB in production and an
in-memory repo in tests — the clock and id generator are injected the same way.

### API routes

Served same-origin: CloudFront routes `/api/*` to the Lambda, so the browser
needs no CORS.

| Method | Route | Response |
| --- | --- | --- |
| `GET` | `/health` | `200 { ok, today }` |
| `GET` | `/bids?month=YYYY-MM` | `200 { month, bids }` |
| `POST` | `/bids` | `201 { bid, clientToken }` · `422 { errors }` · `400 { errors }` |
| `POST` | `/notary/session` | `200 { token, feedToken, expiresAt }` · `403 compte_requis` |
| `GET` | `/notary/bids` | `200 { bids, retained }` — open demands (with this notary's own `proposition` / `demande` / `missing`) and the demands they retained |
| `POST` | `/notary/bids/accept` · `/decline` | retain (conditional, one winner) · hide a demand |
| `POST` | `/notary/bids/propose` | `200 { proposition }` — suggest a higher price · `422` `proposition_inferieure` / `plafond_depasse` |
| `POST` | `/notary/bids/documents` | `200 { demande }` — ask the client for specific documents · `422` `document_inconnu` |
| `GET` | `/client/bid?id&dateISO` | `200 { bid, propositions, demandes, readiness }` (Bearer `clientToken`) |
| `POST` | `/client/propositions/accept` · `/decline` | answer a notary's proposition; accepting retains the demand at the new amount |
| `POST` | `/client/dossier` | push an updated dossier so a document request becomes `fournie` |

The notary actions and the client token are described in
[`docs/decisions/0009-notary-propositions-and-document-requests.md`](docs/decisions/0009-notary-propositions-and-document-requests.md).

`POST /bids` accepts `{ serviceId, dateISO, montant, prefixe, anonyme, nom? }`.
The postal sector `prefixe` (FSA, e.g. `G1R`) is **required** — it is the bid's
only location signal, the anchor that lets the declared travel band mean
something against a notary's radius (see ADR 0024).
Validation error codes: `service_inconnu`, `montant_invalide`, `date_invalide`,
`date_passee`, `sous_prix_depart`, `plafond_depasse`, `prefixe_requis`,
`prefixe_invalide`. A public bid **never**
leaks `nom` when `anonyme` is set — anonymity is enforced server-side, not just
in the UI. The full contract lives in
[`apps/api/openapi.yaml`](apps/api/openapi.yaml).

### Admin API routes (admin.nota.ca)

A separate Lambda (`apps/api/admin.js`) behind its own CloudFront distribution,
answering only `/admin/*`. Passwordless magic-link auth; every session token is
checked against a live server-side session on every request. Contract:
[`apps/api/admin-openapi.yaml`](apps/api/admin-openapi.yaml).

| Method | Route | Response |
| --- | --- | --- |
| `POST` | `/admin/auth/request` | `200 { ok }` (+ `devLink` outside production) · `429` |
| `POST` | `/admin/auth/verify` | `200 { session, role, expiresAt }` · `401` |
| `POST` | `/admin/auth/refresh` | `200 { session, expiresAt }` · `401` |
| `POST` | `/admin/auth/logout` | `200 { ok }` |
| `GET` | `/admin/me` | `200 { email, role, permissions }` · `401` |
| `GET` | `/admin/metrics/overview` | `200 { range, kpis, gauge, series }` · `401` |

### Data model

A **single DynamoDB table**, partitioned by month so the calendar reads exactly
one partition per month displayed:

```
PK = MONTH#YYYY-MM          (all bids that month — one Query)
SK = BID#YYYY-MM-DD#<id>    (sorted by day, then id, within the partition)
```

See [`docs/decisions/0002-single-table-dynamodb.md`](docs/decisions/0002-single-table-dynamodb.md).

### Privacy (Quebec Law 25)

Everything regional is hosted in **`ca-central-1`** for data residency.
**Anonymity is default-on** (`anonyme` defaults to `true`), and consent is
collected at the point of collection.

## Run locally

Requires **Node 20+**.

```bash
npm install          # install all workspaces
npm test             # domain + api unit tests
```

Two dev servers, run in separate terminals:

```bash
npm run dev          # @nota/web on http://localhost:4173
npm run api:local    # @nota/api on http://localhost:8788
```

`api:local` uses an **in-memory repo seeded with domain fixtures** when
`TABLE_NAME` is unset, so the API returns a populated carnet with no
infrastructure at all. The web dev server single-sources the domain module at
`/domain.js` and falls back unknown paths to `index.html` (matching CloudFront).

### Admin console locally

Two more servers give the full admin experience — real magic-link flow, no AWS,
no mailbox:

```bash
npm run admin:local  # admin API on http://localhost:8790 (fixtures + seeded stats)
npm run dev:admin    # admin console on http://localhost:4174 (proxies /api/* to :8790)
```

Open http://localhost:4174, request a link for `admin@nota.local` (or set
`NOTA_ADMIN_EMAILS`), and click the **dev link echoed on the page** — outside
production the API returns the magic link in the response, so the whole
sign-in completes locally. The overview renders a deterministic seeded
dashboard (fixtures + a 28-day analytics history).

### Full stack with Docker (no AWS)

To run the whole stack — DynamoDB Local, table creation, API and web — with a
single command and no AWS account:

```bash
docker compose up
```

This starts `dynamodb-local` (:8000), creates the `nota` and `nota-admin`
tables, runs the API against them (:8788), serves the web app (:4173), and
brings up the admin surface too — the admin API (:8790) and the admin console
(:4174), mirroring production's two-table, two-Lambda split.

## Tests

```bash
npm test                                   # @nota/domain + @nota/api unit tests
npm run test:web                           # @nota/web jsdom smoke test
npm run test:admin                         # @nota/admin jsdom + dev-proxy tests
npm install --prefix features \
  && npm test --prefix features            # Cucumber BDD suite
```

## Deploy

Infrastructure is Terraform in [`infra/`](infra/): a private S3 bucket (OAC) and
a Node 20 Lambda API, both served same-origin through one CloudFront
distribution, backed by a single DynamoDB table (PAY_PER_REQUEST). Idle cost is
near **$0** — the stack is scale-to-zero serverless.

**Region note.** All regional resources live in `ca-central-1` (Law 25). The
**ACM certificate must be created in `us-east-1`** — CloudFront can only attach
certificates from that region — which is the sole reason `providers.tf` declares
a second, aliased AWS provider.

```bash
cd infra
terraform init
terraform apply
```

Terraform provisions infrastructure only; it does not upload the SPA build. After
apply, publish the site as a separate deploy step — sync the build to S3 and
invalidate the CloudFront cache:

```bash
npm run build --workspace @nota/web
aws s3 sync apps/web/dist "s3://$(terraform -chdir=infra output -raw web_bucket_name)" --delete
aws cloudfront create-invalidation \
  --distribution-id <distribution-id> --paths '/*'
```

The Lambda function URL is **AuthType `AWS_IAM`** and is invoked only via
CloudFront's Origin Access Control (SigV4) — never public. See
[`docs/decisions/0004-cloudfront-oac-iam-api.md`](docs/decisions/0004-cloudfront-oac-iam-api.md)
and [`infra/README.md`](infra/README.md).
