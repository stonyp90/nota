# Quebec mortgage refinancing: a credible preparation automation strategy

Research date: **2026-09-09**. Technical planning document for Nota. **90% is a target, not a measurement, forecast, or demonstrated capability.**

## Recommendation

Build a notary-controlled preparation workspace in this order: **secure intake and evidence review → lender instructions → official payout/discharge tracking → registry evidence → approved document assembly and practice-system exchange → controlled signing handoff → closing reconciliation and reporting**. Start with imported documents from authorized channels; add direct connectors only where access and permitted use are established. Request lender and registry work early in a real file, in parallel with client collection; the sequence above is the engineering investment order, not an instruction to wait for all uploads before requesting official evidence.

The first candidate for managed OCR is **Amazon Textract text/forms/tables processing in Canada Central**, followed by evidence-linked extraction and deterministic checks. This choice fits Nota's existing AWS architecture and documented French text support; it is **not an accuracy or superiority claim**. Keep OCR and model adapters replaceable. Prioritize **Assyst Immobilier/Dye & Durham** for eventual lender connectivity, **ParaMaitre/Avancie** as the first practice-system interoperability candidate, and **ConsignO Cloud-CNQ or its currently authorized successor** for the notarial signing handoff. Their respective access limitations are material and appear below. [AWS language limits][aws-limits], [AWS endpoints][aws-regions], [Dye & Durham][dd], [Avancie integrations][avancie], [CNQ technological-act norms][cnq-tech].

Begin with a deliberately narrow cohort: Quebec residential refinancing requiring a new or replacement hypothec, natural-person owners, unchanged ownership, an institutional lender, and no initially identified title defect, construction issue, representation by power of attorney, estate, trust, corporate owner, or unusual property tenure. Route divided co-ownership and multiple-creditor files to separately evaluated extensions. Record every exclusion and its reason. This is an engineering cohort proposal, not a legal classification of uncomplicated files.

First triage whether a new notarial act is needed at all. CNQ explains that an existing hypothec can sometimes secure further borrowing without a new act. Also distinguish the **registered security amount and rate** from the **actual debt and negotiated loan rate**: they need not match. An automated comparison must not label that difference an error without knowing the relevant fields. [CNQ refinancing explanation, March 12, 2025][cnq-refi].

## Evidence status and current Nota capability

The research uses public primary sources. Product pages establish what a vendor documents, not independently measured performance or Nota's entitlement to use it. “Public API documented” means documentation was found; it does not mean a contract, credentials, production access, professional authorization, or an implementation exists. “Unknown” means this research did not establish the fact, not that the capability cannot exist.

Local documents and code reviewed: [preparation specification](refinancing-preparation.md), [review log](refinancing-review-log.md), [evaluation runner](../../apps/api/scripts/evaluate-financing.js), [synthetic cases](../../apps/api/evals/financing-cases.json), and [AWS region configuration](../../infra/variables.tf). These show an intake/preparation inventory, source-backed support guidance, and seven synthetic support cases. The runner checks escalation and keyword patterns. The existing review log reports that its live evaluation could not run without credentials. None establishes document extraction accuracy, deed readiness, production performance, training, or time saved. This research did not run a model or independently rerun the log's application test results.

The owner intends to restore AWS access. That can enable subsequent infrastructure verification, but does not establish lender, registry, signing, or data-processing authorization. This research creates no accounts, connectors, training jobs, outreach, or deployments and processes no live customer data. A concurrent implementation adds text extraction and notary review; its current capabilities and limitations are documented in [the implementation note](financing-ai-implementation.md).

## Work map: preparation versus authoritative evidence

The following is a proposed workflow synthesized from the legal and lender sources below. It is not an exhaustive CNQ practice manual. Every task needs an owner, evidence, a dependency, and a completion criterion. **Uploaded, extracted, verified, legally approved, signed, registered, and funds released are different states.**

| Work | Client can gather or declare | Official/professional channel and decision | Automation output and boundary |
| --- | --- | --- | --- |
| Mandate and routing | Contact details, preferred language, desired date, lender/advisor, borrowing purpose, ownership-change declaration | Notary accepts scope and evaluates conflicts; lender determines credit approval and required security | Proposed file classification, duplicate detection, conditional checklist, appointment preparation; no automatic legal eligibility decision |
| Parties | Names and contact details of owners, borrowers and possible intervening parties; marital/family situation; documents specifically requested by the notary | Notary verifies identity, capacity, quality, representation and consent | Extract candidate party records and discrepancies; separate owner, borrower, guarantor and intervenor roles; no “identity verified” from an upload or OCR |
| Client document packet | Available prior deed, certificate of location, municipal/school tax bills, insurance evidence, mortgage/HELOC statements, commitment copy, property-change declaration | Notary determines sufficiency and any required refreshed issuer evidence | Classify, deduplicate, identify missing pages, extract dates and amounts, draft a targeted missing-item request; avoid a universal demand for every sensitive document |
| Incoming lender mandate | Client's commitment and advisor contact help route the file | Current general and file-specific instructions come from the lender's authorized channel; notary accepts and resolves inconsistencies | Versioned obligation matrix: requirement, source clause, applicable party/product, evidence, due date and reviewer; client commitment alone cannot satisfy mandate receipt |
| Property and title | Civic address, available lot references and prior documents | Current Registre foncier records, registered acts and notary-directed searches; surveyor's certificate where required | Search-order worksheet, imported evidence index, candidate lot/charge list, change flags; no autonomous title opinion or priority conclusion |
| Existing secured debt | List every secured loan/line and available statements; authority needed for requests | Official creditor payout statement, effective date, conditions, discharge/assignment documents and lender confirmations | Prepare requests, reconcile the debt inventory, flag expired figures and omitted credit lines, track discharge evidence; a consumer balance screenshot is not an official payout |
| Taxes, survey, insurance and conditional checks | Existing bills, receipts, certificates, policy/contact details and declarations | Municipality/school authority, surveyor, insurer, syndicate or other issuer as the notary/lender requires | Compare names, property, coverage/date fields and missing evidence; never certify taxes paid from a bill alone or remove a legal condition because insurance exists |
| Document assembly | Clarifications to factual discrepancies | Notary chooses the authorized lender form, lawful wording, interventions and annexes | Proposed field mapping and a controlled draft in the notary workspace; freeze legal clauses, show evidence and differences, require professional adoption before use |
| Signing preparation | Availability, accessibility needs, requested remote participation and language | Notary determines permitted execution method and performs the required explanation, verification and signing acts | Assemble a review packet and draft scheduling messages; hand off to the authorized signing environment; no automatic ceremony launch or notary signature |
| Publication and closing | Client confirmations where requested | Notary-controlled registration, registry response, lender funding instructions and trust-account evidence | Prepare submission metadata; distinguish submitted/rejected/registered; import receipts, detect changes and reconcile expected versus actual events; no assumption that an HTTP success means registration |
| Post-closing | Receipt of appropriate copies | Notary's final lender report, follow-up on discharge, trust reconciliation and prescribed record custody | Assemble proposed reports and delivery manifests, track outstanding undertakings and missing receipts; no autonomous certification or destruction of official records |

The channel distinction is consequential. FCAC describes payoff and discharge as separate steps and notes related secured products. CNQ describes title examination as identifying rights and charges affecting ownership. BMO's Quebec mandate assigns title/condition review to the notary. These support an evidence workflow with professional conclusions at its boundaries. [FCAC discharge][fcac], [CNQ title examination][cnq-title], [BMO Quebec mandate][bmo].

### Lender rules must be specific and versioned

Use **RBC Quebec collateral instructions as the first public instruction parser fixture**, then **BMO Quebec instructions as a contrasting fixture**. This is a documentation-driven implementation order, not a ranking of lenders or a claim about Nota's customer mix. Before supporting any actual lender/product, a notary must approve that product's current instruction pack.

RBC Form 03915 QCNB, inspected in its **03/2026** edition, distinguishes platform-supplied documents from public downloads and prohibits unapproved form changes. Its public March 20, 2026 notice expands Homeline identity checks to all borrowers, including those absent from title. Consequently, downloaded templates and an owner-only party list cannot be treated as permanent rules. [RBC instructions][rbc-instructions], [RBC dated notices][rbc-news].

BMO's **October 2023** public mandate is a comparative example, not a verified September 2026 file mandate. It specifies disclosure timing with a waiver route, title/insurance alternatives, and conditional property checks. Its certificate-of-location provisions couple age with the property's current state. Do not turn one lender's age threshold into a Quebec-wide rule, or assume one title-insurance checkbox removes every remaining obligation. [BMO mandate, pp. 1, 4–5 and Appendix A][bmo].

Store lender, product, province, language, edition/effective date, retrieval date, original document hash, clause reference, and any superseding file instruction. Conflicts become a blocking question to the notary/lender; the model must not choose whichever instruction makes closing easier. A new version should invalidate only affected approvals and show why.

## Legal and nondelegable boundaries

These are verified source propositions and proposed engineering consequences. A software design is not, by itself, professional approval of that design. Statutory exceptions must be respected; this document does not assert that every administrative action is legally reserved to a notary.

| Source boundary | Consequence proposed for Nota |
| --- | --- |
| A conventional immovable hypothec must be constituted by notarial act en minute, under Civil Code article 2693; the registry's official instruction sheet states that form requirement. [Registry legal requirements][registry-hypothec] | Generic e-signature completion cannot create the required notarial act. |
| Notaries Act sections 11 and 43 require verification of identity, quality and capacity; section 11 includes informed consent, advice and impartiality. [Notaries Act][notaries-act] | Keep these judgments with the notary. Automation supplies candidate facts and evidence. |
| Section 15 reserves specified drafting/advice activities, subject to sections 15.1 and 16. Section 15.0.1 separately reserves ascertainment/validation of relevant factual statements in a notarial act and public-officer acts, except as provided by law. [Notaries Act][notaries-act], [enacted 2023 amendment, s. 24][notaries-amendment] | A disclaimer cannot authorize Nota to independently prepare legal instruments for the public. Start with evidence and proposed merge data; any assisted legal drafting must remain within a professionally approved, notary-controlled workflow. |
| Section 46 makes remote signing conditional and subject to the notary's authorization; it is not an unconditional customer entitlement. [Notaries Act, s. 46][notaries-act] | Record the notary's execution-method decision; do not promise every file can close remotely. |
| CNQ's publicly inspected 2023 norms distinguish staff preparation from the notary's professional acts and prescribe a specialized signing environment. The February 2024 notice adds source-to-annex integrity verification. [CNQ norms, ss. 1, 3–6][cnq-tech], [2024 update][cnq-tech-update] | Separate preparation permissions from launch/sign/certify permissions. Preserve original annexes and verify conversions. Confirm the current norms and approved environment before implementing execution. |
| Notaries' Code of ethics sections 35–36 protect professional secrecy; release generally requires written authorization or a legal requirement. [Code of ethics][ethics] | Establish the permitted outsourcing/disclosure arrangement; do not assume a generic privacy checkbox permits sending a privileged dossier to any model provider. |
| BMO requires the completing notary's signature on its title opinion/report and sets prerequisites to advancing funds. [BMO mandate][bmo] | Generate a draft checklist/report, while leaving certification and release authorization with the responsible professional. Payment and trust actions require controls outside the model. |

The product should explicitly reserve decisions about title defects, security rank, family residence/spousal intervention, powers of attorney, corporate/trust authority, suspicious discrepancies, title-insurance adequacy, execution and funding readiness. Clerical preparation for those decisions is potentially assistable. The requirement that the model cannot independently release funds is a proposed Nota control as well as a response to lender obligations; this research does not claim all trust-account keystrokes are legally nondelegable.

**Temporal limitation:** the legislation pages inspected displayed consolidation dates including April 7, 2026; public CNQ norms inspected were dated October 2023 with a February 2024 update, and some newer operational material was inaccessible or member-restricted. These are not proof that the full September 2026 operating rulebook was publicly available. Obtain the current professional standards through the responsible notary before implementing signing, custody, or trust operations. No CNQ authorization of Nota was verified.

## Recommended integration order and realistic availability

Use the following evidence labels: **API** = public provider API documentation; **product** = documented user-facing capability/integration; **unknown access** = Nota's direct integration rights and technical access are unverified. Nothing below is an installed Nota connector.

| Order | Integration choice and verified evidence | Access/fit still unknown | Concrete implementation and fallback |
| --- | --- | --- | --- |
| 1 | **Nota intake + AWS Textract**. API operations for text/forms/tables are documented; French text detection and a Canada Central endpoint are listed. [Operations][aws-ocr], [limits][aws-limits], [region][aws-regions] | Account permissions, operation quotas, real Quebec scan accuracy, complete processing/retention configuration. Queries are English-only in the inspected documentation; do not assume lending/identity specializations support Quebec French forms. | Local synthetic fixtures first. After separately authorized access, benchmark OCR in `ca-central-1`; use a replaceable adapter and manual transcription fallback. Use existing text layers where suitable and compare against rendered originals. |
| 2 | **Incoming lender instructions via Assyst Immobilier/Dye & Durham**. Product documents electronic mortgage instructions and Quebec notary enrollment. RBC documents Assyst mandates. [Dye & Durham][dd], [RBC forms][rbc-forms] | No public Quebec Assyst transaction API, developer sandbox, webhook schema, partner entitlement or Nota credentials verified. Public Unity/Lender Centre branding does not prove the same migration/access path applies to every Quebec service. | Build an authorized notary-upload importer and versioned instruction matrix now. Direct mandate ingestion is the first commercial connector priority if vendor access later becomes available. Keep acceptance in the notary's channel. |
| 3 | **Official payout and discharge through the existing lender/Assyst route**. The vendor documents payout/discharge enrollment; its Quebec payment product is also documented. [Dye & Durham][dd], [Assyst payments][dd-payments] | Participating creditors/products, request/status interfaces, fees, service commitments, automation rights and programmatic access remain unverified for Nota. | Import issuer responses with creditor, date, valid-through conditions and provenance. Track requests and post-payment discharge separately. Prepare requests for the authorized user; do not auto-send or move funds. |
| 4 | **Registre foncier evidence, then registration handoff**. Official public guidance documents the registry and SLRI; registration can use SLRI or specialized supplier tools. [Registry][registry-home], [SLRI][registry-slri] | No open general-purpose title-search or filing API available to Nota was verified. Supplier access does not imply universal developer access. Authentication, digital-signature requirements and allowed automation need confirmation. | First import official records/receipts obtained by an authorized operator. Prepare search and submission metadata. Later integrate an approved supplier if available; retain manual search/submission as an explicit measured step. |
| 5 | **ParaMaitre/Avancie practice-system exchange**. Its product page documents ConsignO Cloud, title-insurance, registry lot import and discharge tracking integrations. [Avancie][avancie] | No public ParaMaitre write API, bulk-export schema, sandbox or Nota partnership verified. An existing product bridge is not access for another vendor. | Produce a documented, reviewed field-mapping packet and original-document manifest first. Select ParaMaitre as the first partner candidate based on workflow overlap; implement direct exchange only against an actual contract/schema. Avoid forcing a firm to replace its practice system. |
| 6 | **ConsignO Cloud-CNQ / currently authorized notarial solution**. CNQ's inspected norms identify the specialized environment and an approved Para-Maitre bridge. [CNQ norms][cnq-tech] | Current approved solution list, CNQ tenant API access, partner certification, central-records integration and Nota entitlement are unverified. | Hand off an approved packet to the notary's existing environment. Direct draft-project creation is conditional on the specific authorized interface; the notary retains professional launch, signature and certification. |
| 6a | **General ConsignO Cloud API**, for suitable ancillary documents. Public docs cover projects, signers, downloads, audit trails and webhooks; production access is described as Enterprise-only, with a sandbox request route. [API documentation][consigno-api] | Commercial terms, account access and document-specific legal acceptance. General API access does not establish CNQ-environment access. | Prefer evaluating this provider before adding a second signature stack. Keep envelopes in draft until the authorized workflow approves sending; independently reconcile completion evidence. |
| Alternative | **Docusign**, for ancillary documents if a firm already uses it. Public eSignature API and production promotion process are documented. [Docusign APIs][docusign] | Nota's production entitlement, contracts, residency configuration and each document's suitability. No CNQ notarial-act approval established. | An alternative for ordinary signatures, not the recommended route for the hypothec itself. Do not add both providers without a demonstrated need. |
| 7 | **Closing/reporting and trust reconciliation**. Existing lender and practice/payment products support portions of the workflow. [BMO][bmo], [Avancie][avancie], [Assyst payments][dd-payments] | Bank/trust-account API availability and authority, ledger interfaces, lender-specific submission methods and production reconciliation remain unverified. | Import actual ledger/receipt evidence, propose reconciliations and assemble reports. Keep banking credentials, beneficiary changes, payment execution and professional certifications outside AI control. |

**Do not confuse adjacent products with Quebec access.** Dye & Durham's API Connect page concerns Australian property/business information. Its Unity Entity Management integration article concerns a different product. Neither establishes a Quebec mortgage API. [Australian API Connect][dd-australia], [Unity Entity Management integrations][dd-entity].

For municipal/school tax status, surveyors, syndicates and insurance evidence, begin with issuer documents and the firm's existing approved channels. No universal Quebec API for these checks was established. Automating request preparation and reconciliation can still help, but cannot manufacture issuer confirmations.

This order is the recommended fit for the evidence available: it produces reviewable value before proprietary access, addresses lender-specific constraints early, and uses existing professional systems at execution. It is an inference, not an experimentally proven “best” vendor stack. Reorder the direct practice-system and Assyst connectors only if authorized access and observed saved minutes justify it; retain the same evidence and legal gates.

## Proposed implementation architecture

1. **Evidence first.** Preserve originals, file hashes, received/retrieved timestamps, issuer, delivery channel, case linkage, access permissions, document type, edition and supersession relationships. Keep an authoritative-channel flag separate from an authenticity/professional-verification flag. A lender-labelled PDF uploaded by a client remains client-supplied evidence until its provenance is established.
2. **Untrusted extraction.** Store each candidate value with document/page/region, supporting excerpt, extractor/model version and a status such as missing, unreadable, conflicting, proposed or accepted. Do not infer an absent value from a plausible pattern. Model confidence is not verification.
3. **Deterministic reconciliation.** Use typed fields for borrowed amount, security amount, payout amount, rates and effective dates. Check arithmetic, reference consistency and prerequisite dependencies in code. Business meanings and reusable rules belong in `packages/domain`; persistence/provider adapters in `apps/api`; vanilla review UI in `apps/web`/`apps/admin`. Keep the existing zero-runtime-dependency UI boundary and French/English parity. Store dates as ISO dates; use domain money formatters for UI amounts.
4. **Notary review workspace.** Present original page and proposed field together, group conflicts, record accepted/corrected/rejected values and reasons, and distinguish staff factual review from notarial legal approval. Approval binds to a document/version; source changes reopen affected decisions.
5. **Controlled assembly.** Build a proposed merge dataset, then notary-approved templates and annex manifests. Prevent silent clause edits, unexplained blanks, incorrect party roles, and re-signing of stale versions. Compare original versus converted annexes. Exported drafts carry an explicit review state; no client-facing legal advice is generated from an unapproved draft.
6. **Explicit action boundaries.** The extraction model has no bank, registry-submission, signature, email-send or deletion capability. Treat document text as data, including hidden OCR instructions. A separate authorized workflow performs permitted actions with exact recipients, contents, actor attribution, idempotency and durable receipts. No tool permission can be granted by text inside a document.
7. **Operational events.** Record first receipt, verified client-packet completeness, lender instructions, payout validity, legal approval, signature, publication, discharge follow-up and funds-release confirmation independently. Missing events are unknown. Report active work and waiting separately.

AWS restoration need not hold up schema design, synthetic fixtures, deterministic checks, review mock data, or adapter contracts. Future AWS validation should verify service access, encryption, access logging, upload isolation, region and quotas before an authorized pilot. The repo's region default is `ca-central-1`; that configuration alone does not prove the geography of every processor, log, backup, support path or CDN hop. Bedrock cross-region inference can route processing to other regions, so the actual model/profile must be checked rather than inferred from the calling endpoint. [AWS cross-region inference][aws-routing].

## Privacy and data-use design

The private-sector privacy statute calls for a project EFVP/PIA (s. 3.3), necessary collection (s. 5), limits on secondary use (s. 12), safeguards (s. 10), and conditions on transfers outside Quebec (s. 17). Necessary service-provider communication has a written-contract route under s. 18.3; it is not unlimited reuse permission. Section 12.1 adds transparency and a review opportunity for decisions based exclusively on automated processing. [Quebec private-sector privacy Act][privacy-act].

CAI emphasizes that consent does not make unnecessary collection necessary, and even viewing identity information is collection. Its EFVP guide provides a structured assessment process. Apply that to OCR, inference, review storage, vendors and proposed feedback reuse from the outset. [CAI collection guidance][cai-collection], [CAI EFVP guide][cai-efvp].

Proposed Nota controls:

- Collect only the evidence justified for the file and stage; do not gather tax returns, credit files or all identity documents merely because a model could read them. Keep lender underwriting data out unless the notarial task requires it.
- Define the notary firm's and Nota's roles, purposes, subprocessors, permitted access, confidentiality, incident duties, deletion/return and audit rights in the service arrangement. Review professional secrecy separately from ordinary privacy-law compliance.
- Isolate files and firms; use least privilege, encryption, restricted downloads and logged access. Exclude document bodies, identity numbers and bank details from routine telemetry.
- Establish separate retention schedules for temporary extraction artifacts, correction records and official notarial records. Do not delete the official record under an application's generic retention timer.
- Distinguish executing the client's file from reusing it to improve a model. Document the legal basis and scope for each secondary use before reuse; default this development effort to synthetic or appropriately authorized material.
- Do not describe redaction or replacing names as anonymization. CAI distinguishes depersonalization from anonymization; the former is not a substitute for destruction when retention is no longer justified. [CAI retention guidance][cai-retention].
- Defer biometric identity automation. If later selected, assess the specific system's legal obligations; CAI identifies advance disclosure requirements for biometric databases, including the 60-day timing rule. [CAI Law 25 changes][cai-biometric].
- Give users a correction/escalation path. A nominal human click is not the review quality Nota should rely on; the reviewer must see evidence and be able to change the result.

No provider's security marketing, Canadian hosting statement, or no-training policy establishes compliance for the whole workflow. Verify contracted terms and the actual processing route, not just the storage region.

## “Best industry practices” expressed as measurable criteria

There is no primary-source benchmark here showing any vendor automates 90% of Quebec notarial preparation, or that Nota exceeds an incumbent. Treat quality as measurable workflow performance. Anthropic's primary guidance recommends multidimensional success criteria and evaluations that inspect actual outcomes, with multiple trials and appropriate graders. These support the evaluation approach below, not the proposed numeric thresholds. [Success criteria][ai-criteria], [Agent evaluations, January 9, 2026][ai-evals].

| Criterion | Measurement and proposed evidence |
| --- | --- |
| Enter facts once, verify their reuse | Count duplicate manual entries and corrections across intake, draft and reporting; test an accepted correction propagates everywhere and stale approvals reopen. |
| Evidence-grounded output | Every proposed material field has a resolvable source reference, or is explicitly marked missing/conflicting. Audit supporting passages, not merely the presence of a citation. |
| Current instructions | Every obligation links to a lender/product/version and clause. A superseded instruction test must fail closed on affected work. |
| Review that preserves responsibility | Every legal gate has a named notary, timestamp, evidence version and explicit decision. Sample the substance of review; do not score clicking “approve” as correctness. |
| Reliable exception handling | Measure critical-condition recall, false-clear cases, abstention and false alarms separately; report French/English, lender and document-quality slices. |
| Resilient integrations | Test missing, duplicate and out-of-order events, timeouts, revoked access, rejected filings and stale payout figures; reconcile to authoritative outcomes. |
| Useful automation economics | Measure net human minutes, correction burden, provider cost and support effort per completed file against a manual and template/rules-only baseline. No claim from demo speed alone. |
| Privacy and security | Test cross-file/firm isolation, prompt-injection resistance, authorization checks and deletion/retention behavior. Maintain a verifiable processor inventory. |
| Accessible bilingual operation | Have a Quebec French reviewer and an English reviewer assess field meanings, requests and explanations. Measure omission and correction rates by language; do not translate signed lender clauses ad hoc. |

These criteria are proposed acceptance requirements, not a claim that each vendor already meets them or that their thresholds are prescribed by CNQ.

## Daily learning is not daily fine-tuning

| Activity | What changes | Appropriate cadence and gate |
| --- | --- | --- |
| Review sources and authorized corrections | Knowledge of failure modes and source freshness | Daily review can identify changes. A human validates the source and applicability before accepting an update. |
| Improve retrieval, checklists, templates and prompts | Retrieved material, deterministic rules or instructions supplied to the same model | Version changes, add development regressions, run evaluations and review differences before release. This is system improvement, not weight training. |
| Evaluate | Measurements of a fixed candidate system | Run task-specific tests after changes and scheduled regression checks when authorized. A run without a provider is an inventory/test of plumbing, not model performance. |
| Supervised fine-tuning | Model parameters based on labelled examples | Consider only for a stable, recurring error class that persists after extraction, retrieval and prompt fixes. A job requires supported model/region, training rights, budget, versioned data and evaluation. [AWS customization][aws-training] |
| Reinforcement fine-tuning | Model parameters optimized against feedback/rewards | Defer; a keyword or model-only legal grader is an inadequate reward for this workflow. Provider documentation of the technique is not evidence of fitness here. [AWS customization][aws-training] |

Recommended daily loop: inspect source changes and authorized review corrections; classify the failure as collection, OCR, mapping, retrieval, rule, workflow, or model behavior; write a synthetic regression; propose the smallest correction; evaluate; have the appropriate owner approve it; record the version, result and remaining limitation. No automatic customer-document ingestion or self-reinforcing learning from the model's own answers.

For a future training experiment, require a documented dataset purpose and provenance; independent notary adjudication of legal labels; removal/minimization of personal information; separate training, development and untouched test sets; and leakage checks by file, borrower/property, template family and time. Split before deriving variants of a document. Keep the test set out of prompts and training. Use a shadow comparison against the unchanged model plus retrieval and rules; adopt the trained model only if it improves the relevant held-out outcomes without harming safety, bilingual quality or cost. Store dataset hashes, model/job identifiers, parameters and evaluation artifacts. Actual fine-tuning changes weights; a refreshed knowledge document or daily review does not. [AWS training definition][aws-training].

Existing seven-case keyword checks are useful smoke tests for support behavior, not ground truth for refinancing document work. Build extraction, cross-document, exception-routing and workflow-state tests separately. Inspect observable outputs, evidence and tool events; do not require private model reasoning as an audit artifact.

## Acceptance criteria and an honest 90% denominator

### Define the target before timing the pilot

Use **net reduction in human clerical/preparation effort for the predeclared eligible cohort** as the primary 90% target:

```text
B = baseline human minutes for the same preparation scope and case mix
H = remaining human preparation minutes with Nota
    (review + corrections + data entry + portal work + follow-ups + exception handling)
R = 1 - H / B
Target: R >= 0.90, subject to all quality and authority gates
```

Sum minutes across everyone doing the work, including notaries, clerks and operations staff. Work does not disappear because it moves to a client, lender or vendor: record participant effort separately and reject a “saving” explained mainly by shifting the burden. Attribute extra notary review caused by AI to `H`; do not hide it in the excluded professional baseline. Allocate ongoing maintenance/support effort in the economic assessment.

Report separately: baseline clerical task coverage; proportion completed without correction; rework; retained professional decision/ceremony time; total staff time; client effort; elapsed calendar time; waiting for lenders/registry; out-of-scope volume; and cost. A completed checklist is not 90% of a file, and 90% of extracted fields is not 90% of effort.

**Illustration only:** if baseline preparation takes 200 minutes and Nota reduces it to 20, that meets the preparation target. If another 40 minutes of professional work remains unchanged, total staff time falls from 240 to 60 minutes: a 75% total reduction. These numbers are arithmetic examples, not observations. External waiting may remain unchanged. There is no substantiated universal ten-day baseline in this research.

If manual portal work alone remains more than 10% of baseline preparation effort, the 90% target cannot be met without reducing that work or another legitimate scope change. Do not quietly remove those tasks from the denominator. Report any revised target/cohort explicitly.

### Proposed release and evidence gates

All numeric thresholds below are **proposed Nota targets** requiring professional validation; none is a measured result or a regulatory safe harbor.

| Gate | Proposed acceptance criterion |
| --- | --- |
| Scope and authority | A responsible Quebec notary approves the task map, reserved decisions, lender/product matrix, current standards and excluded cases. The privacy lead completes the applicable assessment and data-use/processor decisions before real-file processing. |
| Reproducibility | Every evaluation identifies code, model, prompt, document/template, knowledge and dataset versions, plus the actual provider mode and run outcome. Failed/no-credential runs never appear as passing evaluations. |
| Evidence completeness | 100% of proposed material facts have resolvable supporting evidence or explicit unknown/conflict status; 100% of approvals bind to the reviewed version. |
| Extraction | At least 99% normalized exact-match accuracy on predefined critical fields in the held-out set, with results by field/language/lender. Missing/abstained fields remain in the denominator. Every critical field still requires the specified review; this threshold is not clearance for autonomous closing. |
| Critical exceptions | Zero missed seeded critical blockers and zero false “clear to sign/fund” outcomes in the qualification suite. Report sample counts and uncertainty; zero observed failures is not proof of zero risk. Include identity/party mismatch, wrong lot, expired payout, hidden secured line, changed mandate, title issue and missing authority. |
| Document integrity | All lender clause-lock, original-versus-converted annex, missing-page, signature-state and version-invalidation tests pass. No fabricated clause, source, signature, receipt or legal certification. |
| Action safety | No unauthorized messages, submissions, signatures, beneficiary changes, payments or cross-file disclosures in adversarial tests. Repeat critical workflows to expose nondeterministic failures. |
| Integration reliability | Duplicate/out-of-order/rejected/timed-out events produce the expected durable state; portal fallbacks are usable and their minutes are counted. An action is complete only with the proper external evidence. |
| Human review quality | Notary reviewers adjudicate legal outcomes and disagreements. An LLM grader may assist triage, never serve as sole ground truth. Review time and correction burden must not worsen the claimed saving. |
| Preparation target | Only claim achievement when a predeclared representative pilot supports `R >= 90%`, with case counts, scope, baseline method and confidence interval. For an “at least 90%” claim, require the lower 95% confidence bound to meet 90%, not merely the point estimate. |
| Whole-workflow outcome | No critical quality/authority regression; no material deterioration in total staff effort, client burden or elapsed completion for comparable cases. Publish exceptions and unresolved discharge/reporting work. |

Proposed study design: begin with a small synthetic development pack spanning both languages, RBC/BMO instruction differences, degraded scans and adversarial documents. Build a separate qualification pack reviewed by notaries. When independently authorized, time an initial 30–50 matched or randomized eligible files across more than one notary/firm to estimate variance and rework. That initial range is for study sizing, **not enough by itself to establish rare-event safety or a 90% claim**. Set the confirmatory sample size from observed variability and desired precision, freeze the scope and analysis, and assess errors at file level rather than treating correlated fields as independent samples. Use blinded review where practical and avoid training reviewers on the very files later used as a manual baseline.

The initial commercial statement should remain: **“Nota is targeting up to 90% of clerical/preparation effort in a defined refinancing workflow, subject to measurement and professional review.”** It must not imply that the current product achieves that result, that all refinancing files qualify, that 90% of notarial judgment is delegated, or that funding deadlines are guaranteed.

## What to build first and what remains unverified

The first reviewable product increment should be a synthetic refinancing dossier that produces: a source inventory; a party/property/loan candidate table; a client-versus-official missing-evidence list; a lender obligation matrix; a notary correction view; and a draft preparation brief with complete provenance. Demonstrate that changing a payout date or lender instruction reopens affected work. Include an explicit test where the right answer is “official instructions not received.” This increment is useful without private lender APIs or weight training.

After that, validate extraction and review effort; add official lender and payout imports; import registry evidence and build approved assembly; then justify direct integrations with measured duplicate-entry savings. The current public evidence supports this order but cannot establish Nota's achievable percentage. Remaining dependencies are the current professional rulebook, notary-reviewed ground truth, real integration agreements, exact processor configurations, representative timing data, and end-to-end operational validation. Restored AWS access resolves only part of that list.

## Source register

All links below were reviewed or retrieved on 2026-09-09. Dates refer to document editions/dated notices where inspected, not search-engine crawl timestamps. Sources are primary; vendor performance language was not adopted as independent evidence. Public web pages are mutable, and a public exemplar is not an individual lender mandate.

- **CNQ:** [refinancing explanation][cnq-refi] (2025-03-12); [title examination][cnq-title]; [technological-act norms][cnq-tech] (2023-10-27, effective 2023-10-30); [norms update][cnq-tech-update] (2024-02-22). The 2023 PDF is historical operational evidence, not confirmation of the full current approved-platform list.
- **Legislation:** [Notaries Act][notaries-act] (inspected consolidation displayed 2026-04-07; sections 11, 15, 15.0.1, 43, 46); [2023 enacted amendment][notaries-amendment] (s. 24); [Code of ethics][ethics] (ss. 35–36); [private-sector privacy Act][privacy-act] (inspected consolidation displayed 2026-04-07).
- **Privacy regulator:** [necessary collection][cai-collection], [EFVP guide][cai-efvp], [retention/anonymization][cai-retention], [Law 25 changes including biometrics][cai-biometric].
- **Lenders:** [RBC Quebec form catalogue][rbc-forms], [RBC dated notices][rbc-news], [RBC Form 03915 QCNB][rbc-instructions] (03/2026); [BMO Quebec mandate][bmo] (October 2023 comparative exemplar). RBC's session-prefixed PDF URL was the retrievable official source; use the catalogue to resolve a later current edition.
- **Government/registry:** [FCAC discharge][fcac] (page dated 2025-09-25), [Quebec registry overview][registry-home], [SLRI][registry-slri], [immovable hypothec requirements][registry-hypothec] (2024-11-01 document).
- **Workflow vendors:** [Dye & Durham mortgage workflow][dd], [Quebec Assyst payments][dd-payments], [Avancie integrations][avancie]; scope counterexamples: [Australian API Connect][dd-australia], [Unity Entity Management][dd-entity]. No direct Nota access tested.
- **Signing providers:** [ConsignO Cloud API][consigno-api], [Docusign APIs and production process][docusign]. API availability is distinct from approval to receive a Quebec notarial act.
- **AI/OCR primary documentation:** [Textract operations][aws-ocr], [language limits][aws-limits], [regional endpoints][aws-regions], [Bedrock routing][aws-routing], [model customization][aws-training], [Anthropic success criteria][ai-criteria], [Anthropic agent evaluations][ai-evals] (2026-01-09). No source establishes Quebec notarial accuracy or 90% savings.

[cnq-refi]: https://www.cnq.org/en/the-chambre-and-your-protection/news-press-room/parlons-refinancement-hypothecaire/
[cnq-title]: https://www.cnq.org/la-chambre-et-votre-protection/faq/en-quoi-consiste-lexamen-des-titres-de-propriete-fait-par-un-notaire/
[cnq-tech]: https://www.cnq.org/wp-content/uploads/2023/10/978677-2023_10_27_refonte_normes_acte_techno_v1final.pdf
[cnq-tech-update]: https://www.cnq.org/en/the-chambre-and-your-protection/news-press-room/normes-sur-lacte-technologique-nouvelle-version/
[notaries-act]: https://www.legisquebec.gouv.qc.ca/en/document/cs/N-3
[notaries-amendment]: https://www.publicationsduquebec.gouv.qc.ca/fileadmin/gazette/pdf_encrypte/lois_reglements/2023A/106563.pdf
[ethics]: https://www.legisquebec.gouv.qc.ca/fr/pdf/rc/N-3%2C%20R.%202%20.pdf
[privacy-act]: https://www.legisquebec.gouv.qc.ca/fr/document/lc/P-39.1
[cai-collection]: https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/collecte-renseignements-personnels_entreprises
[cai-efvp]: https://www.cai.gouv.qc.ca/uploads/pdfs/CAI_GU_EFVP.pdf?gt=obligation
[cai-retention]: https://www.cai.gouv.qc.ca/protection-renseignements-personnels/information-entreprises-privees/conservation-destruction-renseignements-personnels
[cai-biometric]: https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25
[rbc-forms]: https://www.rbcroyalbank.com/fr/formulesjuridiques/qc-residential.html
[rbc-news]: https://www.rbcroyalbank.com/fr/formulesjuridiques/news.html
[rbc-instructions]: https://www.rbcroyalbank.com/RBC%3A-JEVYawYUBABhgHgNKcAAABE/legalforms/download/collateral/3915_QCNB.pdf
[bmo]: https://www.bmo.com/legaldocuments/legals/docs/qc_en_ins_Oct2023.pdf
[fcac]: https://www.canada.ca/en/financial-consumer-agency/services/mortgages/mortgage-discharge.html
[registry-home]: https://www.quebec.ca/habitation-territoire/information-fonciere/registre-foncier
[registry-slri]: https://portail-info.foncier.gouv.qc.ca/notaires-avocats/comment-inscrire-une-requisition/service-en-ligne-de-requisition-dinscription/
[registry-hypothec]: https://portail-info.foncier.gouv.qc.ca/media/014n2yj0/hypotheque_immobiliere_2024_11_01.pdf
[dd]: https://dyedurham.ca/fr/solution/paiements-immobiliers/
[dd-payments]: https://dyedurham.ca/fr/solution/gestion-des-paiements/
[dd-australia]: https://dyedurham.com.au/solution/api-connect/
[dd-entity]: https://support.dyedurham.ca/hc/en-ca/articles/25096983051805-Integrations-Partnerships
[avancie]: https://avancie.com/integrations/
[consigno-api]: https://support.notarius.com/wp-content/uploads/api/consigno-cloud-api-en.html
[docusign]: https://www.docusign.com/products/apis
[aws-ocr]: https://docs.aws.amazon.com/textract/latest/dg/how-it-works.html
[aws-limits]: https://docs.aws.amazon.com/textract/latest/dg/limits-document.html
[aws-regions]: https://docs.aws.amazon.com/general/latest/gr/textract.html
[aws-routing]: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
[aws-training]: https://docs.aws.amazon.com/bedrock/latest/userguide/custom-models.html
[ai-criteria]: https://platform.claude.com/docs/en/test-and-evaluate/develop-tests
[ai-evals]: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
