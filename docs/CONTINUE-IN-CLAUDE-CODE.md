# Continue Nota in Claude Code — handoff

Paste this as the opening prompt for the next session. It captures where Nota
stands, what to build next, and the traps that will bite you if you don't know
them.

## Current state

Nota is a public marketplace where clients in Quebec City post the date they need
a notarial act signed and what they'll pay; notaries pick work off a public
calendar (the *carnet*). It is a live, working system:

- **Four parts, all built and green:** `packages/domain` (pure business rules,
  zero deps), `apps/api` (Lambda function URL + single DynamoDB table,
  revalidates through the domain), `apps/web` (static SPA, zero runtime deps),
  and a `features/` Cucumber BDD suite.
- **Infra is live on AWS** via Terraform in `infra/`: S3 (OAC) + CloudFront +
  Lambda + DynamoDB, all in `ca-central-1` except the ACM cert in `us-east-1`.
- **Tests pass:** `npm test` (domain + api), `npm run test:web` (jsdom),
  `npm test --prefix features` (BDD). CI runs all of them plus `terraform
  validate` on every push/PR.
- **Local dev:** `npm run dev` (web :4173) + `npm run api:local` (api :8788,
  in-memory fixtures), or `docker compose up` for the full stack against DynamoDB
  Local with no AWS.

## Backlog (in order)

1. **Presigned-S3 document upload.** Real client document upload for the dossier
   (currently the intake collects checklist state only). Add an upload bucket in
   `infra/` and a presign endpoint in `apps/api`; keep documents private and in
   `ca-central-1`. (Referred to as continue-prompt #2 in code/infra comments.)
2. **Notary console** with accept/decline and a **webcal (ICS) feed** so notaries
   subscribe to retained bids in their calendar. Reuse the reserved single-table
   keys `SUB#<notaryId>` and `DOSSIER#<bidId>` (see `apps/api/src/keys.js`).
3. **Law 25 deletion endpoint.** A right-to-erasure path that removes a client's
   bid and any associated personal data; wire it into the privacy flow.
4. **SES transactional email** for notifications (bid retained, etc.). ACM/SES
   both have region caveats — check them.

## Gotchas (read before you touch the code)

- **`window.Nota` is the only handle into the web app.** `const`/`let` at script
  scope are lexical globals invisible on `window`; the app exposes `state`,
  `store`, `domain`, `setTab`, `selectDate`, `reload`, etc. through
  `window.Nota` (bottom of `apps/web/public/app.js`). Tests and any future
  console must go through it.
- **`setTab('carnet', { scroll: false })` on boot.** Restoring a tab from the URL
  hash must pass `scroll: false`, or the page yanks to the tab on load.
- **`updateDossierBar()` must not steal focus.** It repaints the dossier progress
  bar; keep it from moving focus off the field the user is typing in.
- **OAC returns 403, not 404, for missing S3 keys.** The OAC principal can't List
  the bucket, so CloudFront rewrites **both** 403 and 404 to `/index.html` (200)
  for SPA routing. Don't "fix" the 403 mapping.
- **ACM lives in `us-east-1`.** CloudFront only attaches certs from there; that is
  the entire reason `infra/providers.tf` has a second aliased provider.
  Everything else stays in `ca-central-1` (Law 25).
- **Fixtures use a fixed seed, never `Math.random()`.** `domain.makeFixtures()` is
  seeded from `FIXTURE_SEED` so tests and snapshots are deterministic. Keep it
  that way.
- **Flat fee, never a commission.** Nota charges notaries a flat subscription and
  never takes a percentage of an *acte* — the *Code de déontologie* forbids
  fee-sharing with a non-notaire. No feature, endpoint, field, or copy may
  introduce a platform cut. See `docs/decisions/0001-flat-fee-not-commission.md`.
