# Behavior review log

## September 9, 2026 — device and arrival-source extension

- Added bounded browser/OS/device classification on the server and viewport,
  language, arrival source, entry page, dialog/storage capability and load buckets
  from the browser. Unknown values are ignored. No raw UA, full URLs, error text
  or customer identifiers are stored in these counters.
- Static service pages now emit visits and marketplace-link clicks; bounded
  source/entry categories survive navigation to the app and accompany publication
  and notary-signup requests. Server outcomes remain authoritative.
- Admin now displays independent segment counts with bilingual labels; no
  retrospective backfill or unique-visitor/cohort claim.
- Added once-per-page JavaScript/unhandled-rejection indicators and bucketed
  Navigation Timing measurements. These are not Core Web Vitals.
- Compatibility matrix passed 18/18 local scenarios across desktop Chromium,
  Firefox, WebKit, iPhone, Android and iPad emulations. Physical-device checks
  remain pending. See [coverage and interpretation](browser-experience-plan.md).
- Updated the existing active weekday review to inspect these segments and
  prioritize reproducible compatibility, speed and conversion defects.
- Validation: domain 368, API 1,551, web 798 and admin 224 tests passed;
  BDD 192 scenarios / 1,088 steps and both builds passed. Additional targeted
  checks passed for timing (4) and authoritative publication/signup attribution
  (14). The full browser run passed 68/69; its remaining test waited for all
  network activity despite excluding external resources from its contract.
  After narrowing that wait to Nota requests, the affected test passed on rerun.
  The compatibility matrix itself passed all 18 cases in both runs.
- Production deployment and live baseline remain unverified; no conversion
  improvement is claimed from these local tests.

## September 9, 2026 — measurement audit

- Source: current local repository, not live customer data. Existing unrelated
  Stripe and launch work was already present in the working tree.
- Production access: `aws-prod` STS check failed because its SSO token is missing.
  Reading `https://gonota.ca/app.js` returned HTTP 403 from this environment.
  This does not establish that the website is down for customers.
- Production baseline, real lead count, churn rate and conversion lift: unavailable.
- Confirmed code findings: the API supplies aggregate funnel counts but the admin
  overview did not render them; checkout returns were labeled as card authorizations;
  the public beacon accepted server-only publication/signup names; form-stage
  and failure observations were missing.
- Prepared changes: expose the aggregate funnel in admin with measurement limits;
  correct payment labels; reject server-only names at the beacon; instrument
  questions/price/contact reach, blocked Continue, publication attempts and failures.
  No customer identifiers or form values are added to event bodies.
- Deployment: not performed. New counters begin only after deployment and verified
  collection. Historical counters cannot be reclassified as unique customers.
- Next required action: restore authorized production access (for the configured
  profile, `aws sso login --profile aws-prod`), or supply an authenticated aggregate
  overview export with its dates, source and test-data exclusions. Never put tokens
  or personal customer data in this log.
- Next analysis: establish the clean baseline and current notary capacity, then
  choose the first experiment using the [operating plan](behavior-conversion-strategy.md).
- Schedule: active task heartbeat `improve-nota-conversion-and-retention`, weekdays
  at 09:00 America/Toronto, with a deeper weekly comparison on Monday (or the next
  successful run). Unchanged, non-actionable runs stay quiet.
- Validation: focused coverage passed (47 tests; the strengthened web-only
  rerun passed 20). Domain 365, API 1,542, admin 223, BDD 188 scenarios / 1,076
  steps passed; public and admin builds passed. No lint script is configured;
  whitespace checks passed.
- Full web run: 767/793 passed, 26 failed while another task was adding offer
  expiration in this shared tree. The unchanged HEAD passes the 138 tests in
  the two affected files. An isolated copy of the concurrent tree with only
  this task's instrumentation removed reproduces the failures; the expiration
  changes filter fixtures that those tests expect. Preserve that work and require
  a green combined web suite before release. These results describe the revisions
  checked, not a guarantee about subsequent concurrent edits.
