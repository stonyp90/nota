# Continue Nota in Claude Code — handoff

Paste this as the opening prompt for the next session. It captures where Nota
stands, what to build next, and the traps that will bite you if you don't know
them.

## Current state

Nota is a public marketplace where clients in Quebec post the date they need a
notarial act signed and what they'll pay; notaries pick work off a public
calendar (the *carnet*). It is a live, working system:

- **Four parts, all built and green:** `packages/domain` (pure business rules,
  zero deps), `apps/api` (Lambda function URL + single DynamoDB table,
  revalidates through the domain), `apps/web` (static SPA, zero runtime deps),
  `apps/admin` (operator console, its own Lambda and table), and a `features/`
  Cucumber BDD suite.
- **Infra is live on AWS** via Terraform in `infra/`: S3 (OAC) + CloudFront +
  Lambda + DynamoDB, all in `ca-central-1` except the ACM cert in `us-east-1`.
- **Tests pass:** `npm test` (domain + api), `npm run test:contract` (OpenAPI),
  `npm run test:web` and `npm run test:admin` (jsdom), `npm test --prefix
  features` (BDD), `npm run test:e2e` (Playwright). CI runs them plus
  `terraform validate` on every push/PR, and the deploy is gated on them.
- **Local dev:** `npm run dev` (web :4173) + `npm run api:local` (api :8788,
  in-memory fixtures); `npm run dev:admin` (:4174) + `npm run admin:local`
  (:8790); or `docker compose up` for the full stack against DynamoDB Local and
  MinIO, with no AWS.

## The revenue model — read this before touching money

**Nota takes nothing out of a notary's fees.** An offer carries two lines the
client sees separately: the **honoraires**, which reach the notary whole, and
**the price of Nota**, published per service —

- service line: `financement` **199 $**, `refinancement` **249 $**;
- date-guarantee line: `standard` 0 $, `rapide` 50 $, `prioritaire` 100 $,
  `urgence` 200 $, `extreme` 300 $.

Neither depends on the notary, their cote or the value of the act. The card is
authorized for the total and captured at signing on Nota's own account
(separate charges and transfers); the honoraires are then transferred out.
Taxes and disbursements are in neither line and appear nowhere in the product.

**Retired, and never to be reintroduced in any feature, endpoint, field or
copy:** any *commission*, *share* or *split* of a notary's fees (the 75/25 of
ADR 0027, the 5–15 % set by the cote in ADR 0028), the flat subscription of
ADR 0001/0005, and the single flat 400 $ price of ADR 0031 before the grid.
Art. 32 of the *Code de déontologie* forbids a notary from sharing fees with a
non-*notaire*; art. 32.1 2° of the *Loi sur le notariat* presumes usurpation by
an intermediary who obtains that abandonment; art. 29.1 forbids any agreement
endangering the notary's independence. See
[`decisions/0031-le-prix-de-nota-est-celui-de-nota.md`](decisions/0031-le-prix-de-nota-est-celui-de-nota.md)
and [`decisions/0034-le-prix-de-nota-est-une-grille-par-service.md`](decisions/0034-le-prix-de-nota-est-une-grille-par-service.md).

**The cote sur 100 decides no money** and is **never shown to a client** — art.
70 forbids a notary from allowing a testimonial concerning them to be used, so
a client sees facts about a named notary (étude, CNQ membership, acts carried),
never an appreciation (ADR 0030).

## Backlog (in order)

1. **Owner-blocking configuration.** Production is still incomplete: SES is in
   the sandbox, Stripe keys and `SENDER_ADDRESS` are empty, and the only notary
   on the platform is a test `@nota.ca` address. Nothing else in this list
   matters until a real act can be paid for and a real email can leave.
2. **Recovering a `commissionCentsDue` receivable.** An act settled off the
   platform books a debt (ADR 0029) that nothing in the product can invoice,
   age or extinguish. It only accumulates.
3. **The date-guarantee lines under-price their own Stripe cost.** Moving from
   `standard` to `rapide` or `prioritaire` adds more in card fees than the
   guarantee line adds in revenue (arithmetic in `docs/business-plan.md` §8.2).
   An owner decision, not a bug.
4. **Verification against the Tableau de l'Ordre.** The only check on a notary
   today is the URL format of a CNQ fiche. A notarial marketplace cannot launch
   without a real status check and an immediate-removal path.
5. **Law 25 deletion endpoint.** A right-to-erasure path that removes a
   client's bid and any associated personal data; wire it into the privacy flow.

## Gotchas (read before you touch the code)

- **`window.Nota` is the only handle into the web app.** `const`/`let` at script
  scope are lexical globals invisible on `window`; the app exposes `state`,
  `store`, `domain`, `setTab`, `selectDate`, `reload`, etc. through
  `window.Nota` (bottom of `apps/web/public/app.js`). Tests and any future
  console must go through it.
- **A worktree must `npm install` first.** Otherwise `@nota/*` resolves to the
  main checkout and the suite silently tests the wrong tree. `features/` needs
  its own install too.
- **Never write a test expectation from observed output.** Compute it from the
  domain. A 2026-09-04 pass calibrated a caution test on what the code printed
  and hid a 150 $ gap between the quote and the hold; only the BDD suite caught
  it.
- **"Today" is the Québec civil day.** Use `domain.businessDay`
  (`America/Toronto`, `NOTA_TIMEZONE` override), never a UTC `toISOString`
  slice, or evening completions book on tomorrow.
- **`setTab('carnet', { scroll: false })` on boot.** Restoring a tab from the URL
  hash must pass `scroll: false`, or the page yanks to the tab on load.
- **OAC returns 403, not 404, for missing S3 keys.** The OAC principal can't List
  the bucket, so CloudFront rewrites **both** 403 and 404 to `/index.html` (200)
  for SPA routing. Don't "fix" the 403 mapping.
- **ACM lives in `us-east-1`.** CloudFront only attaches certs from there; that is
  the entire reason `infra/providers.tf` has a second aliased provider.
  Everything else stays in `ca-central-1` (Law 25).
- **Fixtures use a fixed seed, never `Math.random()`.** `domain.makeFixtures()` is
  seeded from `FIXTURE_SEED` so tests and snapshots are deterministic. Keep it
  that way.
- **A stale local server, not a code bug.** « Route inconnue » locally is almost
  always a days-old `nota-api-demo` / `nota-admin-api` process. Restart it
  before debugging anything.
