# Launch activation — September 8, 2026

Paid media budget: **CAD 0**. Owner explicitly authorized deployment.

## Deployment

- PR [#3](https://github.com/stonyp90/nota/pull/3) merged.
- Production revision: `20fc305e4873d93b7f8cf97629e24fa850dd8253`.
- [Production delivery](https://github.com/stonyp90/nota/actions/runs/34222788916): success, including unit/API/web/admin/BDD, Terraform and Playwright gates.
- Homepage, four static FR/EN service pages, sitemap, robots, IndexNow key and hashed homepage assets return HTTP 200 and match an isolated build of that revision byte-for-byte. API health returns `ok: true`.
- Requests identifying as Googlebot, bingbot, OAI-SearchBot and PerplexityBot received the matching page and HTTP 200. This tests response handling for those user-agent strings, not an actual visit from their crawler IPs.
- The shared working directory acquired unrelated edits during delivery. Verification used a separate archive of the deployed commit; those edits were not reverted or included in this deployment.
- Machine-readable evidence: [production checks](2026-09-08-production.json).

## Search activation

| Service | Confirmed result |
| --- | --- |
| Google Search Console | URL-prefix property `https://gonota.ca/` verified using Google's supplied HTML tag. |
| Google sitemap | `https://gonota.ca/sitemap.xml` submitted successfully; status Success, five discovered pages. |
| Google priority indexing | All five URLs received an individual “Indexing requested” confirmation and were added to the priority crawl queue: homepage, both French service pages and both English service pages. |
| Bing Webmaster Tools | Site verified using Bing's supplied HTML tag; authenticated site dashboard available. |
| Bing sitemap | Submitted September 8; status Processing, one known sitemap, zero listed warnings/errors at submission. Discovered count still pending. |
| IndexNow | POST acknowledged with HTTP 202 for all five public URLs. Initial ownership validation/processing pending; receipt is not indexing. |

Google's initial homepage inspection reported “Discovered - currently not indexed”.
No ranking, organic traffic, conversion uplift or completed customer act is claimed.
New Google reports say data is processing; Bing reports may take up to 48 hours.

IndexNow distributes to participating engines; it is not a universal search-engine
submission service. [Protocol FAQ](https://www.indexnow.org/faq).

## Distribution and follow-up

- Paid advertisements: none created or activated; no advertising expenditure.
- Social posts, partner messages and emails: none sent. Official social-account links and explicit publication authorization were requested asynchronously.
- Ready-to-publish FR/EN copy and the zero-budget execution plan remain in [the launch plan](../launch-week-2026-09-08.md).
- Bing Site Scan offered zero pages of quota, so no audit was started. This does not prevent sitemap submission or indexing.
- Next measurement: actual indexed pages, search impressions/clicks, real requests, acceptance and completed acts. Do not substitute submission counts for audience or revenue.
