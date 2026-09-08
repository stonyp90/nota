# Launch week — September 8–13, 2026

Owner: Anthony. Execution plan prepared September 8. This is a proposal for this
week, not a report of campaigns sent, spend incurred or customers acquired.
The older 30-day plan remains historical context; production facts below were
checked separately. Technical documentation is in English; campaign copy is fr-CA
with English adaptations.

## Decision and success measure

Launch a concierge-supported mortgage financing/refinancing marketplace in Quebec
City. Seek broad distribution through relevant channels, while matching actual
local notary capacity. Provincial traffic without available local supply wastes
money and produces disappointed customers.

Working targets, not forecasts: secure three available notaries, generate ten
real client requests, and have at least four accepted by September 13. Track
completed acts and collected Nota revenue afterward; signatures may occur after
launch week. Do not count demo offers or staff tests. Acceptance is the immediate
marketplace conversion, not a click or an account creation.

Do not change pricing for this launch. The checked-in UI and newer ADRs describe
separate notary fees and Nota service pricing; the supplied AGENTS rule still
mentions a commission. Resolve this policy discrepancy with the owner before
publishing financial claims. The copy below makes no commission claim or promise
of a guaranteed appointment, savings or legal endorsement.

## Verified baseline and remaining evidence

- September 8: direct HTTPS request to https://gonota.ca/ returned HTTP 200,
  HTML, `cache-control: no-cache`, and no X-Robots-Tag prohibition. The external
  research fetcher could not open it; that failure is not proof of an outage or
  a crawler block.
- Production robots.txt and sitemap both returned HTTP 200 on September 8.
  Crawling is allowed; the deployed sitemap still lists only the homepage.
  `https://www.gonota.ca/` redirects with HTTP 308 to the canonical origin.
  `/api/health` returned HTTP 200 and `ok: true`. Admin stays noindex.
- Search queries did not establish an indexed footprint. This is **not** proof
  that Google or Bing has zero indexed pages; only their owner consoles can
  settle that. Search Console and Bing ownership/index reports were not accessed.
- Implemented locally: four static service pages (FR/EN), reciprocal hreflang,
  self-canonicals, share metadata, factual WebPage schema, homepage links and
  sitemap entries. Full text and CTAs work without JavaScript. Prices stay in
  the live quote. Explicit .html paths fit the current S3/CloudFront deployment.
- Campaign and valid referral labels survive landing-page links. **UTM labels
  are not yet stored in the API or reported in admin.** Existing `/events`
  counters are aggregate funnel events, not unique visitors or channel cohorts.
- Prepared IndexNow ownership file and preview-first submission command. No
  submission or deployment occurred as part of writing this plan.
- Old notes about Stripe, SES, test data and notary counts are dated September
  2–4. Treat them as checks to perform, not current production findings.

## Daily execution

| Date | Owner | Deliverable and evidence |
| --- | --- | --- |
| Tue Sep 8 | Engineering + Anthony | Review these changes, finish checks, deploy via existing CI. Verify all four URLs and the sitemap on production. Anthony verifies Google/Bing property ownership. |
| Wed Sep 9 | Anthony | Confirm three real notaries, territories and actual availability. Complete one controlled end-to-end request, acceptance, email and payment-path verification. Confirm current legal review status and remove demo-only data from launch evidence. |
| Thu Sep 10 | Anthony | Publish launch post and three short explanatory clips on owned channels. Offer the prepared partner blurb to existing, permissioned broker/notary relationships. Submit sitemap and priority URLs; run IndexNow once after deployment. |
| Fri Sep 11 | Anthony | Activate a small local Search test only with an approved budget and verified fulfillment. Review search terms, form errors and every unanswered real request twice that day. |
| Sat Sep 12 | Anthony | Publish the document-preparation explainer; respond to incoming questions. Seek community-admin approval before promotional group posts. Expand only channels producing serviceable requests. |
| Sun Sep 13 | Anthony | Report spend, requests, accepted requests, pending requests, notary capacity and completed acts. Decide next week's budget from real outcomes; do not call five days of data a proven PMF result. |

## Search discovery: actual operator runbook

1. Deploy the reviewed build with the existing delivery pipeline. Fetch each URL
   in `apps/web/public/sitemap.xml`; verify HTTP 200, matching canonical, HTML
   content and no indexing prohibition in headers. Check mobile rendering and
   the CTA. Preserve the private admin noindex configuration.
2. In [Google Search Console](https://search.google.com/search-console), verify
   the `gonota.ca` domain property using Google's actual DNS token, then submit
   `https://gonota.ca/sitemap.xml`. Inspect the homepage and four new pages and
   request indexing. Save the submission date and actual reported status.
3. In [Bing Webmaster Tools](https://www.bing.com/webmasters/), verify/import the
   property and submit the same sitemap. Inspect crawl/index reports.
4. Preview: `node apps/web/scripts/submit-indexnow.mjs`. After deployment:
   `node apps/web/scripts/submit-indexnow.mjs --submit`. The command verifies
   the live ownership file and every canonical before sending. Record the
   actual response. HTTP 200/202 acknowledges receipt, not ranking.
5. Bing discovery also matters for DuckDuckGo, which says traditional results
   largely come from Bing. IndexNow shares submissions among participating
   engines; it does not replace Google Search Console. For Brave and other
   independent indexes, retain crawlable HTML and earn relevant public links;
   do not claim a universal submission or guaranteed inclusion.
6. For answer engines, use the same visible, factual pages and crawl access.
   Existing llms.txt is a discovery aid, not a ranking contract. Review citations
   manually for the actual financing/refinancing queries in FR and EN.
7. Check Google/Bing reports daily during launch and weekly afterward. Save
   impressions, clicks, queries, indexed URLs and chosen canonicals. Use a fixed
   Quebec City location/device when observing rankings; do not mistake a `site:`
   search for an exhaustive index report.

Query-to-page mapping:

| Intent | Landing page |
| --- | --- |
| notaire refinancement Québec; refinancement hypothécaire notaire | `/notaire-refinancement-quebec.html` |
| notaire financement Québec; notaire prêt hypothécaire Québec | `/notaire-financement-quebec.html` |
| mortgage refinancing notary Quebec City | `/mortgage-refinancing-notary-quebec-city.html` |
| mortgage financing notary Quebec City | `/mortgage-financing-notary-quebec-city.html` |

Do not create near-identical suburb pages or advertise services outside the
current catalogue. Next useful content: a real, anonymized customer journey
with permission and verified timings; a quote explainer grounded in the live
pricing; notary onboarding answers. No invented reviews or aggregate ratings.

## Distribution and proposed budget

No advertising spend is authorized or committed by this document. Until Anthony
chooses a budget, use the zero-dollar scenario. No email/message to another person
has been sent by this task.

| Channel | Audience, action and destination | First decision |
| --- | --- | --- |
| Existing notary pipeline | Reconfirm availability; invite to `/?lang=fr#t=notaires`. The 37-contact sheet is a historical prospect list, not 37 partners. | Three available notaries before scaling demand. |
| Mortgage brokers / existing partners | Useful financing/refinancing explainer and corresponding service page; use each partner's actual issued referral code. | Track accepted referrals, not just introductions. |
| Google Search | Quebec City presence targeting; phrase/exact high-intent FR/EN groups; distinct service pages. | Inspect terms daily and exclude irrelevant queries. |
| Microsoft Search | Same intent/territory after initial Google signal or where account data supports a test. | Compare qualified requests, not CPC alone. |
| LinkedIn, Facebook, Instagram | Founder explanation, one walkthrough, one FAQ clip, captions and link to the matching page. | Record reach and outbound clicks separately from conversions. |
| Local community groups | Educational post only where admins permit; answer real questions without unsolicited promotion. | Stop if audience cannot be served locally. |
| Local media / industry newsletters | Draft pitch: local marketplace launch, how requests work, founder available for interview. | Send only after explicit outreach authorization; no invented adoption numbers. |

Illustrative caps: at $500 total, reserve $350 for Google Search and $150 for
Microsoft Search; at $1,500, start with the same $500 and release the remaining
$1,000 only after validating real acceptance and economics. These are planning
amounts, not market CPC estimates. Zero paid social/retargeting in the initial
budget; use organic clips first. Configure platform spending limits before any
activation. Do not install advertising pixels without reviewing consent behavior.

Initial negatives to review: emploi, salaire, stage, formation, cours, testament,
succession, divorce, procuration, gratuit (review actual intent before excluding),
Montréal, France. Never exclude a service query merely because it has a low CTR.

Stop a channel for broken submission/payment, out-of-territory demand, or exhausted
notary capacity. If the first five genuine requests all remain unaccepted after
the agreed follow-up window, pause paid acquisition and fix fulfillment. Review
any ten-request cohort with fewer than four acceptances; the sample is small and
this is an operational trigger, not a statistical conclusion.

## Conversion and measurement

The landing page answers service, geography, price process and date uncertainty,
then gives one primary action. It sends visitors to the carnet with `#t=carnet`,
bypassing the first-visit introduction gate. The service still needs selection
inside the carnet; automatic service/date preselection is not implemented.

Existing observable funnel: `visite`, `jour_ouvert`, `formulaire`, `publie`,
`paiement_ok` / `paiement_annule`; notary events are separate. `publie` is counted
server-side. These are events, not a deduplicated visitor funnel; do not divide
cross-day counts and label the result a precise cohort conversion rate.

Use the companion daily scorecard. Unknown values stay blank. For the first ten
requests, an operator follows each real dossier through acceptance and completion.
Use internal IDs in a restricted operational record; never put personal client
information in this public repository. Ask the acquisition source in the normal
follow-up and mark it self-reported. Issued referral codes provide a separate
existing source signal. Do not invent referral codes for UTM campaigns.

UTM naming: `utm_source=google|bing|linkedin|facebook|instagram`,
`utm_medium=cpc|social`, `utm_campaign=lancement_quebec_202609`,
`utm_content=refinancement_a|financement_a|fondateur_a`.
Example: `https://gonota.ca/notaire-refinancement-quebec.html?utm_source=linkedin&utm_medium=social&utm_campaign=lancement_quebec_202609&utm_content=fondateur_a`.
No names, emails, mortgage details or free-text client data in URLs.

Daily formulas: acceptance = accepted genuine requests / genuine published
requests in the same cohort; cost per published request = channel spend /
attributed genuine requests; cost per accepted request = spend / attributed
accepted requests. Zero denominator means unavailable, not zero cost. Revenue is
Nota revenue actually collected, not notary fees, GMV or an authorized card.
Allowable acquisition cost = collected net Nota revenue minus variable costs,
refunds and target contribution, using actual billing data. Attribution is
provisional until channel data is persisted through the server funnel.

Prioritized follow-up experiment: current generic hero versus service-specific
wording, keeping price disclosure and date caveats identical. Choose one variant
at a time until traffic supports a real controlled test. Do not declare a winner
from a handful of clicks. Diagnose mobile form errors before changing prices.

## Publication-ready drafts — not sent

**Founder post — FR**

Vous cherchez un notaire à Québec pour un financement ou un refinancement
hypothécaire? Avec Nota, vous proposez votre date et votre offre. Un notaire peut
accepter votre demande ou vous faire une contre-offre. Publier une demande est
gratuit; consultez le devis et les conditions dans le carnet. La date reste à
confirmer avec le notaire. Découvrez le fonctionnement :
https://gonota.ca/notaire-refinancement-quebec.html

**Founder post — EN**

Looking for a notary in Quebec City for mortgage financing or refinancing?
With Nota, you propose your date and offer. A notary can accept your request or
make a counter-offer. Posting is free; review the quote and terms on the public
board. Your date must still be confirmed with the notary. See how it works:
https://gonota.ca/mortgage-refinancing-notary-quebec-city.html

**Search ads — FR**

Headlines: « Notaire à Québec »; « Refinancement hypothécaire »;
« Proposez votre date ».
Description: « Proposez votre date et votre offre. Consultez le devis avant de poursuivre. »
Financing variant: « Financement hypothécaire », matching financing landing page.

**Search ads — EN**

Headlines: “Quebec City Notary”; “Mortgage Refinancing”; “Propose Your Date”.
Description: “Post your date and offer. Review the quote and terms before proceeding.”
Financing variant: “Mortgage Financing”, matching English financing page.
Review the actual platform preview and character limits before activation.

**Partner blurb — FR / EN**

« Votre financement avance? Nota vous permet de proposer une date et une offre
à des notaires de la région de Québec. Consultez le fonctionnement et le devis
avant de publier votre demande. »

“Moving forward with mortgage financing? Nota lets you propose a date and offer
to notaries in the Quebec City area. Review how it works and the quote before
posting your request.”

**Three short videos**

1. Show service → date → quote; FR: « Voici comment proposer votre date. »
   EN: “Here is how to propose your date.” Show demo data explicitly labelled.
2. Explain the quote, using current product values only; FR: « Ce que le devis
   comprend. » EN: “What your quote includes.” No fabricated saving comparison.
3. Explain acceptance; FR: « Une demande n’est pas une réservation confirmée. »
   EN: “A request is not a confirmed booking.” End at the matching service page.

## Sources checked September 8

- [Google: request recrawling](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl): discovery may take days or weeks; indexing is not guaranteed.
- [Google: localized versions](https://developers.google.com/search/docs/specialty/international/localized-versions): distinct language URLs and reciprocal annotations.
- [IndexNow protocol](https://www.indexnow.org/documentation): ownership verification, submission responses and sharing among participants.
- [DuckDuckGo result sources](https://duckduckgo.com/duckduckgo-help-pages/results/sources): relationship with Bing and other sources.
- [Perplexity and robots.txt](https://www.perplexity.ai/help-center/en/articles/10354969-how-does-perplexity-follow-robots-txt): crawler access; no promise of citation.

## Local validation

Domain: 364 tests; API: 1,532; web: 791; admin: 221, all passing.
BDD: 186 scenarios / 1,069 steps passing. All 51 Playwright end-to-end tests pass.
Public and admin builds pass.
Browser: French desktop, English at 390 px without horizontal overflow, language
switch, campaign preservation and direct carnet access verified. These results
do not replace production payment/email validation or search console evidence.
