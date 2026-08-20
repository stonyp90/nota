# Nota — Business Plan

**Pricing time in the Québec notarial market.**

- Version: 1.0
- Date: 2026-08-16
- Stage: product live, pre-revenue
- Raise: **250 000 $ CAD pre-seed**, 12 months of runway
- Contact: Anthony Paquet — anthonypaquet1508@gmail.com

---

## 1. Executive summary

Québec abolished mandatory notarial tariffs in **1991**. For thirty-five years,
notary fees have been free-floating and privately negotiated — and in all that
time **no price discovery mechanism ever emerged**. A client who needs a will
signed next Tuesday has no way to learn what next Tuesday costs, and a notary
with an empty Tuesday has no way to sell it.

**Nota is that mechanism.** A client posts the date they need an *acte notarié*
signed and what they will pay for it. Notaries watch a public calendar — the
*carnet* — and pick up the work that fits their schedule. Because the offer is
attached to a date, **the market prices urgency**: a signature needed tomorrow
clears at a multiple of one needed in three weeks.

Two things make this fundable now rather than in five years:

1. **The product already exists.** ~21 000 lines across a pure domain core, an
   HTTP/DynamoDB API, a zero-dependency SPA, a Cucumber BDD suite, Terraform
   infrastructure live on AWS `ca-central-1`, Stripe payments, notary
   authentication, an admin console, transactional email, and CI/CD. Built solo.
   This raise does not fund a build — it funds **distribution and liquidity**.
2. **The rails for a remote act are law.** Bill 34 (in force 24 October 2023)
   made the *acte notarié technologique* permanent in Québec. Remote signature
   is legal — but under art. 46 it is **exceptional**, party-requested and
   circumstance-justified. That constraint is not an obstacle to route around;
   it is the wedge. See §7.

**The ask.** 250 000 $ for 12 months, to take the live product from zero to
proven liquidity in the Québec City market, restructure monetization onto
déontologie-safe footing, and build the compliance layer that makes remote
signing routine for the cases where the law already allows it.

| Horizon | Acts closed | GMV | Net revenue |
| --- | ---: | ---: | ---: |
| Y1 — Québec City, 3 services | 244 | 257 664 $ | 25 766 $ |
| Y2 — All Québec, remote layer | 2 800 | 3 220 000 $ | 322 000 $ |
| Y3 — Full act catalogue | 11 000 | 15 950 000 $ | 1 595 000 $ |

Year 3 represents **~3.7 % of the addressable Québec act volume**. The plan does
not require winning the market. It requires being the place where price is
discovered.

---

## 2. Two findings that reshaped this plan

This plan was written against the statute and the code, not against
assumptions. Two things came back different from the working hypothesis, and
both are load-bearing. They are stated here, up front, because an investor will
find them in diligence and it is better that they find them already answered.

### 2.1 Remote signing is already legal — and that is *better* news than it sounds

The original Phase 2 premise was "clients must currently appear in person; going
fully online expands the market 100×." In Québec that premise is **half wrong**,
and the half that is wrong is the half that was going to be expensive.

The *acte notarié technologique* signed by videoconference is permanent law, not
a pandemic measure. The infrastructure exists and is sanctioned: a
CNQ-prescribed videoconference channel, the notary's official digital signature,
a technological minute. **Nota does not need to lobby a remote act into
existence, build a novel legal instrument, or wait on a regulator.** That is
years and hundreds of thousands of dollars removed from Phase 2.

What *is* true is narrower and more interesting. Under **art. 46** of the *Loi
sur le notariat*, as amended by Bill 34, a notary may only **exceptionally**
authorize remote signature, where circumstances require it and the parties'
rights are preserved. The request must come **from a party**, and the justifying
circumstance must be **specific to that party** — distance from an available
notary, health or functional limitation, weather, an unforeseen event
prejudicing another party. **Convenience does not qualify.** Bill 34 deliberately
pulled back from what had become normal practice during COVID, which is why it
remains contested within the profession.

So the barrier is not the technology and not the law's silence. **The barrier is
that the justification burden and the disciplinary exposure sit entirely on the
individual notary**, who therefore defaults to "come in person" because that is
the option that never generates a complaint.

**That is a product.** Nota can capture the party's request, structure the
qualifying circumstance, document it in an auditable record attached to the
dossier, and hand the notary a defensible file. It converts a discretionary
judgment call with personal downside into a standard, evidenced workflow. This
is worth more to a notary than the marketplace itself, and it is not something a
generalist e-signature company will ever build.

**Restated Phase 2 thesis:** the expansion does not come from making a legal
signature possible. It comes from **removing geography as a matching
constraint** — see §7.

### 2.2 The implemented revenue model is a déontologie risk, and it needs restructuring before launch

`apps/api/src/billing.js` currently implements a **10 % commission** on a
completed act, collected as a Stripe Connect application fee against the
notary's account. The file flags this itself: *"a share of a notarial acte is
fee-sharing the Québec Code de déontologie restricts; this model is an explicit
owner decision and needs a legal review with the Chambre before launch."*

That flag is correct, and it contradicts
[`docs/decisions/0001-flat-fee-not-commission.md`](decisions/0001-flat-fee-not-commission.md),
which fixed the opposite model. As implemented, the notary receives 90 % of
their own professional fee and a non-*notaire* keeps 10 %. That is the textbook
shape of prohibited fee-sharing, and it exposes every notary on the platform to
a disciplinary complaint. It is the single largest structural risk in the
business and it must be fixed before the first live act, not after.

**The fix preserves the economics and changes the legal structure entirely:
charge the client, not the notary.**

| | Current (risk) | Proposed (safe) |
| --- | --- | --- |
| Client pays | 650 $ | 650 $ + 65 $ service fee = **715 $** |
| Notary receives | 585 $ (90 %) | **650 $ (100 %)** |
| Nota receives | 65 $ *out of the notary's fee* | 65 $ *from the client, for Nota's own service* |

Nota is paid by the client for work Nota actually performs — sourcing a notary,
assembling and validating the dossier, running the transaction and the escrow.
It takes no share of any professional fee. The notary's *honoraires* arrive
whole. Unit economics are unchanged; the fee-sharing exposure disappears.

This raise budgets **20 000 $** for a formal déontologie opinion and structured
engagement with the Chambre des notaires before launch. Getting a written
opinion on file is also a genuine competitive asset: it is the kind of work a
well-funded entrant from outside Québec will not know it needs to do.

> **Action item.** ADR 0001 and `billing.js` currently disagree. Supersede both
> with a new ADR fixing the client-side service fee, and refactor `billing.js`
> to gross up rather than deduct. This is a small code change and a large legal
> one.

---

## 3. The problem

### For the client

Notarial pricing in Québec is opaque and time-blind.

- Fees have been unregulated since 1991. Each notary sets their own. Published
  ranges are wide — a will and protection mandate run roughly 700–1 000 $, a
  procuration 90–500 $, a residential closing 1 500–3 500 $ — and the client has
  no way to know where in the range they land until they call.
- Price discovery costs the client a sequence of phone calls during business
  hours, which is exactly the tax that stops people from acting.
- **Urgency has no price.** A client who needs a signature in 48 hours cannot
  pay to jump the queue, because there is no queue and no market — only a
  receptionist saying the first opening is in three weeks.
- The result is the largest under-served category in Québec private law:
  roughly **half of Québec adults have no will**, and among 18–34 year-olds the
  figure is about **70 %**.

### For the notary

- Roughly **3 900 notaries** practise in Québec. Their calendars have holes, and
  a hole in a notary's calendar is unrecoverable inventory — it expires like an
  airline seat.
- There is no channel to sell short-notice availability. A cancelled Thursday
  cannot be listed anywhere.
- Client acquisition is referral-and-signage. There is no marketplace to
  buy demand from, and the alternatives — buying leads, sharing fees — are
  either ineffective or prohibited.

**The gap:** a deregulated market with real price dispersion, real supply
elasticity and real demand urgency, and no mechanism connecting any of it.

---

## 4. The product

### 4.1 The mechanism

The client picks a service, a signing date and an amount. The **tier** is derived
from how many days away the date is, and it is the axis that makes the calendar
mean something:

| Tier | Days to date | Indicative premium |
| --- | --- | --- |
| `standard` | 15+ | 1.0×–1.2× |
| `rapide` | 8–14 | 1.2×–1.5× |
| `prioritaire` | 4–7 | 1.6×–2.2× |
| `urgence` | 2–3 | 2.5×–4.0× |
| `extreme` | 0–1 | 4.0×–10.0× |

Offers are floored at a market-researched *prix de départ* and hard-capped at
**10×** it, so the market is a real auction with guardrails rather than a race to
the bottom or a panic tax. The floors are documented in
[ADR 0006](decisions/0006-service-floor-prices.md) against observed Québec
market ranges. Bids post to a public monthly calendar; notaries retain the work
that fits.

### 4.2 Why only three services

Nota launches with exactly three acts, each with a **bounded, client-assemblable
intake** — a short checklist a layperson can complete alone, in one sitting,
without a professional pre-consult:

| Service | Prix de départ | Why it qualifies |
| --- | ---: | --- |
| Testament et mandat de protection | 650 $ | Identity + asset list + named parties. No third party. |
| Procuration | 295 $ | Identity + mandatary + scope. No third party. |
| Refinancement hypothécaire | 2 000 $ | Higher value, higher complexity, priced accordingly. |

*Acte de vente* was deliberately excluded ([ADR 0003](decisions/0003-bounded-intake.md)):
it requires a coordinated document transfer between broker, surveyor and lender
before the notary can begin. That is a workflow product, not a web form — and it
is Phase 3, not Phase 1. **Discipline about what not to launch is why the
marketplace can be self-serve on day one.**

Each service carries a dynamic base price built from criteria collected as part
of the dossier — the same questions the notary needs anyway. A couple's mirror
wills add 450 $; a protective trust for a dependent heir adds 600 $; a
procuration touching real estate adds 200 $. The client gets an accurate price;
the notary gets a pre-qualified file with a complexity weighting already
computed.

### 4.3 What is already built and deployed

This is the section that changes the risk profile of the raise.

| Component | State |
| --- | --- |
| `packages/domain` | Pure business rules — prices, tiers, cap, validation, dynamic pricing, fixtures. Zero dependencies. Asserted by tests. |
| `apps/api` | HTTP + persistence. Single-table DynamoDB, Lambda function URL, ports/adapters. Server revalidates every offer; anonymity enforced server-side. |
| `apps/web` | Public *carnet*, offer flow, dossier intake, Québec map, notary console. Vanilla JS, **zero runtime dependencies**. |
| `apps/admin` | Operator console with its own auth and test suite. |
| Payments | Stripe integration, pay-on-accept card authorization at post, connected accounts, reconciliation. |
| Notary side | Authentication, sign-up gate, lead-delivery preferences, ICS/webcal feed, earnings roll-up. |
| Email | Transactional email + scheduled reminders ([ADR 0007](decisions/0007-email-notifications.md)), CASL-compliant. |
| Analytics | Rollup statistics with drift reconciliation. |
| Infrastructure | Terraform: S3 + CloudFront (OAC) + Lambda (IAM-authed) + DynamoDB, live in `ca-central-1`. Idle cost ≈ 0 $. |
| Quality | Unit tests, jsdom smoke tests, Cucumber BDD suite, CI on every push and PR, `terraform validate`. |
| Compliance | Law 25: `ca-central-1` residency, anonymity default-on, consent at collection. |

**Architecture.** Hexagonal — a dependency-free domain core with thin adapters
for HTTP, persistence and UI. Business rules exist in exactly one place and both
the browser and the server load the *same module*, so the price a client sees and
the price the server enforces cannot drift. Seven architecture decision records
document why each major choice was made.

This matters commercially, not just aesthetically: **adding a fourth service, a
new pricing criterion or a new jurisdiction is a data change in the domain
package, not a rewrite.** Phase 2 and Phase 3 are cheap because Phase 1 was built
correctly.

---

## 5. Market

### 5.1 Sizing, bottom-up

**TAM — the Québec notarial profession.** ~3 900 practising notaries. At an
order-of-magnitude ~300 000 $ of annual professional fees per notary, the
profession bills on the order of **1.1–1.2 G$ CAD per year**. This is an
estimate derived from headcount, not a published figure; it is offered as scale,
not precision.

**SAM — the three bounded services.**

| Service | Est. annual Québec volume | Avg. act value | Annual act value |
| --- | ---: | ---: | ---: |
| Wills + protection mandates | ~200 000 registrations | 650 $ | ~130 M$ |
| Procurations | ~50 000 | 295 $ | ~15 M$ |
| Refinancing | ~50 000 | 2 000 $ | ~100 M$ |
| **Total** | **~300 000 acts** | | **~245 M$** |

Wills volume is anchored on the Chambre's *Registre des dispositions
testamentaires*, which recorded **215 576 registrations** in 2017–18 and now
holds over 6 million wills. Refinancing volume is inferred from the Canadian
renewal cycle — ~1.2 million fixed-rate mortgages renewing nationally in 2025,
Québec at roughly a fifth of that, with a meaningful share refinancing to a new
lender and therefore requiring a notarized hypothec.

**SOM — Year 3.** 11 000 acts ≈ **3.1 %** of SAM volume. The model does not
depend on category dominance.

**Phase 3 horizon.** Beyond the three services sits the rest of the act
catalogue — most importantly residential closings, at roughly **90 000
transactions per year** province-wide at 1 500–3 500 $ each. That single category
is larger than the entire current SAM. Beyond Québec sits the civil-law
*notariat*: the International Union of Notaries spans roughly 90 member states,
including France, Belgium, Switzerland and most of Latin America, all running the
same instrument Nota is built around. **That is where a 100× claim actually
lives** — not in avoiding a car trip.

### 5.2 Why now

1. **Bill 34 made the technological act permanent (Oct 2023).** The rails are
   built and sanctioned. Nota is not betting on a law passing.
2. **Fees have been deregulated for 35 years with no price discovery.** The
   market is legally free and structurally blind. That gap does not close on its
   own — someone has to build the venue.
3. **The renewal wall.** ~1.2 M Canadian fixed-rate mortgages renewing in 2025
   drives a refinancing volume spike straight into the highest-value service on
   the platform.
4. **The wealth transfer.** The largest intergenerational transfer in Canadian
   history is underway against a population where **~50 % of adults have no
   will** and ~70 % of under-35s have none.
5. **Access-to-justice pressure.** Notary coverage is uneven across Québec's
   regions, and "distance from an available notary" is a **statutorily
   recognized** justification for remote signing. The exception categories map
   precisely onto the under-served.

---

## 6. Phase 1 — The price of time

**Goal:** prove that a time-priced notarial marketplace clears, in one city,
with real money.

**Geography:** Québec City CMA (~850 000 people, ~400 notaries). Chosen over
Montréal deliberately — small enough that a solo founder can meet a
material share of local supply in person, dense enough to reach liquidity.

**Sequence.**

| Months | Focus | Exit criteria |
| --- | --- | --- |
| 1–2 | Déontologie restructure. Client-side fee, new ADR, `billing.js` refactor, written legal opinion, Chambre engagement. | Opinion on file. No fee-sharing exposure. |
| 1–3 | Supply. Recruit 30 Québec City notaries. Free to join, free to browse — zero friction, no card. | 25+ notaries with lead preferences configured. |
| 3–6 | Demand. SEO on real posted prices, mortgage-broker and financial-planner referral partnerships, paid search on high-intent urgency queries. | 25+ bids/month, fill rate > 45 %. |
| 6–12 | Liquidity. Tighten time-to-retain, publish the urgency curve, expand to Lévis / Saguenay / Trois-Rivières. | 90+ bids/month, fill rate > 60 %, 244 acts cumulative. |

**The one metric that matters: fill rate** — the share of posted bids a notary
retains. Below ~40 % the market is not clearing and the answer is more supply or
better floors. Above ~60 % the flywheel is real and the constraint moves to
demand. Everything else is secondary.

**The asset Phase 1 produces is not revenue — it is data.** At the end of Year 1
Nota holds the only dataset in existence of *realized price × days-to-date ×
act type* in the Québec notarial market. That curve is what makes the pricing
engine defensible, and nobody can reconstruct it without running the same
marketplace for the same year.

---

## 7. Phase 2 — The act without the trip

**Goal:** remove geography as a matching constraint.

Today a client in Québec City is matched against ~400 notaries. If the signature
does not require the parties to be in the same room, that client is matched
against **~3 900** — and a notary in Rimouski with an empty Thursday can sell it
to a client in Gatineau. **The market does not get 10× bigger because the client
saves a car trip. It gets 10× more liquid because supply and demand stop being
partitioned by postal code.** In a marketplace, liquidity *is* the product.

### 7.1 What Nota actually builds

**(a) The exception layer — the wedge.** Under art. 46 remote signing requires a
party-originated request and a party-specific justifying circumstance. Today
that burden and its disciplinary risk sit on the individual notary, so the
default is "come in." Nota productizes it: capture the party's request in their
own words at intake, classify the qualifying circumstance, collect the
supporting evidence, and attach a timestamped, auditable justification record to
the dossier. The notary receives a file that is already defensible. **This
converts a risky judgment call into a standard workflow — and it makes Nota
valuable to a notary independent of the marketplace.**

**(b) Dossier automation.** Presigned document upload, automated identity and
completeness checks, structured hand-off into the notary's existing practice
tooling. The dossier arrives complete or it does not arrive. This is the
difference between selling a lead and selling a *file*, and it is what justifies
the client-side service fee.

**(c) Signing rails.** Integration with the CNQ-sanctioned videoconference
channel and the notary's official digital signature, so the act is executed and
the technological minute closed without leaving the workflow.

**(d) Province-wide matching.** Once (a)–(c) hold, the carnet stops being a
Québec City calendar and becomes a Québec calendar.

**(e) Cross-border corridor (late Phase 2 / Phase 3).** The *Loi sur le
notariat* contemplates a signature received by a notary qualified in a UINL
member state, within that state's territory. That is a legal path to serving
**Québécois abroad** — a real, currently badly-served population — and the first
step onto the civil-law world's rails.

### 7.2 Honest framing of the regulatory position

Remote signing is **legal but exceptional** in Québec today. Phase 2 is
deliberately built to be **fully valuable under the current statute** — the
exception categories (distance from an available notary, health, functional
limitation, weather, unforeseen prejudice) are large, real, and systematically
under-served precisely because nobody has removed the notary's justification
burden.

Bill 34's pullback remains contested inside the profession, and the direction of
travel in every comparable jurisdiction has been toward liberalization. **If art.
46 loosens, Nota is the only operator already holding the compliance layer,
the supply network and the price data.** That is upside, not the plan. The plan
works if nothing changes.

---

## 8. Business model

### 8.1 Revenue

**Client-side service fee: 10 % of the act value, paid by the client, on top of
the notary's fee.** The notary receives 100 % of their *honoraires*. Nota is paid
for Nota's work: sourcing, dossier assembly and validation, transaction and
escrow. See §2.2 for why this structure and not the implemented one.

Charged only on a **completed** act. Card is authorized when the offer is
posted and captured on completion, so a posted bid is a real commitment and the
notary is never chasing payment.

**Expansion levers, in order of confidence:**

1. **Flat dossier-preparation fee** (99–149 $) — unambiguously Nota's own
   service, strengthens the déontologie position, and lifts revenue per act ~50 %
   on the low-value services where a 10 % fee is thin.
2. **Notary practice tooling** — the exception layer, calendar feed and dossier
   inbox as a flat subscription, which is the [ADR 0001](decisions/0001-flat-fee-not-commission.md)
   model reintroduced where it is unambiguously safe: paid by the notary for
   software, not deducted from an act.
3. **Data products** — the urgency curve, priced regional benchmarks. Later, and
   only with clean aggregation.

### 8.2 Unit economics

| | Y1 | Y2 | Y3 |
| --- | ---: | ---: | ---: |
| Avg. realized act value | 1 056 $ | 1 150 $ | 1 450 $ |
| Net revenue per act | 106 $ | 115 $ | 145 $ |
| Blended client CAC | 164 $ | 55 $ | 40 $ |
| Contribution per act | (70) $ | 49 $ | 93 $ |
| Gross margin | 89 % | 90 % | 91 % |

Cost of revenue is Stripe (~2.9 % + 0.30 $) plus effectively nothing —
serverless, scale-to-zero, near-0 $ idle infrastructure. Year 1 CAC exceeds
revenue per act; that is what a year-one marketplace looks like and the plan says
so rather than modelling it away.

**Notary economics.** Notary CAC ≈ 500 $ (the 15 000 $ field-sales line ÷ 30
notaries). A notary retaining 20 acts/year generates ~2 071 $ of annual gross
profit — 6 213 $ over a three-year tenure. **LTV/CAC ≈ 12×**, payback inside
five acts.

### 8.3 The repeat-purchase problem, stated plainly

**A client buys a will roughly once a decade.** Client retention is not the
flywheel and this plan does not pretend otherwise. Three things carry the
business instead:

1. **Supply is the durable asset.** Notaries are recurring, not one-time. Every
   notary recruited compounds; the network is the moat.
2. **Organic demand capture.** The public carnet is a continuously refreshed,
   hyper-local, high-intent corpus of *real posted prices* — structurally the best
   possible answer to "combien coûte un testament notarié à Québec ?". No
   competitor can index what they do not transact.
3. **Zero-CAC referral channels.** Mortgage brokers, financial planners, employee
   benefit providers and estate advisors all sit upstream of the intent moment
   and all need a notary they can hand a client to.

Refinancing, unlike wills, genuinely recurs on the renewal cycle — which is a
second reason it earns its place as the high-value service.

---

## 9. Competition

| | What they do | Where Nota differs |
| --- | --- | --- |
| **Notairo** | Montréal legal-tech; digital preparation of real-estate closings, final signature in person. | Closest analogue. Workflow software for one act type, fixed pricing, no marketplace, no time-based price discovery. |
| **Nolos** | Online notarized wills, ~21 service points in Québec. | A distribution network with fixed prices — a chain, not a market. No urgency pricing, no notary-side liquidity. |
| **Neolegal / ScriptaLegal** | Online legal services and document generation, notarial add-ons. | Document-first, price-fixed. Do not sell notary *availability*. |
| **Traditional practice** | Phone, referral, signage. | The real competitor. Nota wins by pricing time, which the phone cannot do. |
| **US remote-notarization platforms** | Volume RON for common-law notaries public. | Structurally cannot enter: a Québec *notaire* is a civil-law public officer, not a notary public. The Code de déontologie makes their commission model illegal here. |

**Nota is the only participant selling *when*, not *what*.** Every competitor
prices a document. Nota prices a date. That is a different market, and it is the
one that has never had a venue.

**Defensibility, honestly ranked:** (1) the urgency price curve, which requires
running the marketplace to obtain; (2) the notary network, which is slow and
in-person to build; (3) the déontologie-safe structure plus a written opinion,
which an outside entrant will not know to build; (4) the exception-layer
compliance product, which requires understanding art. 46 well enough to
productize it. None of these are patents. All of them are years.

---

## 10. Go-to-market

**Supply first, and free.** Notaries join and browse at no cost, with no card.
The only thing a notary risks by signing up is nothing, and the carnet is worth
looking at from the first week. Recruitment is in-person: Québec City practices,
Chambre events and congrès, and the regional notary networks. Target 30 in the
first quarter.

**Demand, three channels ranked by cost:**

1. **Organic (compounding, ~0 $).** The carnet itself. Real posted prices, real
   dates, refreshed daily, in fr-CA, hyper-local. Plus a per-service price-guide
   corpus built from actual transaction data.
2. **Referral partnerships (~0 $ CAC).** Mortgage brokers (refinancing),
   financial planners and estate advisors (wills and mandates), immigration and
   family practitioners (procurations). Each partner sits at the intent moment
   and currently has nowhere structured to send a client.
3. **Paid, urgency-targeted.** Search on high-intent, high-urgency queries where
   the tier premium makes the economics work — a client who needs a signature in
   48 hours has a demand curve nothing else on the platform matches.

**Positioning to the profession matters as much as positioning to clients.** Nota
never touches the act, never shares a fee, and never disintermediates the
notary-client relationship. It sells demand into empty calendar slots and hands
over complete files. The message to the Chambre is *demand generation for the
profession*, and the plan is to have that conversation early and in writing
rather than be discovered later.

---

## 11. Traction plan and milestones

| Milestone | Target | Why it matters |
| --- | --- | --- |
| Déontologie opinion on file | Month 2 | Removes the existential risk. Unblocks everything. |
| 25 notaries live, Québec City | Month 3 | Supply-side liquidity threshold. |
| First 10 acts completed | Month 5 | The mechanism clears with real money. |
| Fill rate > 45 % | Month 6 | The market is functioning, not just posting. |
| Urgency curve published | Month 8 | Proprietary data asset exists and is demonstrable. |
| Exception layer shipped | Month 9 | Phase 2 wedge live; remote acts become routine. |
| Fill rate > 60 %, 90 bids/mo | Month 11 | Liquidity proven. Series-A narrative intact. |
| 244 acts, 25 766 $ revenue | Month 12 | Bottom of the J-curve, with the curve visible. |

**Month 9–12: follow-on.** Investissement Québec's **Fonds Impulsion** invests
250 K$–1 M$ at pre-seed/seed but requires a **lead investor and a referral from
a recognized accelerator or Anges Québec**. Securing an angel lead in this round
and an accelerator relationship (Le Camp in Québec City, Centech) is therefore
not optional — it is the bridge to the seed. That sequencing is deliberate.

---

## 12. Financial plan

### 12.1 Use of funds — 250 000 $ over 12 months

| Line | Amount | Note |
| --- | ---: | --- |
| Founder salary | 96 000 $ | 8 000 $/mo. Below market, deliberately — this raise buys focus, not comfort. |
| Legal — déontologie opinion, Chambre engagement, incorporation, ToS, Law 25 program | 20 000 $ | The highest-ROI line in the budget. |
| Notary advisor (part-time, practising) | 25 000 $ | Credibility with supply and correctness on the exception layer. |
| Design / front-end contractor | 25 000 $ | ~3 months part-time. The one place outside help beats doing it solo. |
| Client acquisition | 40 000 $ | Paid search, content, partnership build-out. |
| Notary acquisition | 15 000 $ | Field sales, congrès, travel. |
| Infrastructure, Stripe, digital-signature certificates, insurance, tooling | 12 000 $ | Serverless keeps this small. |
| Contingency | 17 000 $ | ~7 %. |
| **Total** | **250 000 $** | ~20 800 $/mo average burn |

**Non-dilutive stacking.** As a Québec CCPC with a technical founder doing
eligible development, refundable SR&ED and Québec R&D wage credits can return a
meaningful share of the salary line, and IRAP is a live option. Conservatively
treated as runway extension, not as budgeted revenue — it plausibly buys 2–3
extra months.

### 12.2 Three-year projection

| | Y1 (2026-27) | Y2 (2027-28) | Y3 (2028-29) |
| --- | ---: | ---: | ---: |
| Notaries on platform | 30 | 220 | 700 |
| Bids posted | 434 | 4 912 | 17 742 |
| Fill rate | 56 % | 57 % | 62 % |
| **Acts completed** | **244** | **2 800** | **11 000** |
| Avg. realized act value | 1 056 $ | 1 150 $ | 1 450 $ |
| **GMV** | **257 664 $** | **3 220 000 $** | **15 950 000 $** |
| Take rate | 10 % | 10 % | 10 % |
| **Net revenue** | **25 766 $** | **322 000 $** | **1 595 000 $** |
| Gross profit | 23 041 $ | 289 940 $ | 1 459 150 $ |
| Operating expense | 250 000 $ | 720 000 $ | 1 850 000 $ |
| **Net** | **(226 959) $** | **(430 060) $** | **(390 850) $** |
| Headcount (FTE) | 1 + contract | 4 | 10 |

**Y3 share of SAM: 3.7 % of act volume. Cumulative capital required through Y3: ~1.05 M$.** Y2 assumes province-wide matching is
live; Y3 assumes the act catalogue has widened toward residential closings.

**Series A trigger:** exiting Y2 at a **300–500 K$ ARR run-rate with province-wide
liquidity proven and the exception layer in production** — raising ~3 M$ against
the full act catalogue and the first UINL corridor.

### 12.3 What has to be true

Three assumptions carry the model, and each has a named falsification test:

1. **Clients will pay a premium for a date.** *Test:* the realized premium
   distribution by tier in Phase 1. If `urgence` and `extreme` bids do not clear
   above `standard`, the core thesis is wrong and it is visible by month 6 for
   well under 100 K$.
2. **Notaries will sell short-notice availability.** *Test:* fill rate on
   `prioritaire`/`urgence` tiers specifically. Visible by month 5.
3. **The client-side fee is déontologie-safe.** *Test:* a written legal opinion,
   month 2.

**Every one of these is answered inside this raise.** That is the argument for
the round size: 250 000 $ is enough to falsify or confirm the whole thesis, and
not a dollar is spent building something that has not been validated.

---

## 13. Team

**Anthony Paquet — founder.**

The case is the repository. Working solo, across ~50 commits: a hexagonally
architected monorepo with a dependency-free domain core; an HTTP/DynamoDB API on
an IAM-authed Lambda behind CloudFront OAC; a zero-runtime-dependency SPA;
Stripe payments with connected accounts and reconciliation; notary and admin
authentication; transactional email with scheduled reminders; an ICS feed;
analytics rollups with drift healing; Terraform infrastructure live in
`ca-central-1`; a Cucumber BDD suite; CI running unit, DOM, BDD and
`terraform validate` on every push; Law 25 compliance designed in rather than
bolted on; and seven architecture decision records explaining the reasoning.

**Why this de-risks the round.** Most pre-seed capital funds the possibility that
a team can build the thing. Here the thing is built, deployed and tested. The
capital is buying **twelve months of undivided attention** on the parts that
cannot be solved by writing code — meeting notaries, getting the legal structure
right, and finding out whether the market clears.

**Hiring plan.** Y1: founder plus contract design and a part-time practising
notary advisor. Y2: notary-relations lead (the bottleneck is in-person supply
recruitment, not engineering), a second engineer, and a growth hire.

**Key-person risk** is real and acknowledged. It is mitigated by the ADR
discipline, the BDD suite as executable specification, and a Y2 hiring plan that
puts a second engineer in the codebase early.

---

## 14. Risk register

| Risk | Severity | Mitigation |
| --- | --- | --- |
| **Fee-sharing under the Code de déontologie** | **Critical** | Restructure to a client-side service fee before launch (§2.2). Written opinion budgeted at 20 K$, month 2. Notary receives 100 % of *honoraires*. |
| **Art. 46 keeps remote signing exceptional** | High | Phase 2 is designed to be fully valuable under the current statute. The exception categories are large and under-served. Liberalization is upside, not plan. |
| **Cold-start liquidity fails** | High | Supply is free and frictionless. One dense city first. Fill rate monitored weekly with an explicit floor-adjustment lever. |
| **Low client repeat rate** | Medium-High | Supply-side moat, compounding organic capture, zero-CAC referral channels, recurring refinancing (§8.3). |
| **Chambre opposition** | Medium-High | Early, written, partnership-framed engagement. Nota never touches the act or shares a fee. Positioned as demand generation for the profession. |
| **A funded competitor copies the mechanism** | Medium | The price curve requires running the market to obtain; the notary network is slow and in-person; the déontologie structure is non-obvious from outside Québec. |
| **Solo-founder key-person risk** | Medium | ADRs, BDD specs, early Y2 engineering hire. |
| **Race to the bottom on price** | Low | Hard floors per service ([ADR 0006](decisions/0006-service-floor-prices.md)) and a 10× cap, enforced server-side in the domain core. |
| **Law 25 / privacy incident** | Low-Medium | `ca-central-1` residency, anonymity default-on, consent at collection, right-to-erasure on the roadmap. |

---

## 15. The ask

**250 000 $ CAD pre-seed. 12 months.**

Structure: SAFE or convertible note, with an angel lead. An angel lead and an
accelerator relationship are explicitly targeted in this round because both are
prerequisites for Investissement Québec's Fonds Impulsion (250 K$–1 M$) as the
month-9-to-12 follow-on.

**What the money buys:**

- A déontologie-clean business structure with a written legal opinion on file.
- 30 notaries and a functioning two-sided market in Québec City.
- 244 completed acts and the first urgency price curve for the Québec notarial
  market — a dataset that does not otherwise exist.
- The exception layer that makes remote signing routine where the law already
  permits it, and province-wide matching within reach.
- Twelve months of a founder who has already built the entire platform doing
  nothing but this.

**The one-line version:** Québec deregulated notary fees in 1991 and never built
a market. The market is built. This funds finding out whether it clears.

---

## Appendix A — Sources

- Chambre des notaires du Québec — [remote signature of a technological notarial act](https://www.cnq.org/en/your-notary/a-digital-professional/signing-a-technology-based-notarial-act-remotely/)
- Chambre des notaires du Québec — [what to know about the remote act under the new law](https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/acte-a-distance-avec-un-notaire-les-choses-a-savoir/)
- Chambre des notaires du Québec — [Normes concernant l'acte notarié en minute sur un support technologique (PDF)](https://www.cnq.org/wp-content/uploads/2023/10/978677-2023_10_27_refonte_normes_acte_techno_v1final.pdf)
- Gascon et associés — [analysis of Bill 34, *Loi visant à moderniser le notariat*](https://gascon.ca/une-nouvelle-loi-qui-fait-jaser-la-loi-visant-a-moderniser-le-notariat-et-a-favoriser-lacces-a-la-justice/)
- Légis Québec — [*Loi sur le notariat*, RLRQ c. N-3](https://www.legisquebec.gouv.qc.ca/fr/document/lc/N-3)
- Jurivision — [*L'acte notarié électronique à distance : enjeux et perspectives*](https://jurivision.ca/lacte-notarie-electronique-a-distance/)
- Chambre des notaires du Québec — [Registre des dispositions testamentaires](https://www.cnq.org/en/the-chambre-and-your-protection/the-chambres-services/search-the-registers/)
- Notairo — [notary fees in Québec, 2026](https://notairo.com/en/blogs/news/frais-de-notaire-au-quebec-en-2026-a-quoi-s-attendre)
- Notairo — [launch of Québec's first digital real-estate closing platform](https://notairo.com/en/blogs/presse-et-medias/notairo-lance-la-premiere-plateforme-quebecoise-pour-preparer-les-transactions-immobilieres-en-ligne)
- Nolos — [online notarized wills](https://nolos.ca/en)
- APCIQ — [Québec residential market statistics](https://apciq.ca/en/quebec-city-and-montreal-real-estate-markets-continue-to-trend-upward/)
- CMHC — [Residential Mortgage Industry Report](https://www.cmhc-schl.gc.ca/professionals/housing-markets-data-and-research/housing-research/research-reports/housing-finance/residential-mortgage-industry-report)
- Conseiller — [half of Canadians still have no will](https://conseiller.ca/nouvelles/heritage-la-moitie-des-canadiens-nont-toujours-pas-de-testament/)
- La Presse — [*De bonnes raisons de faire son testament jeune*](https://www.lapresse.ca/affaires/portfolio/2026-04-15/heritage-et-succession/de-bonnes-raisons-de-faire-son-testament-jeune.php)
- Investissement Québec — [Fonds Impulsion](https://www.investquebec.com/fr/salle-de-presse/le-gouvernement-du-quebec-investit-dans-les-entreprises-technologiques-innovantes)

## Appendix B — Internal references

- [ADR 0001 — Flat fee, not commission](decisions/0001-flat-fee-not-commission.md) *(to be superseded — see §2.2)*
- [ADR 0002 — Single-table DynamoDB](decisions/0002-single-table-dynamodb.md)
- [ADR 0003 — Three services with a bounded intake](decisions/0003-bounded-intake.md)
- [ADR 0004 — CloudFront OAC + IAM-authed Lambda](decisions/0004-cloudfront-oac-iam-api.md)
- [ADR 0005 — Stripe](decisions/0005-stripe-flat-subscription.md)
- [ADR 0006 — Service floor prices](decisions/0006-service-floor-prices.md)
- [ADR 0007 — Email notifications](decisions/0007-email-notifications.md)
