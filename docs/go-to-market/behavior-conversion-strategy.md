# Behavior, conversion and retention operating plan

Owner: Anthony. Started September 9, 2026. Status: aggregate instrumentation and
the bounded autonomous controller are implemented on the branch; production
baseline, deployment and schedule verification remain outstanding.

## Objective

Increase real, serviceable requests that are accepted by a notary and completed.
Count clicks and form progress to diagnose friction, not as the business outcome.
Keep client and notary journeys separate. A client who successfully finishes an
occasional notarial act and does not immediately return is not necessarily churned.

## What we can measure now

The first-party collector is `POST /events`; it accepts a named event and optional
bounded diagnostic context. It does not send form values, identity, session IDs
or document contents. Browser/device/source coverage now follows the
[browser experience plan](browser-experience-plan.md), prepared locally September 9.
Daily, sharded `STATS#` counters feed `GET /admin/metrics/overview?from=YYYY-MM-DD&to=YYYY-MM-DD`.
The deployed admin origin uses `/api/admin/metrics/overview` and requires an
authorized admin session. Do not save a session or credentials in this repository.

| Observation | Source and counting unit | How to use it |
| --- | --- | --- |
| `visite` | Browser, once per app page load | Traffic direction; not unique visitors or all static landing-page views |
| `jour_ouvert` | Once per booking dialog opening | Entry into booking; reopening counts again |
| `formulaire` | First input/change per opening | Form engagement; programmatic setup is excluded |
| `criteres_vus`, `prix_vu`, `coordonnees_vues` | Once per screen per opening | Reach of questions, price and contact steps; some services skip questions |
| `formulaire_bloque` | Each blocked Continue click | Validation friction; repeated clicks are multiple events |
| `publication_tentee`, `publication_echouee` | Submission attempts and unsuccessful results | Includes local validation failures; not an API error rate |
| `publie` | Authoritative publication route | Confirmed writes; browser attempts to increment it are discarded |
| `paiement_ok`, `paiement_annule` | Browser return URL observations | Checkout returns, never proof of saved card, authorization or collected money |
| `notaire_porte` | Once per app page load when the notary space opens | Supply-side interest |
| `notaire_inscrit` | First signup on server | Supply acquisition; browser events cannot increment it |
| Offers retained / acts completed | Existing server rollups | Period activity, subject to source and reconciliation checks |

The admin visitor-journey table shows counts, including zero. A missing section
is unavailable, not zero. Its labels come from the bilingual domain catalogue.
FR/EN interfaces, noindex admin and zero UI runtime dependencies are preserved.

The client is part of the product development loop through the `journey`
dimension and the server-side learning signals. A dossier update, confirmed
document, read receipt, client-notary message, completed act and evaluation add
only bounded metadata or aggregate counters to the separate learning stream.
The system can use those signals to locate friction and improve guidance; it
never treats a client action as a legal label or copies a document or
conversation into the product analytics stream.

These independent event totals cannot identify individual abandonment, unique
leads, cross-device journeys, repeat customers or causal uplift. Do not subtract
them and label the result lost customers. A ratio can exceed 100% because of
reopening, retries and conversions from earlier periods. Existing
`kpis.retentionRate` divides period acceptances by period publications; it is
not a client-retention cohort. Historical publication/signup beacon totals before
the collector fix are not guaranteed to be server-only. Checkout labels change
without changing their historical meaning.

## Establish a trustworthy baseline first

1. Verify which revision of web, API and admin is deployed. New events do not
   exist historically; record their first verified production date separately.
2. Read the authenticated production overview for the last seven complete
   business dates and the preceding seven; also keep a 28-day view. Use the
   configured business timezone (America/Toronto by default) and exclude today.
3. Save only aggregate numbers, source, queried dates, collection timestamp,
   deployed revision and known exclusions in `behavior-review-log.md`. Never
   copy customer details, referral codes, tokens or documents into the log.
4. Verify whether staff tests, demos, bots or synthetic checks contaminate the
   counters. Existing aggregate data cannot retrospectively identify these.
   If exclusions cannot be established, label the baseline mixed/unverified
   and do not present it as real customer conversion. No destructive resets.
5. Reconcile completed acts and payment state against authoritative operational
   records. Show unavailable data explicitly. Public-site traffic, test fixtures
   and a successful HTTP response alone do not verify production collection.

## Weekly scorecard

| Metric | Definition | Availability / next work |
| --- | --- | --- |
| Serviceable requests | Real published requests in supported services/territories | Needs verified exclusion of tests and current supply coverage |
| Request acceptance | Accepted requests from a publication cohort / eligible requests in that same cohort | Derive from bounded operational records; do not substitute period rollup ratios |
| Fulfillment | Completed acts / accepted requests whose scheduled date and agreed observation window have passed | Keep pending/future cases separate; never mark them failures prematurely |
| Time to first response and acceptance | Median and upper percentile of timestamps for the same cohort | Requires verified lifecycle records; not available from funnel counts |
| Form friction | Screen reach, blocked attempts, unsuccessful submissions and support reasons | Counts available after rollout; field/error-code breakdown is a backlog item |
| Notary activation | Approved notaries who take their first request / approved signup cohort | Inspect onboarding, availability and first action; signup alone is not activation |
| Notary participation | Eligible activated notaries responding to serviceable opportunities over 28 days | Requires opportunity/exposure denominator; inactivity without relevant demand is not churn |
| Quality guardrails | Cancellations, refunds, failed payments, complaints and time to response | Verify sources; report unavailable items rather than assumed zeros |

For clients, follow unresolved requests, successful completion, satisfaction and
referrals. For notaries, follow time to first useful opportunity, first acceptance
and ongoing participation. Repeat client business is a longer-term signal.

## Improvement queue

Prioritize observed broken paths, then the largest verified source of preventable
failure. The following are hypotheses, not findings about current customers.

| Trigger | Proposed action | Success and guardrail |
| --- | --- | --- |
| Repeated blocked Continue clicks or reported confusing questions | Improve inline guidance, required-field focus and error recovery | Fewer blocked attempts with maintained request quality; keep required business validation |
| Many form starts but little price/contact reach | Review the relevant screen with available support evidence; simplify one section | Better screen reach and confirmed publication, without hiding price/terms |
| Publication failures | Reproduce and fix the actual validation/network/backend path | Successful server writes, no duplicate requests or false success messages |
| Requests waiting with no notary response | Check territory, availability, onboarding and operator follow-up | Faster responses and acceptance; no unsupported availability promises |
| Requests approaching signature without acceptance | Surface them to the operator and verify the existing reminder workflow | Fewer unresolved requests; communications honor preferences and current rules |
| Notaries register but do not activate | Fix the first blocked onboarding or opportunity-discovery step | First accepted request, rather than signup volume alone |
| Repeated payment-return cancellations | Reconcile payment state and inspect explanation/error recovery | Verified setup/completion; never optimize against success-page visits |

Do not automate outreach from this plan. Prepare copy and operational actions
for Anthony when appropriate; sending customer messages needs explicit authorization.
Keep reminders proportionate and respect existing consent and unsubscribe behavior.

## Instrumentation backlog, in order

1. Verify rollout, collector health and clean traffic provenance; implement an
   explicit, tested separation of demo/staff/synthetic data before using it as a
   customer baseline. Check static service-page coverage too.
2. Add bounded, allowlisted error categories and screen-specific blocked reasons
   if aggregate counts cannot locate a problem. Never collect entered values.
3. Derive request and notary cohorts from existing authorized lifecycle records,
   with explicit denominators and observation windows. Avoid adding tracking IDs
   merely to make the dashboard more detailed.
4. Verify rollout of the new coarse language, device, entry-page and arrival-source
   breakdowns. Known UTM sources map to bounded categories, not full campaign
   attribution. Arbitrary URL/referrer/query values must not enter analytics.
5. Count verified card setup/payment transitions server-side using idempotent
   provider events; keep them separate from checkout-return beacons.

## Experiment discipline

Every proposed change records evidence, hypothesis, affected audience, one primary
outcome, guardrails, start date, deployed revision, observation window and rollback.
Choose one material conversion experiment at a time. With low volume, use
reproduced usability defects and permissioned feedback; do not declare statistical
winners from a few requests. Predefine baseline, detectable effect and sample size
before any randomized test. Do not repeatedly peek and stop at the first apparent
win. Before/after changes are directional evidence and can reflect channel mix,
seasonality or notary capacity rather than the UI change.

Preserve transparent prices, required questions, accessible controls and the
French/English parity. Track completion and quality so increasing low-quality
submissions cannot masquerade as a conversion win.

## Recurring operating loop

After deployment, EventBridge invokes the bounded controller every day at
13:15 UTC (09:15 America/Toronto during daylight time and 08:15 during standard
time), fifteen minutes after the reminder job.
It reads the seven most recent complete business days and the preceding seven,
using sharded counters and minimized learning signals. It requires at least 20
form starts and 10 publication attempts before it can act. When the blocked
rate, customer response delay or low feedback crosses the configured threshold,
it can enable the public guided intake mode. If the indicative publication
rate falls by more than 20% or publication failures rise by more than 10
percentage points, it rolls the mode back automatically.

Each decision is written to the single `CONFIG#EXPERIENCE` policy item and to
the append-only audit trail. The public API caches the projection for one
minute, so the daily job adds no per-visitor model call or extra analytics
query. A dry-run CLI is available for an operator before deployment. Once the
worker is deployed and its alarms are verified, daily guidance tuning does not
require a developer; model-weight changes, legal rules, notary controls,
prices and outbound campaigns remain outside this automatic write path.

The worker replaces the earlier manual weekday inspection for this narrow UX
decision. The human review loop still owns baseline interpretation, data
quality, legal changes, model qualification, releases and any action that
could affect a notary’s judgment or a customer’s legal position. Follow
AGENTS.md, preserve unrelated work, update OpenAPI for API changes, and keep
domain rules centralized when code changes are needed.

If data is missing or unchanged, do not invent conclusions or rewrite the website
to fill the schedule. Work on a verified measurement gap when useful. Notify
Anthony only about a meaningful finding, completed change, failure, or required
action; keep unchanged/non-actionable runs quiet. Record experiments as prepared,
deployed, observing, inconclusive, kept or reverted so nothing is repeatedly
implemented or claimed live before verification.
