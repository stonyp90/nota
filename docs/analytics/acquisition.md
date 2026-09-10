# Acquisition and conversion measurement

Status: first-party attribution and notification recovery are implemented. GA4 is
opt-in and dormant until `NOTA_GA4_ID` is configured and the CloudFront policy is
applied. Account creation must finish in Google Analytics before setting that ID.
No subscription, Google Ads account, paid campaign, or session replay is required.
Existing AWS request/storage/email usage still applies.

## What is measured

- Public home and all four bilingual search landing pages capture an allowlisted
  source and campaign slugs (`utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`). Do not put a person's name, email, case number, or free text in
  UTM parameters. No `utm_term`, ad click ID, raw referrer URL, or URL fragment is
  retained. Missing lead attribution is `unknown`, not assumed organic traffic.
- With consent, first touch and last non-direct touch survive a direct return for
  30 days since the last visit. Without consent, only the current page's source
  is available in memory. Landing-page CTA links preserve campaign parameters.
- `POST /bids` validates and saves attribution privately on the lead. It does not
  depend on Google, cookies, or delivery of a browser analytics event. The public
  carnet never includes acquisition data.
- First-party aggregate visits, form starts, saved requests, and accepted requests
  appear by source in the admin overview. These are event-day totals, not unique
  people, and are not a cohort conversion percentage. Requests awaiting card
  setup and requests awaiting a notary are separately visible for the current
  forward calendar month window; this is not an all-time CRM queue.
- After explicit consent, GA4 receives `page_view`, `ui_click` (link, button,
  field, background, offer_submit, main_cta, day, navigation), `form_start`,
  `form_submit_attempt`, `form_submit_error`, `generate_lead`, `begin_checkout`,
  and the supported navigation/payment-return steps. Clicks never contain element
  text, field values, link destinations, client IDs, bid IDs, or documents.
  `generate_lead` requires a real API response with a client token, not demo data.
  Payment-return events are not proof of payment or completed revenue.
- The API ignores client attempts to forge `publie` or `notaire_inscrit`.

## Activation checklist

1. Finish the free GA4 account/property for Nota, timezone America/Toronto and
   currency CAD, after the owner accepts Google's account/data processing terms.
2. Create the web stream `https://gonota.ca`. Turn **Enhanced measurement OFF**
   before loading the tag: automatic forms, history, searches and outbound link
   capture are intentionally replaced with the sanitized events above. Keep
   Google Signals, user-provided data collection and advertising integrations off.
3. Set user/event retention to 2 months. Mark `generate_lead` as a key event;
   create an event-scoped custom dimension `action` for click breakdowns.
4. Apply the reviewed `aws_cloudfront_response_headers_policy.security` CSP
   change in `infra/cloudfront.tf`, inspect the Terraform plan, then verify the
   production header. The regular GitHub deploy publishes code, not Terraform.
5. Store the actual public measurement ID as the GitHub Actions repository
   variable `NOTA_GA4_ID` and redeploy. The build rejects malformed IDs; an empty
   ID loads no Google script and displays no consent prompt.
6. In a clean browser, verify no Google requests before a choice or after decline;
   consent, click a public CTA, and verify GA Realtime. Confirm the payload has
   only a public path, generic title and bounded campaign/action values.
7. Check refusal, withdrawal and later consent; verify EN and FR. Never submit a
   real paid lead just to test analytics. Test real lead persistence in the seeded
   local stack and use production read-only verification.

## Lead reliability

A network error on a public host cannot produce a successful local/demo offer.
The form remains filled for a retry; only localhost supports the demo store.

Creation persists the lead before awaiting its confirmation and operator alert.
A client email failure does not prevent the operator alert. New open leads opt
into scheduled recovery, including those awaiting payment; legacy leads are not
replayed. The existing per-recipient sent ledger suppresses previously successful
notifications, and a completion marker stops a finished recovery sequence.
Recovery runs on the existing scheduled reminder Lambda, without adding marketing
campaigns or changing notification preferences/unsubscribe rules.

Limits: this is not an exactly-once email outbox. A provider timeout after delivery
but before the sent marker may duplicate an email. If a lead leaves the open-bid
index before recovery, the ordinary daily open-lead pass does not retry it.
A lost POST response after persistence can also make a manual retry duplicate the
lead; no creation-idempotency claim is made. Operators should inspect stored
requests before manually repeating a submission whose outcome is uncertain.
No system can identify or contact a visitor who leaves no contact information.
Ad blockers and denied consent mean GA4 will not observe every visit or click.

## Launch optimization, no ad spend

Use the same campaign `launch-2026-09` and distinct source/medium/content slugs:

| Channel | Source | Medium | Content |
| --- | --- | --- | --- |
| LinkedIn demo | linkedin | organic-social | demo-fr |
| LinkedIn English | linkedin | organic-social | demo-en |
| Partner link | partner | referral | mortgage-brokers |
| Opt-in newsletter | newsletter | email | launch-fr |
| YouTube demonstration | youtube | organic-video | walkthrough-fr |

Example: `https://gonota.ca/notaire-refinancement-quebec.html?utm_source=linkedin&utm_medium=organic-social&utm_campaign=launch-2026-09&utm_content=demo-fr`.
These are prepared links; this work does not send messages or publish posts.

Each launch day: inspect saved requests, pending-payment inventory, open requests
and notification failures first. Use GA's consented sessions for acquisition
comparisons and a sequential funnel (form_start → form_submit_attempt →
generate_lead). Investigate errors and card abandonment before increasing traffic.
Compare FR/EN pages and CTA action counts; change one message/CTA at a time.
Do not call pre/post movement a causal A/B result or optimize solely for clicks.

References: [GA tag configuration](https://developers.google.com/tag-platform/gtagjs/configure),
[privacy controls](https://developers.google.com/tag-platform/security/guides/privacy),
[GA4 data retention](https://support.google.com/analytics/answer/7667196?hl=en).

> Le pipeline opérateur et les métriques first-party sont documentés dans
> [CRM et conversion](./crm.md).
