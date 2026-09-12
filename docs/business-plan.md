# Nota — Business Plan

**A market for urgent notarial acts, followed by tools that reduce preparation work.**

info@gonota.ca

**https://plan.gonota.ca/**

**Proposed raise: 250 000 $ pre-seed.** Product development and public deployment are evidenced; repeatable paid demand, live settlement and professional launch clearance are not established by the reviewed records. The financing scenario targets 244 completed acts and approximately 80 813 $ of Nota revenue in Year 1. These are targets, not traction.

This revision reconciles the four-service code catalogue, published fee grid, referral accrual, market arithmetic, payment costs, completion funnel and funding requirements. It replaces the previous claim that approximately 240 000 $ funds the business through Year 3. Under the revised base assumptions, approximately **430 119 $**, including a 25 000 $ planning reserve, is required at the worst annual endpoint; monthly timing beyond Year 1 could require more.

[French executive summary](plan-affaires-sommaire.md) · [Financial model and monthly cash](planning/business-plan-model.json) · [Review and outstanding evidence](planning/business-plan-review-2026-09-09.md)

## 1. Executive summary

**Nota starts with an urgent need for a notary and aims to become the continuous workflow from request to signed act.** A dated, structured request helps an eligible notary identify work they can take on. The next layer reduces repeatable preparation; the third connects authorized electronic signing to the prepared file. Clients gain a clearer next step, practices gain usable capacity, and Nota can develop recurring software use beyond the initial match.

The strategy has three product stages, with geography advancing only when each local workflow is validated:

1. **Connect urgent clients and available notaries.** Start with financing and refinancing in the Québec City metropolitan area. Qualify the need, make the date and complete price clear, and measure whether an eligible notary actually serves the file on time.
2. **Automate repeatable preparation.** Target an 80% reduction in human time on a defined preparation scope, including review and corrections. This is an unproven product objective, not an observed reduction in 80% of the notary’s entire job. Legal advice, judgment and responsibility remain with the notary.
3. **Offer an integrated electronic signing journey.** Carry a validated file through identity checks, consent, authorized signing and preservation. Electronic notarial signing already exists; Nota’s intended value is continuity and fewer handoffs. The current signing room is a rehearsal, with production integrations and approvals still to establish.

The observed starting pool is **10,271 residential resales in the Québec City CMA, 97,214 in Québec province and 470,314 across Canada in 2025**. These nested counts are not added and are not all eligible or urgent notarial files. Section 5 converts the local pool into an explicit, testable acquisition scenario. The longer-term software reference pool includes **2,659 Québec notaries in traditional practice** and **nearly 50,000 notaries across the CNUE’s EU membership**. This is professional-market context, not contracted seats or validated software revenue.

The proposed **250 000 $ operating envelope** funds a 12-month pilot. The existing base model targets 244 completed financing/refinancing acts in Year 1 and approximately 80 813 $ of Nota revenue. These are assumptions, not commercial traction. The illustrative 205-act local market calculation in §5 is a separate annual sale-linked financing example; it is not a second Year 1 forecast.

The base case ends Year 1 with about 45 377 $ cash. At least approximately 180 119 $ of additional capital is indicated by the modeled year-end deficits and reserve, before unmodeled obligations and within-year cash troughs. Later hiring remains conditional. No AI subscription or signing revenue is included in the financial forecast.

The current documentation model distinguishes the notary’s agreed professional fee from Nota’s client service/date fees. A conflicting commission-only repository policy remains unresolved in §7. This revision changes the investor narrative and market evidence, not the legal status or production billing rules. The investable proof is a fulfilled local cohort, sound unit economics and measured preparation savings.

## 2. Customer problem and value proposition

**Initial customer.** A Québec City homeowner or buyer with an approved financing need, a real lender or transaction deadline, and enough documentation for a notary to assess feasibility. A renewal alone does not necessarily require a new notarial act. Intake must distinguish simple renewal, refinancing, lender transfer, new hypothec and any separately required sale act.

The working problem hypotheses are that customers struggle to locate suitable near-term capacity, compare the complete price and determine which documents are missing. Notaries may value qualified incremental work that fits existing capacity. The plan does not claim that every notary has unused capacity, that urgency always commands a premium, or that online competitors do not exist.

| Participant | Value to test | Evidence needed |
| --- | --- | --- |
| Client | Find an appropriate notary before the deadline, with a comprehensible quote and next steps | On-time paid completions, abandonment reasons, total-price comprehension |
| Notary | Optional incremental work, full agreed honoraires, fewer preparation loops | Acceptance, repeat participation, preparation time and net incremental benefit |
| Referral partner | A useful destination for an eligible client, with disclosed reward terms where permissible | Attributed settled acts, partner activation, complaint and cancellation rates |
| Nota | Earn its own fee while delivering reliable matching and preparation | Contribution after payment, service, acquisition and loss costs |

One additional standard financing per month at the current starting professional fee represents 21 600 $ in annual **gross professional fees**; refinancing represents 24 000 $. These are arithmetic illustrations before notary expenses and taxes, not predicted income. The product must demonstrate genuinely incremental work rather than simply move existing clients onto a paid channel.

**Validation plan.** Interview at least 10 notaries and 10 eligible clients or recent borrowers, document actual recent workflows and rejected requests, then follow the first 30 real eligible requests to their outcome. These are proposed discovery targets. Separate interview enthusiasm from commitments, accepted requests and paid completion. Review [notary interviews](go-to-market/entrevue-notaire.md) and the [30-day validation plan](go-to-market/plan-pmf-30-jours.md).

## 3. Product and current catalogue

### 3.1 Prices and the date mechanism

The following table is generated from the current domain defaults. Starting fees are product inputs, not evidence of market-clearing prices. Production admin overrides and a customer's frozen quote can differ; the dated September 8 production receipt verified the two financing tariffs, not deployment of all subsequent code changes.

<!-- MODEL:catalogue -->
<!-- /MODEL:catalogue -->

<!-- MODEL:tiers -->
<!-- /MODEL:tiers -->

The date addition belongs to Nota. The suggested urgency multiplier affects the offered notary fee. They must remain distinct. The notary assesses the facts, fee and feasibility independently; an urgency band is not a finding that an act can safely close in that time. The domain enforces a starting floor and a five-times premium cap. Criteria can increase the base, so that cap does not bound collection losses adequately by itself.

A client-facing quote must identify the suppliers, services, Nota fee, any date fee, taxes and disbursements or their explicit exclusions. A requested date and a notary's acceptance are different states. The scope and remedy of any “date guarantee” require approved terms and measured capacity before it is marketed as guaranteed performance.

### 3.2 Workflow and boundaries

The intended journey is qualification → itemized quote → request posted → notary assessment and acceptance → complete dossier → professional act → payment capture, transfer and reconciliation. Counter-proposals, missing documents, failed authorizations, cancellation and unfilled deadlines require explicit recovery paths.

The domain and API enforce shared prices and offer validation. The bilingual public UI and private admin console have zero runtime dependencies. These architectural choices support maintainability; they do not make a new jurisdiction, regulated act or external integration merely a data change. Each requires its own rules, contracts, operating process and verification.

An acte de vente is not a current catalogue service. A financing request attached to a purchase must clearly identify whether another notary or workflow handles the sale, publication and funds. Wills and powers of attorney have separate capacity, consent, scope and possible protection-mandate questions. Do not treat their preparation as a financing template with a new label.

## 4. Evidence of readiness and traction

This plan reviews repository files and dated release reports. It does not certify the current live environment or inspect the company's bank account, customer ledger or signed contracts.

| Area | Evidence reviewed | What remains unproven |
| --- | --- | --- |
| Public product | September 8 release, production checks and search submissions | Paid demand, actual indexing/ranking and customer outcomes |
| Payments | Real Stripe sandbox checkout, capture, transfer, reversal and refund; live secrets staged | Live activation, bank payout, recovery cases and correct merchant branding |
| Tax | Operator registration evidence recorded September 8; product discloses exclusions | Tax calculation/collection and responsibility for notaries' separate supplies |
| Four-service catalogue | Current domain definitions and service-specific preparation tests | Deployment parity and professional validation for every service |
| Signing room | September 9 working rehearsal, with synthetic ceremony and evidence receipt | Legally operative notarial signing, provider authorization and archival compliance |
| AI preparation | Structured, source-cited preparation and synthetic tests | Passing live extraction evaluation and measured professional time savings |
| Acquisition | Search Console/Bing setup and submitted public pages | Organic traffic, CAC, partner conversions and repeat notary activity |

Sources: [launch evidence](go-to-market/launch-evidence/2026-09-08-activation.md), [payment readiness](qa/2026-09-08-stripe-production-readiness.md), [working rehearsal](signing-beta-release.md), [Bedrock verification](ai/bedrock-verification-2026-09-09.md), [four-service evaluation](ai/notary-ai-evaluation-2026-09-09.md).

**Traction reporting rule.** No verified commercial count is supplied here. Keep signups, verified providers, active providers, requests, acceptances, completed acts and settled revenue separate. Demo fixtures, test payments, rehearsal signatures and search submissions never count as customer traction.

## 5. Market and competition

### 5.1 Observed market: Québec City, Québec and Canada

Use a consistent annual transaction unit for the initial real-estate financing opportunity:

<!-- MODEL:market -->
<!-- /MODEL:market -->

The [APCIQ 2025 annual release, published January 13, 2026](https://apciq.ca/ventes-residentielles-le-quebec-enregistre-sa-troisieme-meilleure-annee-en-2025/) reports the Québec figures; the [CREA January 15, 2026 annual release](https://www.crea.ca/media-hub/news/home-sales-in-canada-end-2025-quietly/) reports the Canadian figure. Québec City means the **census metropolitan area**, not just the municipality. Québec data cover Centris residential resales; the Canadian figure covers MLS transactions. The province is included in Canada and the CMA is included in the province. Do not sum them.

These transactions form an **observed demand reference pool**, not Nota’s revenue market or a count of urgent cases. A transaction may generate several legal steps, may not require a new mortgage, may already have a notary, or may fall outside Nota’s supported workflow. Refinancing outside a resale, new construction outside these listing systems, wills and powers of attorney are excluded from this transaction baseline. No public annual count of Nota-eligible urgent requests or refinancing acts has been verified in this revision.

### 5.2 From a reference pool to a serviceable pilot

Define the serviceable pool as observed transactions × the share requiring the supported service, within the serviced geography, with an unfilled need and realistic availability. The **10% qualifiable share is a hypothesis combining these filters**; it is not an observed urgency rate. Count a file once. Measure each filter in the pilot and replace the combined assumption with evidence.

An illustrative annual scenario is **10,271 × 10% qualifiable × 25% captured × 80% completed = 205 completed sale-linked financing files**. Holding the last two rates constant, a 5%, 10% or 20% qualifiable share gives approximately 103, 205 or 411 completions. All three rates are assumed. The 80% completion assumption is separate from the 80% preparation-automation target.

The financial forecast’s 244 Year 1 completions include financing **and refinancing**, with a month-by-month ramp. They are not obtained by adding this 205-act illustration. Retain the forecast as a pilot planning case until the actual pipeline, qualifying share, timing and refinancing demand are measured. Year 3’s 11,000 completions demand substantial provincial distribution and capacity; the old “10% of 110,000 acts” justification is withdrawn because that denominator was unverified.

### 5.3 International opportunity: software for the profession

For stages 2 and 3, the unit becomes a supported practice workflow and its active users, rather than an urgent transaction. At March 31, 2025, Québec had **3,846 registered notaries, including 2,659 in traditional practice**. These are individual professionals, not firms or paid seats. [Chambre des notaires annual report 2024–2025, p. 11](https://www.cnq.org/wp-content/uploads/2025/11/610666-CDN_Rapport-annuel-2024-2025_Final.pdf#page=11).

The **CNUE represents 22 member notariats and nearly 50,000 notaries across the EU**, providing a relevant international software reference pool. [CNUE annual report 2024, p. 16](https://www.notariesofeurope.eu/wp-content/uploads/2025/02/CNUE-Annual-Report-2024.pdf#page=16). The **UINL has 93 member notariats** globally. This establishes geographic breadth, not permission to launch or a global revenue estimate. [UINL institutional overview, accessed September 12, 2026](https://uinl.org/mission/about-us/).

Do not add overlapping professional populations or multiply global membership by Québec fees. Canada outside Québec also has different legal roles, providers and rules; Canadian home sales are context, not a homogeneous notary market. For each expansion candidate, validate provider scope, language, data residency, document formats, signing and retention requirements, distribution, procurement and willingness to pay. Begin with one local professional partner and a defined act type. France is a possible research candidate because of its language and civil-law notariat, not a committed launch market.

A future software revenue model must use **eligible organizations × adopted organizations × paid seats per organization × net annual price**, with explicit churn, support and integration costs. No validated subscription price or adoption rate is available, so no software ARR or global TAM in dollars is represented as fact. The opportunity is meaningful because the same practice handles repeatable work beyond urgent clients; the size of Nota’s accessible paid portion remains to be established.

### 5.4 Competitive position

The sector is already digitizing. Québec notaries can [sign electronic acts in the office](https://www.cnq.org/votre-notaire/un-professionnel-numerique/signer-un-acte-notarie-technologique-au-bureau-du-notaire/). In France, the CSN announced an [18-month Mistral AI and Scaleway partnership on July 9, 2026](https://www.csn.notaires.fr/fr/actualites/intelligence-artificielle-le-conseil-superieur-du-notariat-choisit-mistral-ai-et). Nota cannot claim to invent electronic signing or to be the only notarial AI initiative.

The intended differentiation is the **connection between a deadline signal, qualified demand, reviewed preparation and file completion**. Directories compete for discovery, practice-management and AI tools for workflow, and signing providers for execution. Nota should integrate where appropriate and win on fulfillment, measurable time savings and retained usage. Distribution relationships and a permissioned, reviewed feedback process may become advantages; they are not established network effects or an uncopyable moat today.




Notairo currently advertises online preparation, availability checking and in-person signing for property transactions. Its public starting price for refinancing is 949 $, excluding taxes and disbursements, with possible additional charges for urgency or complexity. That package is not directly comparable with Nota's platform fee alone. The previous 295 $ intake-fee comparison is removed because it was not substantiated by the current homepage. [Notairo, checked September 9](https://notairo.com/).

| Alternative | Competitive implication | Nota's proposed response |
| --- | --- | --- |
| Traditional practice and an existing referral relationship | Trust, continuity and direct access may outweigh switching | Demonstrate incremental availability and simpler qualification |
| Online closing/intake platforms such as Notairo | Digital intake and advertised prices already exist | Prove the value of a date-specific request and provider response mechanism |
| Practice software and signing providers | Notaries already depend on established tools | Integrate reviewed work packets rather than require wholesale replacement |
| General legal-document tools | Some customers primarily want a document, not urgent professional capacity | Qualify the need and avoid acquiring unsuitable demand |

Nota's proposed differentiation is explicit deadline-based demand, optional provider response and a transparent Nota fee. Claims of being the only marketplace, having no price-discovery competitors, or being impossible to copy are removed. A competitor's operating model does not establish legal approval of Nota's.

Defensibility must be earned through provider retention, repeat partner distribution, reliable operations and lawful aggregated outcome data. A proposed urgency curve is not an existing proprietary asset. Publish it only with adequate sample sizes, privacy protection and controls for service complexity and selection bias.

## 6. Go-to-market and measurable liquidity

**Supply first.** Concentrate on Québec City financing/refinancing, with named service coverage and a fallback for a declined or unfilled request. Target 30 recruited providers, at least 25 verified and configured, then measure how many respond and complete work. Wills and powers of attorney receive separate validation cohorts and no assumed contribution to the financing targets.

**Demand channels.** Mortgage brokers and real-estate brokers can introduce clients at a real transaction milestone. Organic service pages can build demand over time. Paid search should target demonstrably eligible intent after fulfillment and contribution are understood. Organic content and partnerships consume staff time; neither is zero-cost acquisition.

### 6.1 Referral economics and operating terms

The domain specifies 50 $ for a referred client and 250 $ for an activated referred notary. These rewards come from Nota's acquisition resources, not a deduction from professional fees. However, the current `referralLedger` accrues the client reward when status is retained, and the notary reward when `premierActe` is present. **The code does not demonstrate a settlement-only reward gate.**

Before launch, reconcile eligibility, earning event, payout event, cancellations, refunds, duplicate/self-referrals, disclosure and professional permissions in both terms and implementation. Preserve obligations already incurred. The financial model includes rewards inside acquisition budgets, not as a second expense below those budgets.

With the Year 1 target of 307 retained requests, rewarding every one would consume 15 350 $ of the 40 000 $ client-acquisition envelope even though only 244 complete. Rewarding all 30 recruited notaries would consume 7 500 $ of the 15 000 $ supply-acquisition envelope. These are upper-bound budget illustrations, not expected referral shares. An unimplemented settlement-only policy cannot be assumed to save those costs.

### 6.2 Funnel and measurement definitions

| Metric | Definition and purpose |
| --- | --- |
| Eligible visitor → qualified request | Use a stable cohort and remove test, duplicate and ineligible traffic |
| Acceptance rate | Requests receiving a confirmed notary acceptance ÷ eligible posted requests |
| Completion after acceptance | Completed professional acts ÷ accepted requests, after the observation window matures |
| Paid completion rate | Completed, successfully collected acts ÷ eligible posted requests |
| Time to first qualified response / acceptance | Median and 90th percentile, separated by service and urgency |
| On-time fulfillment | Completed by the agreed deadline ÷ matured accepted cases with a deadline |
| Net contribution per eligible visitor | Revenue less payment, service, acquisition and realized loss costs, divided by eligible visitors |
| Active supply | Verified notaries with a recent substantive response; completions reported separately |
| CAC | All attributable acquisition spend, rewards and labor ÷ new paid customers; allocate costs once |

The finance model now distinguishes 534 posted, 307 retained and 244 completed requests in Year 1: approximately 57.5% acceptance and 79.5% completion after acceptance. Retention is not the same as revenue. Follow cohorts to maturity and show failures, pending files and refunds explicitly.

**Proposed release of acquisition spend.** Start with a 5 000 $ discovery/controlled-acquisition tranche inside the existing 40 000 $ envelope. Release more only after launch gates clear and the first 30 matured eligible requests show a viable acceptance-to-paid-completion path with positive expected contribution. Treat that sample as diagnostic, not proof of PMF or statistical certainty. Review weekly; pause the affected campaign or segment if contribution is negative or deadlines repeatedly fail.

## 7. Professional, tax and payment launch gates

The separate Nota fee replaces the retired professional-fee share in the current code and later decisions. The repository's AGENTS.md still describes an older commission model. That contradiction needs a separately reviewed governance update; this document does not silently change repository instructions or revive the old arrangement.

Québec's Loi sur le notariat, art. 32.1, regulates specified intermediary arrangements. Keeping a notary's fees whole does not by itself resolve every question under that provision. Art. 46 allows a notary to authorize remote signature exceptionally on a party's request when the circumstances and parties' interests permit. An interface cannot grant that authorization. [Loi sur le notariat](https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3).

Professional independence, fee sharing, third-party benefits/disclosure, advertising and fee reasonableness require review under the Code de déontologie, including arts. 29.1, 32–34, 49 and 70–72. A published software subscription, separate fee or referral reward is not automatically compliant because of its label. [Code de déontologie des notaires](https://www.legisquebec.gouv.qc.ca/fr/document/rc/N-3,%20r.%202).

| Gate | Accountable role | Required evidence before the dependent launch |
| --- | --- | --- |
| Commercial model and referral program | Founder + retained Québec counsel | Written opinion covering actual contracts, fee flow, rewards, advertising and date promise |
| Tax and invoicing | Founder + accountant | Correct supplier identities, tax treatment, invoice responsibility, tested quote/capture/refund accounting |
| Provider eligibility | Notary advisor + operations | Identity and current professional status verified; suspension/removal procedure |
| Live payments | Founder + payment operations | Correct merchant brand, active configuration, eligible connected account, controlled capture/transfer/payout and recovery evidence |
| Loss-making offers | Founder + engineering | Supported collection/eligibility policy before commitment; measured costs and explicit exception handling |
| Signing | Notary advisor + authorized providers | Applicable professional requirements, approved provider arrangements, retention and legally operative ceremony verification |
| Privacy and security | Named privacy lead + counsel | Data map, rights/access/retention procedures, vendor terms, cross-border assessment, incident and restore exercises |

The payment receipt records operator tax registrations but still identifies collection implementation and the notary-supply model as unresolved. Describing taxes as excluded is disclosure; it is not implemented tax collection. [September 8 readiness](qa/2026-09-08-stripe-production-readiness.md).

The signing room is an internal rehearsal and does not complete an act, charge the client or establish CNQ approval. Hosting in Canada and passing tests do not establish complete Law 25 compliance or SOC 2 certification. [Rehearsal boundaries](signing-beta-release.md), [privacy and legal materials](legal/README.md), [SOC 2 gap analysis](compliance/soc2-gap-analysis.md).

## 8. Business model and unit economics

### 8.1 Revenue and collection costs

Nota's revenue is its own earned fee. Professional fees passed to notaries, collected tax and other third-party amounts must be tracked separately. The simplified planning model recognizes Nota fees on completed paid acts; an accountant must confirm gross/net presentation, recognition, refunds and any contingent liabilities under the final contracts.

**Future model-enabled monetization.** Once the proprietary models pass a notary-reviewed, held-out validation by act type and the commercial and professional gates are closed, Nota can introduce a separate software subscription or usage fee for the model-enabled preparation layer. The subscription path is intended for notaries who want the product without a direct feedback commitment. A deeper collaboration path may use a potential equity instrument for notaries who contribute structured feedback and evaluation, subject to counsel, professional review and written terms. This future revenue stream and any equity arrangement are intentionally excluded from the base scenario until pricing, support cost, data rights, security, valuation and professional compliance are evidenced. The purpose is to put more capacity in a notary's hands, not to remove the notary: the target is to automate up to 80% of repeatable intake, checks and dossier assembly while the practising notary keeps independent legal judgment. A notary who can safely handle more qualified demand can create more earning capacity and help repair the current supply shortage. Actual income still depends on demand, accepted work, professional fees, operating costs and the final contracts.

The settlement design collects the client's combined amount on the platform and transfers the notary's fee. Published Canadian domestic-card pricing is 2.9% plus 0.30 $ per successful charge. [Stripe Payments](https://stripe.com/en-ca/pricing). The modeled Connect arrangement adds 2 $ per payout-active account-month and 0.25% plus 0.25 $ per bank payout. [Stripe Connect](https://stripe.com/en-ca/connect/pricing).

These are public-price assumptions, not verified Nota invoices. One act per payout is assumed. Account fees use the monthly Year 1 ramp and all target notaries active each month in Years 2–3. The prior assumption of ten acts per active notary per month was inconsistent with the plan's much lower provider utilization.

Stripe's comparison also lists a funds-routing feature at 0.25% of payout volume. Confirm whether an additional fee applies under Nota's contract; it is not silently counted twice in the baseline. If incremental, it would cost approximately 6.98 $ per modeled act. Reconcile optional products, international cards, currency conversion, refunds and actual balance transactions before treating this estimate as a forecast.

The calculation is: **Nota fee − processing on the entire charge − payout/account costs − service costs − losses**. Acquisition is subtracted once, within operating budgets in the annual model.

<!-- MODEL:unit -->
<!-- /MODEL:unit -->

The mix is 40% financing/60% refinancing and 70% standard/18% fast/7% priority/3% urgent/2% same day, at starting bases and recommended multipliers. It is unobserved. The 30 $ service cost and 0.5% of charge loss allowance are planning assumptions covering incremental preparation/support/tooling and net refunds, disputes, cancellation costs or unrecovered funds. Record components separately as data arrives; do not count refunded revenue and the same loss twice.

The model treats the service cost as incremental to budgeted founder/advisor/contractor capacity. If their paid time performs the same work, reclassify it rather than double-count it. Conversely, measure abandoned-file work and any professional validation costs not covered by that allowance.

### 8.2 Loss segments and optimization order

The [margin audit](go-to-market/margin-audit-2026-09-08.md) shows that permitted high-honoraires offers can be unprofitable even on domestic cards. The standard financing fee does not rise when the offered honoraires rise; processing does. A five-times offer cap is not a profit guarantee. The newly included will/procuration services need the same whole-envelope analysis before commercial promotion.

Prioritize actual cost instrumentation and a billing eligibility safeguard, then collection alternatives and pricing experiments. Canadian bank debit may reduce costs for suitably early bookings, but settlement delay, disputes and authorization differences must be reflected in the customer journey and reserves. This plan neither enables a new payment method nor changes prices.

Test 249/289 against 229/279 only after sufficient qualified volume exists, preserving frozen quotes and measuring contribution per eligible visitor. These are candidate fees from the earlier audit, not optimal prices. Include customer conversion, notary acceptance, completion, support and losses. Set sample size and stopping rules from observed baseline data before declaring a winner.

### 8.3 Acquisition and retention

The Year 1 client-acquisition envelope implies approximately 164 $ per completed client. After modeled payment, service and loss costs, roughly **22 $ per act remains after that acquisition allocation and before the rest of overhead**. This is much narrower than the previous 76 $ claim.

The supply budget implies 500 $ per recruited notary if all 30 are recruited. Cost per verified, active or retained notary will differ. The prior 29× LTV/CAC claim is withdrawn: three-year provider retention, demand cost and contribution were not demonstrated. Report supply cohorts and repeat participation; do not assign the entire margin stream to both client and provider LTV.

## 9. Operations, service quality and resilience

The founder owns the initial operating queue. The proposed practising notary advisor owns professional workflow review, not every participating notary's independent decision. Define named cover before taking time-sensitive cases; a solo founder cannot promise continuous service without staffing it.

| Operating area | Required routine | Trigger for intervention |
| --- | --- | --- |
| Intake and matching | Check eligibility, documents, deadline feasibility and available providers | Missing critical facts, no suitable response, incompatible sale/loan workflow |
| Client communication | Explain status, next action, quote changes and charge timing in FR/EN | A pending request approaches its deadline or authorization fails |
| Completion and payment | Reconcile act evidence, capture, transfers, payout status and bank records | Mismatch, duplicate event, failed transfer or unrecovered refund |
| Complaints and cancellation | Record cause, fee entitlement, remedy and professional escalation | Disputed representation, missed deadline or vulnerable-client concern |
| Security and continuity | Least privilege, vendor inventory, backups, restore exercise and incident owner | Access anomaly, data incident, unavailable critical provider |
| Notary supply | Recheck status and watch response/fulfillment concentration | Suspension, repeated failed deadlines or dependence on one practice |

Set response targets by supported business hours and urgency during the pilot; publish only targets the team can staff. Keep a daily financial exception queue, a weekly customer-outcome review and a monthly close. Money due to notaries or tax authorities is excluded from unrestricted runway. Confirm insurance coverage and limits for the actual platform activities; the budget is not proof of coverage.

## 10. Three-stage product roadmap

| Stage | Customer value | Evidence that permits expansion | Monetization status |
| --- | --- | --- | --- |
| 1. Urgent matching | A qualified request reaches a suitable available notary | Actual response times, completion and contribution by local cohort | Current service/date-fee planning model, subject to §7 review |
| 2. Preparation automation | Less repeatable work per accepted file | Measured human-time reduction including corrections, stable quality and adoption | Subscription or usage model to validate; no revenue included in forecast |
| 3. Electronic signing | A prepared file continues through a traceable conclusion | Authorized integrations, identity/consent, evidence preservation and professional approval | Integration/usage economics to validate; no revenue included in forecast |

These are product stages, not automatic calendar promises. Geographic expansion is a separate decision at every stage. The current signing room and AI implementation provide material to evaluate, not a claim of operational legal certification.

### 10.1 Measuring the 80% objective

The target is an **80% reduction of human time on defined repeatable preparation**, compared with the same task performed manually. Include all human review and correction time in the assisted measurement. The denominator excludes legal advice, independent judgment, final professional approval and signature. This target does not mean that 80% of a notary’s entire role disappears.

Before evaluation, define the supported act types and task boundaries: intake, authorized document extraction, completeness and consistency checks, and assembly of a sourced draft. Record a manual baseline and assisted results on comparable cases. Start with a proposed sample of at least 30 matched files per supported act type, spanning simple and exception cases; this is an operational pilot design, not a claim of statistical sufficiency. A practising notary must review the measurement protocol.

Use **1 − assisted human minutes / manual human minutes** on the full defined scope, counting failed or rejected outputs and rework. Report the sample size, date, task and act mix, median and spread, correction and abstention rates, and unsupported-field errors. A normalized 100-to-20 graphic in the pitch explains the target only; it is not measured time or a completed benchmark. Report both the preparation saving and whole-file human time so the denominator cannot conceal work shifted to the notary.

Accept a version only when the target is measured and the pre-agreed quality and safety criteria remain satisfied. Do not extrapolate one act type’s result to other services. Use authorized de-identified or synthetic evaluation data, retain traceability, and require documented notary approval and rollback before production changes.

### 10.2 Electronic signing and the integrated dossier

The value is fewer handoffs: validated identity and file → informed consent → authorized signature → preserved evidence and authentic copy. Québec’s [office signing guidance](https://www.cnq.org/votre-notaire/un-professionnel-numerique/signer-un-acte-notarie-technologique-au-bureau-du-notaire/) confirms that electronic signing already exists. [Remote signing remains exceptional and subject to the notary’s assessment](https://www.cnq.org/votre-notaire/un-professionnel-numerique/signer-un-acte-notarie-technologique/).

Confirm the permitted provider and integration path, professional identity controls, evidence integrity, archival and copy requirements before offering an operational signing service. The existing rehearsal must stay labeled as such until those prerequisites and end-to-end tests are satisfied. Measure abandoned handoffs, re-entry of information, completion time and error recovery; do not invent a signing time saving in advance.

### 10.3 Controlled learning loop and notary participation



Nota's model layer improves through a controlled learning loop. Aggregated user behavior shows where a client abandons intake, misunderstands a question or needs a clearer next step. Notary feedback supplies the high-confidence signal. A notary can accept, correct or reject a proposed field or preparation step and record the reason. Those signals improve the next qualified model version for simple financing, refinancing and other supported acts.

Dynamic improvement means daily signal collection and monitoring, held-out evaluation, notary review, a small canary release and a reversible rollback. It does not mean that live client behavior silently rewrites a legal field or changes model weights overnight. User behavior can improve question order, explanations and workflow routing. Only authorized, de-identified or synthetic data and separately approved notary feedback can enter an offline training set. Every generated output remains a draft until the responsible notary reviews it.

Notaries choose how they participate:

* **Feedback partner:** an opt-in notary contributes structured reviews, corrections and edge cases under a separate agreement and may receive potential equity or equity options. This is not guaranteed value, is not a referral reward and is subject to corporate, securities, tax, privacy and professional review. It cannot affect ranking, pricing, referrals or the notary's independent judgment.
* **Paid software user:** a notary may use the AI layer through a monthly subscription or usage plan and decline the model-improvement contribution program. Paid access provides the tool; it does not purchase influence over the marketplace or reduce the notary's professional responsibilities.

The intended win-win is practical. Clients receive clearer intake and faster next steps. Notaries receive a tool that can absorb repeatable preparation and help them serve more qualified requests. Nota receives evidence to improve the product. Contribution remains voluntary, and the model never replaces the responsible notary's advice, decision or signature.

The operating scorecard should track model acceptance and correction rates, abstentions, unsupported-field errors, time per accepted dossier, client friction, feedback contribution, subscription conversion, churn, support burden and gross margin. No model update reaches production without a documented version, a notary-reviewed evaluation result, an approval owner and a rollback path.

The commercial thesis for this layer is capacity expansion. Nota gives participating notaries a tool that absorbs repeatable preparation, so they can respond to more qualified requests, complete more acts and increase their potential professional income while preserving the notary's independent role. This is how the product repairs a market with too little supply for its demand. It is a future monetization path, not a promise of a fixed income uplift or a plan to eliminate notaries.

The learning loop is a managed product process, not automatic clinical or legal decision making. Keep a frozen evaluation set for each supported act, record the model version in the dossier, require a notary review before a model change reaches production, and publish outcome metrics separately for users, participating notaries and subscribed notaries. The contribution choice must remain voluntary, transparent and independent from the notary's professional judgment.

Province-wide matching follows measured local fulfillment and professional readiness. Other provinces and civil-law jurisdictions require local service definitions, qualified professionals, contracts, identity/signing rails and data assessments. Adjacent urgent-service industries reuse parts of the demand mechanism but need their own economics. No revenue from these expansions, model-enabled subscriptions or data products is included in the base financial scenario.

## 11. Milestones and decision rules

Month 1 begins when the operating plan is funded and starts; it is not a claim that September's deployment began a paid trading history. Dates are targets conditional on evidence, not automatic launch permissions.

| Window | Deliverable | Exit evidence / decision |
| --- | --- | --- |
| Months 1–2 | Legal, tax, provider and payment gates; discovery interviews | Written decisions and verified collection workflow before paid operation |
| Months 1–3 | 30 recruited / 25 verified and configured notaries | Service-area coverage, response exercise and named operating cover |
| Months 4–6 | First controlled financing cohort; 20 cumulative paid completions in the ramp | Mature funnel outcomes and cost ledger; diagnose before scaling |
| Months 7–9 | Repeatable local fulfillment; 87 cumulative completions | Positive segment contribution, on-time outcomes and repeat supply |
| Months 7–12 | Invite a notary feedback cohort and test the equity or paid software paths | Written contribution terms, professional review, model-quality evidence and measured software margin |
| Months 10–12 | Reach 244 cumulative completions in the base scenario | 80 813 $ modeled revenue, reconciled costs and evidence for follow-on funding |
| Before expansion | New region/service readiness | Local supply, legal/integration requirements, measured acquisition and capacity |

Target more than 60% acceptance and at least 80% completion after acceptance in mature cohorts before broad acquisition expansion. These are proposed management gates, not observed rates. Also require positive contribution and adequate on-time delivery; acceptance alone cannot justify growth. Set an on-time target from the promised service and pilot evidence before marketing a guarantee.

Review the plan monthly. Stop or narrow an unprofitable segment; delay new geography if supply is thin; preserve cash when the launch date slips. Start fundraising or cost reduction when the forecast shows fewer than six months of unrestricted operating cash. A revenue run-rate alone is not a Series A trigger, especially when the prior 700 000 $ threshold was below the plan's annual Year 2 revenue.

## 12. Financial plan and cash requirements

### 12.1 Use of the proposed 250 000 $ raise

| Budget | CAD | Scope / unresolved assumption |
| --- | ---: | --- |
| Founder compensation envelope | 96 000 $ | 8 000 $/month total budget; confirm salary vs employer burden |
| Legal, contracts and privacy | 20 000 $ | Obtain scope and quote; do not assume it covers every expansion |
| Practising notary advisor | 25 000 $ | Defined deliverables and professional workflow review |
| Design/front-end contractor | 25 000 $ | Prioritize observed conversion and accessibility problems |
| Client acquisition | 40 000 $ | Includes content, partner rewards, acquisition labor and paid tests |
| Notary acquisition | 15 000 $ | Includes recruitment rewards, outreach and travel |
| Infrastructure, insurance and tools | 12 000 $ | Validate invoices and coverage; serverless is not zero operating cost |
| Contingency | 17 000 $ | Explicit draw decisions and monthly tracking |
| **Total operating envelope** | **250 000 $** | Payment, incremental service and loss costs modeled separately |

Keep compensation costs within the envelope or increase the funding requirement. Founder living needs, existing cash, liabilities, sales tax remittances, employer charges, financing fees and accounts payable have not been verified. Credits, grants, debt and investor commitments are zero in the cash model until documented. Potential SR&ED/Québec credits, IRAP or Investissement Québec programs require current eligibility and timing checks; they are not assumed runway.

### 12.2 Base operating scenario

<!-- MODEL:annual -->
<!-- /MODEL:annual -->

All three years use the same financing mix and tariffs; Year 3 does **not** silently assume sale-act economics. The annual operating envelopes remain 250 000 / 720 000 / 1 850 000 $, with client acquisition of 40 000 / 154 000 / 440 000 $ included. The Year 2 and Year 3 cost envelopes are not yet a bottom-up hiring budget. Target staffing remains founder plus contractors in Year 1, four FTE in Year 2 and ten in Year 3, conditional on financing, capacity needs and compensation quotes.

Service and loss assumptions are additional; CAC is not subtracted again. All amounts exclude income tax, financing costs, tax/disbursement cash timing and capital expenditures. Taxes collected are not revenue; collecting them would add payment costs that the current model does not quantify. Therefore the operating result is a planning measure, not net income or a funding guarantee.

### 12.3 Monthly cash and reserve

The following base ramp includes no completed revenue in the first three months. It assumes collections, transfers and incremental costs settle in the completion month, and operating cash follows the stated budget. It excludes opening obligations and further financing. Maintain **25 000 $ as a proposed minimum cash reserve**, not an estimate of the processor's required reserve or a complete measure of exposure.

<!-- MODEL:cash -->
<!-- /MODEL:cash -->

With zero revenue and the full operating budget spent, the raise is exhausted at Month 12 and breaches the proposed reserve in Month 11. The base case ends Year 1 with approximately 45 377 $ total cash, only 20 377 $ above that reserve. Year 2's planned gross operating spend is 60 000 $ per month. Follow-on funding or a slower cost ramp is therefore essential before committing the Year 2 team.

### 12.4 Sensitivities and capital

<!-- MODEL:scenarios -->
<!-- /MODEL:scenarios -->

Downside halves completions, doubles service cost to 60 $ and raises loss allowance to 1% of collected charges. Upside increases completions by 50%, lowers service cost to 20 $ and losses to 0.25%. All retain the same price/mix and operating envelopes so the assumptions are comparable. These are mechanical stress cases, not probabilities. Downside hiring/spend should be reduced in practice; upside capacity may require more expense.

Capital figures use the worst cumulative **year-end** operating deficit plus the proposed 25 000 $ reserve. They omit within-year troughs after Year 1, settlement delays, restricted balances and unmodeled obligations. The base therefore indicates **at least approximately 180 119 $ beyond the proposed raise**, before those items; it does not establish that 430 119 $ is sufficient in all circumstances.

Other required sensitivities: an all-standard date mix; higher-complexity honoraires; actual tax collection; additional Connect fees; foreign cards; slower acceptance/completion; and failed/refunded cases. Calculate them using observed cohorts before expanding. Preserve a weekly 13-week cash forecast and a rolling 24-month funding model once actual opening balances and hiring terms are known.

## 13. Team, governance and financing readiness

Anthony Paquet is the founder and principal builder represented in the repository. Delivery history supports execution capability; this review does not verify a résumé, ownership structure or employment status. The initial team needs a retained practising notary advisor, Québec counsel, an accountant and documented operating cover. Future engineering, provider-relations and growth hires follow measured workload and available funding.

Before circulating as a financing package, assemble incorporation and trade-name records, current cap table and beneficial ownership, IP assignments, contractor agreements, tax registrations, bank balances, liabilities, insurance quotes/policies, customer/provider contract versions and the regulatory opinion. The September 8 record identifies the tax registrant as GESTION A. PAQUET INC.; confirm the relationship between that entity, Nota's trade name, payment descriptor and the entity raising funds.

The learning-loop proposal also needs counsel and a practising notary advisor to approve the feedback agreement, data permissions, equity or option mechanics, tax treatment, privacy boundaries and professional-independence safeguards before any invitation is made.

The proposed instrument remains a SAFE or convertible note, subject to counsel and negotiation. Valuation/cap, discount, conversion terms, governance rights and dilution are not specified and no investor commitment is claimed. Report funds secured separately from the fundraising target. The investment case should rest on a credible local experiment and its evidence, not unsupported precision about later rounds.

## 14. Risk register and owner decisions

| Risk | Priority | Response and accountable role |
| --- | --- | --- |
| Commercial or referral model not professionally cleared | Critical | Founder/counsel close §7 before the dependent launch; do not assume a fallback is automatically legal |
| Tax or supplier identity wrong | Critical | Accountant maps each supply and verifies quote-to-remittance accounting |
| Principal loss after paying a notary | High | Payment operations control exposure, recovery, reconciliation and reserves |
| Allowed offers have negative contribution | High | Engineering implements approved eligibility/collection handling; finance monitors by segment |
| Demand or provider liquidity insufficient | High | Founder narrows service/geography and releases acquisition budget in tranches |
| Complete price deters customers | High | Measure quote abandonment and alternatives; test eligible pricing with valid cohorts |
| Signing/AI capability overstated | High | Notary advisor enforces rehearsal and review boundaries; use measured evidence |
| Equity for professional feedback or use of client data not cleared | Critical | Counsel and notary advisor approve contribution terms, consent, securities, tax, privacy and deontology; default to the paid path |
| Privacy breach or provider outage | High | Privacy/technical owners validate vendors, incident response, backups and recovery |
| Cash shortfall or launch delay | High | Founder maintains weekly cash forecast; defer hiring and start funding early |
| Dependence on one founder or few notaries | High | Operating cover, documentation and diversified verified supply |
| Competitors match the mechanism | Medium | Win through fulfillment and distribution; measure retention rather than assert a moat |
| Plan drifts from code or deployment | Medium | Regenerate tables, compare live tariff evidence and label current-code versus production status |

**Owner decisions still needed:** confirm the fundraising entity and actual cash/liabilities; approve the fully costed compensation and operating envelopes; retain accountable professional/tax reviewers; resolve reward eligibility and payout terms; choose a supported policy for loss-making collections; and set acceptable fulfillment targets before a date guarantee is promoted. None of these decisions is fabricated by this revision.

## 15. Document control and supporting material

The Markdown plan is the content source for the formatted HTML. Financial tables in both language documents are generated from the same current-domain model. Rebuild with:

```sh
node docs/planning/business-plan-model.cjs
python3 docs/planning/render-business-plan.py
```

The renderer requires Python Markdown. It preserves the existing Nota brand stylesheet and mark in the formatted version. Model changes are planning changes only; prices and customer terms remain governed by the application and approved contracts.

Supporting research and operating evidence:

- [Market and AI research companion](nota-market-research-2026.md) — broader expansion research; validate dated claims before reuse.
- [Margin audit](go-to-market/margin-audit-2026-09-08.md) — collection costs, high-value losses and candidate experiments.
- [Launch activation](go-to-market/launch-evidence/2026-09-08-activation.md) — dated deployment/search evidence.
- [Payment readiness](qa/2026-09-08-stripe-production-readiness.md) — staged versus activated payment infrastructure.
- [Professional/legal dossier](legal/README.md) and [claims audit](compliance/audit-des-affirmations.md).
- [Signing requirements](signing-security-requirements.md) and [working rehearsal boundaries](signing-beta-release.md).
- [Current four-service coverage](ai/notary-service-coverage-2026-09-09.md), [evaluation](ai/notary-ai-evaluation-2026-09-09.md) and [cost/performance](ai/financing-cost-performance-2026-09-09.md).
- [Review record](planning/business-plan-review-2026-09-09.md) — changes, verification and unresolved evidence.
