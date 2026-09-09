# Financing preparation and improvement loop

Research reviewed: 2026-09-09. Scope: Quebec mortgage financing and refinancing.

## Outcome and current capability

Reduce avoidable waiting and repeated data entry before the notary reviews a file.
The owner's roughly ten-day baseline is a hypothesis, not a measured Nota result
or a legal minimum. Track actual elapsed time separately from active notary work.
Never infer signing or funding readiness from a completed upload checklist.

Implemented locally:

- Retained financing files now have a bilingual preparation brief listing
  missing applicable intake items and the separate lender/notary checks. Its
  inventory distinguishes declared fields, listed filenames and external-channel
  declarations; none are treated as verified documents or closing approval.

- Shared, bilingual intake now includes signing parties, lender contact and
  instruction status, property changes, and (refinancing) secured loans and lines.
  The existing private dossier API sanitizes and stores these fields; existing
  document-request and notary views consume the same domain catalogue.
- Versioned, source-backed preparation knowledge feeds the existing AI support
  assistant. General guidance is supported; individual legal conclusions escalate.
- Seven synthetic regression cases cover instructions, discharge, intake, legal
  escalation, deadline pressure, identity-document access and training claims.
- A live evaluation command records model, knowledge version, prompt/dataset hashes,
  answers, latency, usage and smoke-check results. No provider credentials or
  customer files are included in the dataset or report.

The next implementation adds provider-capable extraction from notary-supplied page
text and a private correction workflow; see [implementation details](financing-ai-implementation.md).
Live provider verification is still pending. Not implemented: OCR, automatic
document retrieval, full cross-document reconciliation, notarial deed drafting,
actual weight training, provider training jobs, production deployment, or verified
time-savings analytics.
There is no claim that AI currently performs most notarial work. Preparing a
knowledge prompt is not model training. A daily Codex review is not a training job.

## Work map

| Work | Client preparation | Automation to build | Authority / dependency |
| --- | --- | --- | --- |
| Mandate | Advisor contact, commitment, desired date and rate expiry | Extract proposed lender terms with page references; flag missing instructions | Notary checks current lender mandate and special conditions |
| Parties | Owners, borrowers, marital situation, availability, absent signers | Draft party list and flag inconsistent names | Notary verifies identity, capacity and required interventions |
| Property | Address, tax bills, certificate and changes | Extract and compare address/lot references; propose missing-document requests | Notary examines title, charges, certificate and applicable insurance |
| Existing debt | Statements and all secured loans/credit lines | Draft payout checklist and date-sensitive discrepancies | Notary obtains official payout figures through lender channels |
| Deed | Complete source pack | Draft only from approved templates and evidenced fields | Notary reviews legal wording and explains the act |
| Closing | Availability and requested outstanding pieces | Track confirmed prerequisites and missing confirmations | Notary controls signature, registration, trust funds and lender reporting |

Start with extraction, missing-data detection and a review brief: these reduce
clerical work without pretending the uploaded material proves legal facts.
Any extraction must distinguish missing, unreadable, conflicting and verified
values. Each proposed field needs document ID, page, excerpt, model/prompt version,
and explicit notary acceptance or correction. Model output is untrusted data;
document text cannot issue tool instructions. Never change bank details or release
funds based on model output. Do not send a draft follow-up without authorization.

## Primary sources and limits

- [RBC Quebec notarial forms](https://www.rbcroyalbank.com/fr/formulesjuridiques/qc-residential.html): distinct mandate, deed, request-for-funds, title-report and discharge forms. This is one lender, not a universal checklist. Consult the current mandate for each file.
- [FCAC mortgage discharge](https://www.canada.ca/fr/agence-consommation-matiere-financiere/services/hypotheques/quittance-hypothecaire.html): repayment alone does not remove the charge; related secured products and registration steps matter.
- [AMF title insurance](https://lautorite.qc.ca/en/general-public/insurance/home-insurance/title-insurance): coverage and limits require assessment; insurance is not a universal substitute for correcting a title problem.
- [Chambre des notaires: digital practice](https://www.cnq.org/votre-notaire/un-professionnel-numerique/): digital execution retains the notary's assessment and explanation of the act.

This is an engineering preparation map inferred from those sources, not a
notary-approved exhaustive practice manual. Conditional matters (corporations,
trusts, estates, co-ownership, powers of attorney, construction, rural systems,
private lenders and title defects) require additional instructions. Do not collect
every conceivable sensitive document from every client. Record the notary's
case-specific requirements and respect the client's authorized sharing channel.

## Daily procedure

1. Read this document and `refinancing-review-log.md`; preserve unrelated work.
2. Check primary-source changes and newly available, authorized notary feedback.
   Record dates and source evidence. Do not scrape customer documents into training.
3. Turn a verified omission or correction into a synthetic regression case. Keep
   development cases separate from a future held-out, notary-reviewed evaluation
   set; never train on the held-out set. Do not use model answers as ground truth.
4. Improve the intake or source-backed knowledge with a focused, reversible change.
   Keep all business rules in domain and French/English UI parity.
5. Run focused tests; after product changes run required suites and builds.
   When provider credentials are available, run the synthetic live evaluation:

   ```sh
   node apps/api/scripts/evaluate-financing.js --live > /tmp/nota-financing-evaluation.json
   ```

   It uses `ANTHROPIC_API_KEY` or `NOTA_ASSISTANT_API_KEY` and optional
   `NOTA_ASSISTANT_MODEL`. No credentials are fetched automatically. Without
   `--live` the command prints inventory only. Missing credentials fail the live
   command; that is not a passing evaluation. Keyword checks are smoke tests,
   not semantic correctness or professional approval; inspect every answer.
6. Log evidence, evaluation mode/results, limitations and next action. Notify only
   meaningful improvements, regressions or required user action. Do not deploy,
   contact clients/notaries, change prices or start paid training from this review.

## Measurement and model training gates

Collect operational milestones before estimating improvement: request created,
notary retained, first document received, client packet confirmed complete by the
notary, lender instructions received, official payout received, legal review
complete, signed, registered and funds released. Record active review minutes,
number/reason of follow-ups and model corrections separately. Missing events are
unknown, never zero. Compare cohorts by lender, complexity and service; report
counts and coverage with median and upper-percentile elapsed durations. These
milestones are a specification, not instrumentation already deployed.

A training dataset requires a defined task, documented authority for secondary
use, minimization/de-identification, retention/deletion controls and notary-reviewed
labels. Existing consent to share a dossier with a notary does not authorize
training on that dossier. Begin with synthetic/public-source cases. Before
processing real documents, configure the provider's data handling and access
controls for that purpose. Before any model promotion, require held-out comparison,
no critical legal/factual regressions, reviewed evidence and a rollback version.
Do not retrain daily merely to say the model learns: update sources and cases daily
when there is evidence; train only when the data and measured benefit justify it.
