# Local stack verification — 2026-09-12

This pass runs the current working tree, including pre-existing changes from
other sessions. It does not select a replacement logo from the proposed brand
compositions. The served brand is checked against the current repository contract.

## Local services

The seeded memory stack is running through `npm run local`:

| Surface | Address |
| --- | --- |
| Public app | http://localhost:4173/ |
| Public API | http://localhost:8788/ |
| Admin console | http://localhost:4174/ |
| Admin API | http://localhost:8790/ |
| Pitch deck and business plan | http://localhost:4175/ |
| Signing rehearsal | http://localhost:4173/signature.html |

`npm run local:check` passed all 12 checks after restarting the stack. Both
API source fingerprints matched the working tree and the current month had
24 seeded offers. The live admin proxy completed magic-link request and
verification, returned authenticated metrics, and rejected token reuse.
Use `admin@nota.local` to request a local admin link.

## Corrections made in this pass

- Enable the signing rehearsal by default in `dev-all.js`, preserving an
  explicit `NOTA_SIGNING_BETA_ENABLED=false`. The running capabilities endpoint
  confirms `enabled: true`, `mode: rehearsal`, `legalSignatureAvailable: false`.
- Restrict Playwright discovery to `*.spec.js`. Its default discovery also
  imported Node's `*.test.mjs` files, starting untracked WebRTC browsers during
  collection. `test:e2e:signing` runs those tests explicitly and sequentially;
  `test:e2e:all`, the aggregate check and CI invoke both runners.
  The default worker count is also bounded to one; command-line overrides
  remain available.
- Recover signaling revision conflicts in `signature.js`. A presence heartbeat
  could win between the session read and signal write, permanently stranding
  the video handshake. Retry the same signed transport message at most four
  times with a fresh revision. Stop if the session, peer connection or remote
  offer changes; do not retry authorization failures or other errors.
- Force a revision conflict on each participant's first signal in the real
  two-browser media test. Both recover and finish the encrypted media/document
  acknowledgment flow. Five targeted tests also cover the retry bound,
  replacement session, replacement offer and access denial.
- Measure the first-visit chooser rather than its animated decorative backdrop
  for layout gaps. The reported gap was between floating SVGs below the screen,
  not between interface controls. Global overflow checks remain in place.
- Wait for `popstate` in the Back-navigation test instead of sleeping 30 ms.
  The test retains a bounded timeout, so missing navigation still fails.

## Verification

Execution logs are in `/tmp/nota-local-qa/`. Final suite results are recorded
below when the complete run finishes. Initial concurrent UI runs hit timing
failures; their reruns are retained separately instead of overwriting evidence.

- Admin: 244 passed on full rerun.
- Domain/API: 454 domain tests and 2,101 API tests passed again after fixes.
- BDD: 298 scenarios, 2,093 steps passed.
- Signing: both standalone browser journeys passed, including forced conflicts.
- Signing UI: 19 tests passed.
- Public and admin builds passed.
- Brand source/assets/email checks: 134 passed.
- Brand conformance: all 14 served surfaces passed (public doors, signing,
  acquisition pages in both languages, admin, brand guide, deck and plan).
- Chromium: 212 initially passed; the three failures passed in targeted reruns
  (the intro chooser and the two real-media/reconnection tests).
- Intro chooser: all six browser/device projects passed on rerun.
- The Firefox signing-entry layout passed after concurrent page/style changes
  finished; its earlier failure and the successful rerun are logged separately.
- Remaining browser/device matrix: 264 passed; the one Firefox beta layout
  failure passed in `beta-recheck.log` against the updated page. Together with
  Chromium and its targeted reruns, all 480 distinct Playwright cases have a
  passing execution. This is an aggregate result across runs, not a claim that
  the initial full run was green.
- Final full public UI rerun: all 1,059 tests passed (two concurrent test files).

## Calendar-first notary experience

The owner's latest request supersedes the inventory-first landing. The initial
screen now presents one task: add Nota to Google, Outlook or Apple, without a
Nota account. Manual subscription and the one-time ICS download remain behind
the subscription-link control. Account access, inventory/benefits and
professional obligations have separate native disclosures. Selecting a request
opens and focuses account access; an expired magic link also reveals its error
and the sign-in form. The authenticated console keeps requests before the
public subscription card. French copy includes English translations.

Verification for this change:

- Nine browser journeys passed: FR/EN at 390/1440 pixels, public ICS and provider
  links, account access, magic links including expiry, and both retention paths.
- The 42-case layout matrix initially found an obsolete mobile order rule;
  after correcting it, all 14 inventory/viewport cases passed. The other 34
  cases had passed, including signed-out and signed-in surfaces in all six
  browser/device projects.
- All 1,059 public UI tests passed in the final full run. Targeted translation,
  notary, typography and navigation checks passed as well; the final signed-in
  layout and expired-link rerun passed all three browser tests.
- The build and all 12 local stack checks passed.
- In-app Browser visual checks covered desktop and a 390-pixel mobile viewport.

Provider URLs are generated from the configured API base. External calendar
services cannot retrieve localhost: local checks verify links and the ICS
response, not ingestion into an actual Google/Outlook/Apple account.

## Boundaries of the result

This is the in-memory local stack. Payments use the local adapter, mail/SMS
use local delivery files, and OAuth uses the loopback demonstration provider.
These checks do not verify live Stripe charges, external mail/SMS delivery,
external OAuth providers or AWS persistence. The signing exercise exchanges
real local WebRTC media and cryptographic acknowledgments; it does not provide
a legal signature or test a deployed TURN relay. Historical presentation
archives and rejected brand directions are not the active served brand.
The local AI analysis flags and provider credentials are unset; real analysis
remains disabled pending provider/demo configuration. API/UI tests cover the
injected-provider flow and the unavailable-provider state, not live inference.
