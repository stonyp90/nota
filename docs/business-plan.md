# Nota — Business Plan

**Pricing time in the Québec notarial market.**

- Version: 1.1
- Date: 2026-09-04
- Stage: product live, pre-revenue
- Raise: **250 000 $ CAD pre-seed**, 12 months of runway
- Contact: Anthony Paquet — anthonypaquet1508@gmail.com

> **What changed in 1.1.** Version 1.0 described a **10 % commission on the
> notary's fee** as what the code did, and proposed restructuring it. That
> commission has since been **removed from the product**, not merely proposed
> for removal: Nota now charges the client **its own published price**, per
> service, and the notary's *honoraires* reach them whole. Every economic figure
> in this plan has been recomputed from the shipped pricing grid in
> `packages/domain/index.js` — unit economics, revenue per act, gross margin,
> break-even and the three-year projection. **Gross margin per act is materially
> lower than version 1.0 claimed** (about **66 %**, not 89–91 %), because Nota
> bears the card-processing fee on the *whole* amount the client pays, including
> the notary's fee, which Nota never keeps. §8.2 shows the arithmetic.

---

## 1. Executive summary

Québec abolished mandatory notarial tariffs in **1991**. For thirty-five years,
notary fees have been free-floating and privately negotiated — and in all that
time **no price discovery mechanism ever emerged**. A client whose mortgage
rate hold expires next Tuesday has no way to learn what next Tuesday costs, and
a notary with an empty Tuesday has no way to sell it.

**Nota is that mechanism.** A client posts the date they need an *acte notarié*
signed and what they will pay for it. Notaries watch a public calendar — the
*carnet* — and pick up the work that fits their schedule. Because the offer is
attached to a date, **the market prices urgency**: a signature needed tomorrow
clears at a multiple of one needed in three weeks.

Two things make this fundable now rather than in five years:

1. **The product already exists.** ~40 000 lines across a pure domain core, an
   HTTP/DynamoDB API, a zero-dependency SPA, an operator console, a Cucumber BDD
   suite and a Playwright end-to-end suite, Terraform infrastructure live on AWS
   `ca-central-1`, Stripe Connect payments, notary authentication, transactional
   email, and CI/CD gating the deploy. Built solo. This raise does not fund a
   build — it funds **distribution and liquidity**.
2. **The rails for a remote act are law.** Bill 34 (in force 24 October 2023)
   made the *acte notarié technologique* permanent in Québec. Remote signature
   is legal — but under art. 46 it is **exceptional**, party-requested and
   circumstance-justified. That constraint is not an obstacle to route around;
   it is the wedge. See §7.

**The ask.** 250 000 $ for 12 months, to take the live product from zero to
proven liquidity in the Québec City market, restructure monetization onto
déontologie-safe footing, and build the compliance layer that makes remote
signing routine for the cases where the law already allows it.

| Horizon | Acts closed | Charged to clients | Nota revenue | Gross profit |
| --- | ---: | ---: | ---: | ---: |
| Y1 — Québec City, financing catalogue | 244 | 744 000 $ | 62 700 $ | 41 000 $ |
| Y2 — All Québec, remote layer | 2 800 | 8 542 000 $ | 719 600 $ | 471 100 $ |
| Y3 — Widening act catalogue | 11 000 | 33 557 000 $ | 2 827 000 $ | 1 850 600 $ |

**Read the third column, not the second.** Nota's revenue is its own published
price per act, not a percentage of what changes hands, so the amount flowing
through the platform is a scale indicator and nothing more. Year 3 is roughly
**10 % of the two-service addressable act volume** — a bigger share of a smaller
category than version 1.0 claimed, which is the direct consequence of the
financing-first catalogue (§5). The plan does not require winning the market. It
requires being the place where price is discovered.

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

### 2.2 The revenue model was a déontologie risk. It has been removed.

Version 1.0 of this plan reported that `apps/api/src/billing.js` implemented a
**10 % commission** on a completed act, collected as a Stripe Connect
application fee against the notary's account, and proposed restructuring it. A
later variant made the percentage float between 5 % and 15 % according to an
internal score. **Both are gone from the product.** They are stated here only so
a reader who finds them in the git history or in a dated audit knows they were
retired, and by which decision.

**What the code does today.** An offer carries **two lines**, which the client
reads separately before committing anything:

| Line | Who receives it | What sets it |
| --- | --- | --- |
| **Honoraires** | **The notary, in full** | The amount the client offers |
| **The price of Nota** | Nota | A grid published in advance — the service asked for, plus a date-guarantee line — never the notary, their record, or the value of the act |

The client's card is authorized for the **total** of the two, on Nota's own
Stripe account. At signing Nota captures that total, keeps its own two lines and
transfers the *honoraires* to the notary's connected account. **Nota deducts
nothing from a professional fee, and the notary abandons nothing.**

**Why this shape and no other.** Four texts, read against the code, forbid the
retired arrangement and require this one:

- **Art. 32.1 2° of the *Loi sur le notariat*** presumes **usurpation of a
  notary's functions** by an intermediary who "obtains from a notary the
  abandonment of part of their fees" — 2 500 to 125 000 $, doubled on repeat.
- **Art. 32 of the *Code de déontologie des notaires*** forbids a notary from
  sharing fees with someone who is not a member of a professional order. The
  same conclusion taken from the other end: the prohibition binds the notary,
  the presumption binds Nota, and fixing one without the other fixes nothing.
- **Art. 29.1** forbids any agreement endangering the notary's independence and
  disinterest — which a fee indexed on a score awarded by a private company is.
- **Art. 32.1 3°** excludes the intermediary who supplies services "with no
  responsibility toward the notary for their fees". Nota authorizes, captures
  and guarantees the notary's net, deliberately.

Decisions: [ADR 0031](decisions/0031-le-prix-de-nota-est-celui-de-nota.md)
retired the share; [ADR 0034](decisions/0034-le-prix-de-nota-est-une-grille-par-service.md)
turned Nota's single price into the per-service grid. `commission-config.js` was
deleted and replaced by `prix-nota-config.js`; the notary console no longer
receives a rate of any kind, because showing one would describe an arrangement
that no longer exists.

**No notary was ever billed under the retired model** — no act had yet been
carried on the platform when it was removed.

**What is still open, and what the 20 000 $ legal line now buys.** The
*direction* of the money is settled and verifiable on the Stripe wire: the
client pays the platform. What remains open is the legal **qualification** of
Nota's own price — whether a regulator reads a per-act charge by an intermediary
as Nota's own service revenue or as something art. 32.1 still reaches — plus
three narrower questions: the display of evaluations (art. 70), the
qualification of the internal cote, and price presentation (art. 71–72,
including the fact that **taxes and disbursements are in neither line and appear
nowhere in the product yet**). A written opinion is budgeted at 20 000 $ and
remains **required before the first live act**. Getting it on file is also a
genuine competitive asset: it is the kind of work a well-funded entrant from
outside Québec will not know it needs to do.

> **Wording discipline, permanently.** No surface, document or comment may
> describe Nota as taking a *commission*, a *share* or a *split* of a notary's
> fees; may attach a rating, average or *cote* to a **named** notary on a client
> surface (art. 70); may claim to be *cheaper than a notary* (art. 32.1 1°); or
> may call Nota's price *fixed* — it is a grid, published per service.

---

## 3. The problem

### For the client

Notarial pricing in Québec is opaque and time-blind.

- Fees have been unregulated since 1991. Each notary sets their own. Published
  ranges are wide — a mortgage or refinancing act runs roughly 1 500–3 500 $ —
  and the client has no way to know where in the range they land until they
  call.
- Price discovery costs the client a sequence of phone calls during business
  hours, which is exactly the tax that stops people from acting.
- **Urgency has no price.** A client who needs a signature in 48 hours cannot
  pay to jump the queue, because there is no queue and no market — only a
  receptionist saying the first opening is in three weeks.
- **And the deadline is not theirs.** A mortgage rate hold expires on a date the
  lender set. When the notarial calendar cannot meet it, the client loses the
  rate — a loss measured in thousands of dollars over the term, caused by an
  appointment nobody could price.

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

| Tier | Days to date | Premium on the **notary's** fee | Nota's **date-guarantee** line |
| --- | --- | --- | ---: |
| `standard` | 15+ | 1.0× | 0 $ |
| `rapide` | 8–14 | 1.8×–2.2× (≈×2) | 50 $ |
| `prioritaire` | 2–7 | 2.7×–3.3× (≈×3) | 100 $ |
| `urgence` | 1 | 3.3×–3.7× (≈×3.5) | 200 $ |
| `extreme` | 0 | 3.7×–4.3× (≈×4) | 300 $ |

**Two columns, and they answer to two different articles.** The multiplier
prices the *notary's* own fee — art. 49 4° of the *Code de déontologie* lets a
notary weigh « le degré d'urgence » in setting fees — and it is not a constant:
`tunedTierMultipliers` shrinks the observed median premium of retained offers
toward the published band, so the ladder learns from the market instead of
asserting a number someone once chose. The right-hand column is what **Nota**
charges for the date guarantee it sells: sourcing a notary at short notice and
holding the date. They are never one number doing both jobs.

Offers are floored at a *prix de départ* per service and hard-capped at **5×**
it, so the market is a real auction with guardrails rather than a race to the
bottom or a panic tax. Bids post to a public monthly calendar; notaries retain
the work that fits.

### 4.2 Why only two services, and why financing

Nota launches with exactly two acts, both **financing** acts, each with a
**bounded, client-assemblable intake** — a short checklist a layperson can
complete alone, in one sitting, without a professional pre-consult:

| Service | `serviceId` | Prix de départ (notary) | Nota's price | Why it qualifies |
| --- | --- | ---: | ---: | --- |
| Refinancement hypothécaire | `refinancement` | 2 000 $ | 249 $ | Loan act + hypothec publication + title review. Highest value on the platform, and the one act with a lender's deadline attached. |
| Financement hypothécaire | `financement` | 1 800 $ | 199 $ | The loan act for a **new** hypothec — a purchase or a first loan. Same ladder, no old hypothec to discharge. |

Testament and procuration were **retired**
([ADR 0010](decisions/0010-financing-first-catalogue.md)). They were the wrong
first market for a marketplace that sells a date: a will has no external
deadline, so urgency is a preference rather than a cost, and at a 650 $ or 295 $
act value Nota's own price would have weighed 30 % or more of the transaction.
A financing act arrives with a **rate hold that expires**, which is a deadline
the client did not choose and cannot move — exactly the demand a time-priced
market can serve.

*Acte de vente* stays excluded ([ADR 0003](decisions/0003-bounded-intake.md)):
it requires a coordinated document transfer between broker, surveyor and lender
before the notary can begin. That is a workflow product, not a web form — and it
is Phase 3, not Phase 1. **Discipline about what not to launch is why the
marketplace can be self-serve on day one.**

Each service carries a dynamic base price built from criteria collected as part
of the dossier — the same questions the notary needs anyway. A loan above
600 000 $ adds 350 $ and above 1 M$ adds 600 $; a private lender adds 300 $; a
notary travelling to the client adds 150–250 $, and a declared urgency signed
100 % online adds 400 $. The client gets an accurate price; the notary gets a
pre-qualified file with a complexity weighting already computed. **Note which
side of the invoice these move**: they are criteria on the *notary's* fee, not
on Nota's price, which depends only on the service and the date.

### 4.3 What is already built and deployed

This is the section that changes the risk profile of the raise.

| Component | State |
| --- | --- |
| `packages/domain` | Pure business rules — prices, tiers, cap, validation, dynamic pricing, fixtures. Zero dependencies. Asserted by tests. |
| `apps/api` | HTTP + persistence. Single-table DynamoDB, Lambda function URL, ports/adapters. Server revalidates every offer; anonymity enforced server-side. |
| `apps/web` | Public *carnet*, offer flow, dossier intake, Québec map, notary console. Vanilla JS, **zero runtime dependencies**. |
| `apps/admin` | Operator console with its own auth and test suite. |
| Payments | Stripe Connect as a platform. The client's card is registered when the offer is posted and the hold placed a few days before the signing, so a ~7-day authorization still reaches the act; at signing Nota captures on its own account and transfers the *honoraires* to the notary. Partial capture funds a late-cancellation fee, which is paid **to the notary**. |
| Notary side | Authentication, sign-up gate, lead-delivery preferences, ICS/webcal feed, earnings roll-up. |
| Email | Transactional email + scheduled reminders ([ADR 0007](decisions/0007-email-notifications.md)), CASL-compliant. |
| Analytics | Rollup statistics with drift reconciliation. |
| Infrastructure | Terraform: S3 + CloudFront (OAC) + Lambda (IAM-authed) + DynamoDB, live in `ca-central-1`. Idle cost ≈ 0 $. |
| Quality | Unit tests, jsdom smoke tests, Cucumber BDD suite, CI on every push and PR, `terraform validate`. |
| Compliance | Law 25: `ca-central-1` residency, anonymity default-on, consent at collection. Déontologie: no client-visible rating on a named notary, no share of a notary's fee anywhere in the code. |

**Architecture.** Hexagonal — a dependency-free domain core with thin adapters
for HTTP, persistence and UI. Business rules exist in exactly one place and both
the browser and the server load the *same module*, so the price a client sees and
the price the server enforces cannot drift. Thirty-seven architecture decision records document why each major choice was
made — including the four (0027, 0028, 0030, 0031) that record the revenue
model being taken apart and rebuilt against the *Code de déontologie*.

This matters commercially, not just aesthetically: **adding a third service, a
new pricing criterion, a new price grid or a new jurisdiction is a data change in
the domain package, not a rewrite.** Phase 2 and Phase 3 are cheap because Phase 1 was built
correctly.

---

## 5. Market

### 5.1 Sizing, bottom-up

**TAM — the Québec notarial profession.** ~3 900 practising notaries. At an
order-of-magnitude ~300 000 $ of annual professional fees per notary, the
profession bills on the order of **1.1–1.2 G$ CAD per year**. This is an
estimate derived from headcount, not a published figure; it is offered as scale,
not precision.

**SAM — the two financing acts.** With a fixed price per act, the number that
matters is **act volume**, not the dollars that change hands. Both are shown, and
only the right-hand column is Nota's.

| Service | Est. annual Québec volume | Typical act value | Nota's price per act |
| --- | ---: | ---: | ---: |
| Refinancement hypothécaire | ~50 000 | 2 000 $+ | 249 $ |
| Financement hypothécaire (new hypothec) | ~60 000 | 1 800 $+ | 199 $ |
| **Total** | **~110 000 acts** | **~215 M$ of notarial fees** | **~28 M$ of Nota revenue** |

Refinancing volume is inferred from the Canadian renewal cycle — ~1.2 million
fixed-rate mortgages renewing nationally in 2025, Québec at roughly a fifth of
that, with a meaningful share refinancing to a new lender and therefore
requiring a notarized hypothec. New-hypothec volume is anchored on the ~90 000
Québec residential transactions per year, most of which carry a mortgage, plus
first loans on property already owned. **Both are estimates derived from
headcount and transaction counts, not published act counts**; they are offered
as scale, not precision.

The honest consequence of the financing-first pivot: the addressable act count
is roughly a third of the retired three-service plan (~110 000 vs ~300 000),
because wills were the volume and they are gone. What replaced them is a
category with a **deadline the client did not set** — which is the only kind of
demand a time-priced market can charge for.

**SOM — Year 3.** 11 000 acts ≈ **10 % of SAM volume**, and ~2,8 M$ of the ~28 M$
of Nota revenue the category can carry. That is a materially larger share than
version 1.0 claimed, and the plan says so rather than keeping the old
denominator.

**Phase 3 horizon.** Beyond the two financing acts sits the rest of the
catalogue — most importantly the *acte de vente* on those same ~90 000
residential transactions, which arrives on the same lender deadline and through
the same referral channel. Testaments and mandates remain a real ~200 000-a-year
category the platform can return to once liquidity exists, on a pricing basis
that suits a 650 $ act. Beyond Québec sits the civil-law *notariat*: the
International Union of Notaries spans roughly 90 member states, including
France, Belgium, Switzerland and most of Latin America, all running the same
instrument Nota is built around. **That is where a 100× claim actually lives** —
not in avoiding a car trip.

### 5.2 Why now

1. **Bill 34 made the technological act permanent (Oct 2023).** The rails are
   built and sanctioned. Nota is not betting on a law passing.
2. **Fees have been deregulated for 35 years with no price discovery.** The
   market is legally free and structurally blind. That gap does not close on its
   own — someone has to build the venue.
3. **The renewal wall.** ~1.2 M Canadian fixed-rate mortgages renewing in 2025
   drives refinancing volume straight into the whole of the current catalogue —
   and every one of them arrives with a **rate hold that expires on a date the
   client did not choose**. That is the demand a time-priced market exists to
   serve, and it is why the catalogue is financing-first.
4. **A competitor has already validated the structure.** Notairo has been
   selling its own client-side intake fee in Québec since late 2025 — the same
   legal shape Nota uses. The structure is no longer novel to explain; what is
   still unbuilt is publishing the price of the **date** before the client
   commits.
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
| 1–2 | Déontologie. The client-side price is **already shipped** (ADR 0031/0034); what remains is the written legal opinion, Chambre engagement, and the taxes/disbursements line the product does not yet carry. | Opinion on file. Taxes and débours priced and displayed. |
| 1–3 | Supply. Recruit 30 Québec City notaries. Free to join, free to browse — zero friction, no card. | 25+ notaries with lead preferences configured. |
| 3–6 | Demand. SEO on real posted prices, **mortgage-broker referral partnerships first** — the broker sits on the rate hold that creates the deadline — paid search on high-intent urgency queries. | 25+ bids/month, fill rate > 45 %. |
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
difference between selling a lead and selling a *file*, and it is what Nota's
own price is charged for.

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

**Nota charges the client its own published price, per service, for Nota's own
service.** The notary keeps 100 % of their *honoraires*; Nota deducts nothing
from a professional fee. Two lines on one quote, both read by the client before
they commit anything (§2.2):

| Nota's price | `financement` | `refinancement` |
| --- | ---: | ---: |
| Service line | **199 $** | **249 $** |

| Date guarantee, added to Nota's line | `standard` | `rapide` | `prioritaire` | `urgence` | `extreme` |
| --- | ---: | ---: | ---: | ---: | ---: |
| | 0 $ | **50 $** | **100 $** | **200 $** | **300 $** |

So Nota's revenue on one act runs from **199 $** (a financing act on a calm
date) to **549 $** (a refinancing signed the same day). The grid lives in
`packages/domain` and is editable from the admin console without a deploy; the
two lines are **frozen on the offer** when the client's card is engaged, so a
later grid change can never rewrite what an act cost.

Charged only on a **completed** act. The card is registered when the offer is
posted and the hold placed a few days before the signing, so a posted bid is a
real commitment and the notary is never chasing payment.

**Taxes (GST/QST) and disbursements — registry publication fees, RDPRM,
discharges — are in neither line and appear nowhere in the product yet.** Until
they do, no surface may describe the amount as all-inclusive; art. 71 3° of the
*Code de déontologie* requires saying whether they are included, and art. 68
forbids incomplete advertising. Fixing this is a Phase 1 exit criterion (§6),
not a nicety.

**Expansion levers, in order of confidence:**

1. **Raise the grid, per service and per tier.** The most direct lever, and the
   one the shipped architecture makes free: the grid is data, edited from the
   console. §8.2 shows that two rungs of the date ladder currently cost Nota
   money to sell, which is where the first increase belongs.
2. **Widen the catalogue.** *Acte de vente* rides the same lender deadline and
   the same referral channel; each new service is a data change plus its own
   published price.
3. **Notary practice tooling** — the exception layer, calendar feed and dossier
   inbox as software sold to the notary. This is a **flat subscription for
   software**, never a deduction from an act, which is what makes it safe under
   art. 32; it is the [ADR 0001](decisions/0001-flat-fee-not-commission.md)
   model reintroduced only where it cannot touch a fee.
4. **Data products** — the urgency curve, priced regional benchmarks. Later, and
   only with clean aggregation.

### 8.2 Unit economics — computed from the shipped grid

**The cost of revenue is not small, and version 1.0 understated it badly.** Nota
is the Stripe **platform**: the client's card is charged the **total** of both
lines on Nota's own account (`separate charges and transfers`), and the
*honoraires* are transferred out afterwards. So the card-processing fee is levied
on the whole amount — **including the notary's fee, which Nota never keeps** —
and Nota bears all of it. At Stripe's published Canadian domestic-card rate
(**2.9 % + 0.30 $**; it is not a constant in the code, and the code never books
it), one refinancing act on a calm date reads:

```
client pays        2 000 $ (notary)  +  249 $ (Nota)  =  2 249,00 $
Stripe             2.9 % × 2 249 $   +  0,30 $        =     65,52 $
Nota keeps         249 $ − 65,52 $                    =    183,48 $   → 73,7 % margin
notary receives    2 000,00 $ — whole
```

Per service and per tier, at the recommended offer for each tier:

| Service · tier | Notary's fee | Nota's price | Client total | Stripe | **Nota's gross profit** | Margin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `financement` · standard | 1 800 $ | 199 $ | 1 999 $ | 58,27 $ | **140,73 $** | 70,7 % |
| `financement` · rapide | 3 600 $ | 249 $ | 3 849 $ | 111,92 $ | **137,08 $** | 55,1 % |
| `financement` · prioritaire | 5 400 $ | 299 $ | 5 699 $ | 165,57 $ | **133,43 $** | 44,6 % |
| `financement` · urgence | 6 300 $ | 399 $ | 6 699 $ | 194,57 $ | **204,43 $** | 51,2 % |
| `financement` · extrême | 7 200 $ | 499 $ | 7 699 $ | 223,57 $ | **275,43 $** | 55,2 % |
| `refinancement` · standard | 2 000 $ | 249 $ | 2 249 $ | 65,52 $ | **183,48 $** | 73,7 % |
| `refinancement` · rapide | 4 000 $ | 299 $ | 4 299 $ | 124,97 $ | **174,03 $** | 58,2 % |
| `refinancement` · prioritaire | 6 000 $ | 349 $ | 6 349 $ | 184,42 $ | **164,58 $** | 47,2 % |
| `refinancement` · urgence | 7 000 $ | 449 $ | 7 449 $ | 216,32 $ | **232,68 $** | 51,8 % |
| `refinancement` · extrême | 8 000 $ | 549 $ | 8 549 $ | 248,22 $ | **300,78 $** | 54,8 % |

**A finding this table makes unavoidable: two rungs of the date ladder cost Nota
money to sell.** Moving a refinancing from `standard` to `prioritaire` adds
100 $ to Nota's line and **118,90 $** to the Stripe fee — Nota is 18,90 $ *worse
off* on the more urgent act. The same at `rapide` (+50 $ of revenue against
+59,45 $ of fee). Only `urgence` and `extrême` pay for the cost they create.

| Refinancement, vs `standard` | Date line | Extra Stripe fee | Net to Nota |
| --- | ---: | ---: | ---: |
| `rapide` | +50 $ | +59,45 $ | **−9,45 $** |
| `prioritaire` | +100 $ | +118,90 $ | **−18,90 $** |
| `urgence` | +200 $ | +150,80 $ | +49,20 $ |
| `extrême` | +300 $ | +182,70 $ | +117,30 $ |

This is arithmetic, not opinion, and it is the single most actionable number in
the plan: the middle of the urgency ladder — where most urgent demand actually
sits — is priced below its own cost of collection. Three remedies exist, all
data changes: raise the `rapide` and `prioritaire` lines, add a small
percentage component to Nota's line so it tracks the fee it generates, or move
the notary's fee off the platform charge entirely. **This is an owner decision
and no code has been changed for it here.**

**Blended, on a modelled mix** — 60 % `refinancement` / 40 % `financement`, and
70 % `standard` · 18 % `rapide` · 7 % `prioritaire` · 3 % `urgence` · 2 %
`extrême` (the mix is a modelling assumption, stated so it can be argued with;
the prices are not):

| Per completed act | |
| --- | ---: |
| Notary's fee (paid whole to the notary) | 2 794 $ |
| **Nota's revenue** | **257 $** |
| Card processing (Stripe) | (89) $ |
| **Nota's gross profit** | **168 $** |
| **Gross margin** | **66 %** |

| | Y1 | Y2 | Y3 |
| --- | ---: | ---: | ---: |
| Nota revenue per act | 257 $ | 257 $ | 257 $ |
| Gross profit per act | 168 $ | 168 $ | 168 $ |
| Blended client CAC | 164 $ | 55 $ | 40 $ |
| **Contribution per act** | **4 $** | **113 $** | **128 $** |
| Gross margin | 66 % | 66 % | 66 % |

Version 1.0 claimed 89–91 % gross margin and a (70) $ Year 1 contribution. Both
were wrong in the same direction: the margin was overstated because the Stripe
fee was applied to Nota's own line instead of the whole charge, and the
contribution was understated because revenue per act was pinned to a 10 % cut of
a 1 056 $ act — a catalogue that no longer exists.

**A structural point worth stating plainly.** Because Nota's price does not
scale with the act, **gross profit per act is nearly flat** across the whole
urgency ladder — between 133 $ and 301 $ — while the amount changing hands
varies four-fold. Revenue is therefore a function of **act count**, not of GMV.
Every growth argument in this plan has to be an argument about volume.

**Break-even, from the same numbers.** At 168 $ of gross profit per act:

| | Operating expense | Break-even acts | Per month | Plan volume |
| --- | ---: | ---: | ---: | ---: |
| Y1 | 250 000 $ | 1 487 | 124 | 244 |
| Y2 | 720 000 $ | 4 280 | 357 | 2 800 |
| Y3 | 1 850 000 $ | 10 997 | 917 | 11 000 |

Year 1 and Year 2 are deliberately below break-even — that is what the raise
buys. **Year 3's planned volume lands within a hundred acts of covering its own
cost base**, which is a cleaner story than version 1.0's, where Year 3 still lost
390 850 $.

**Notary economics.** Notary CAC ≈ 500 $ (the 15 000 $ field-sales line ÷ 30
notaries). A notary retaining 20 acts a year generates **3 365 $** of annual
gross profit — 10 094 $ over a three-year tenure. **LTV/CAC ≈ 20×**, payback
inside **three acts**. Supply, not demand, is where the compounding is.

### 8.3 The repeat-purchase problem, stated plainly

**A financing act recurs on the renewal cycle, not on a whim** — every five
years for a typical fixed-rate mortgage, and sooner when rates move. That is
better than the retired will-and-mandate catalogue, where a client bought once a
decade, but it is still not a subscription and this plan does not pretend
otherwise. Three things carry the business instead:

1. **Supply is the durable asset.** Notaries are recurring, not one-time. Every
   notary recruited compounds; the network is the moat. At payback inside three
   acts (§8.2), supply spend is the highest-return line in the budget.
2. **Organic demand capture.** The public carnet is a continuously refreshed,
   hyper-local, high-intent corpus of *real posted prices* — structurally the
   best possible answer to "combien coûte un refinancement chez le notaire à
   Québec ?". No competitor can index what they do not transact.
3. **Zero-CAC referral channels.** Mortgage brokers above all: the broker sets
   the rate hold that creates the deadline Nota prices, and currently has
   nowhere structured to send a client who needs a notary inside it. Real-estate
   agents and financial planners sit one step further out on the same path.

---

## 9. Competition

| | What they do | Where Nota differs |
| --- | --- | --- |
| **Notairo** | Montréal legal-tech, launched Oct 2025; digital preparation of real-estate closings and refinancings, signature in person. Sells its own **295 $ « frais de prise en charge de dossier »** on a Shopify storefront, with the notary's fees paid directly to the notary at signing. | Closest analogue, and **external validation of the structure**: Notairo is already selling exactly the shape of ADR 0031 in Québec. It advertises « à partir de 949 $ » while its actual packages list at 1 795–2 225 $, and prices urgency in the fine print. Nota differs on the mechanism: the price of the date is published **before** the client commits, not added afterwards. |
| **Nolos** | Online notarized wills, ~21 service points in Québec. | A distribution network with set prices — a chain, not a market. No urgency pricing, no notary-side liquidity. Out of the current catalogue since ADR 0010. |
| **Neolegal / ScriptaLegal** | Online legal services and document generation, notarial add-ons. | Document-first, price-set. Do not sell notary *availability*. |
| **Traditional practice** | Phone, referral, signage. | The real competitor. Nota wins by pricing time, which the phone cannot do. |
| **US remote-notarization platforms** | Volume RON for common-law notaries public. | Structurally cannot enter: a Québec *notaire* is a civil-law public officer, not a notary public, and their commission-on-the-professional's-fee model is exactly what art. 32 forbids here. |

**Nota is the only participant selling *when*, not *what*.** Every competitor
prices a document; several now charge the client their own intake fee, which is
the same legal structure Nota uses. None of them **publishes the price of the
date before the client commits** — Notairo's own site chiffres nothing for
urgency and says only that additional fees may apply. That is a different
market, and it is the one that has never had a venue.

Two facts worth stating without embellishment: Notairo's published intake fee is
**295 $**, against Nota's **199 $ / 249 $** grid; and Nota's price is compared
here to another *platform's* price, never to a notary's fees — art. 32.1 1° of
the *Loi sur le notariat* reaches an intermediary who claims to charge less than
a notary, and no Nota surface makes that claim.

**Defensibility, honestly ranked:** (1) the urgency price curve, which requires
running the marketplace to obtain — and which the domain already *learns* from
retained offers rather than asserting; (2) the notary network, which is slow and
in-person to build; (3) the déontologie structure plus a written opinion, which
an outside entrant will not know to build — Notairo's 295 $ product shows the
structure is discoverable, but not the four-article reasoning behind the two-line
quote; (4) the exception-layer compliance product, which requires understanding
art. 46 well enough to productize it. None of these are patents. All of them are
years.

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
2. **Referral partnerships (~0 $ CAC).** Mortgage brokers first and by a wide
   margin — the broker sets the rate hold whose expiry is the deadline Nota
   prices, and currently has nowhere structured to send a client who needs a
   notary inside it. Real-estate agents and financial planners sit one step
   further out on the same path. Referring professionals earn a flat reward paid
   from Nota's own funds — **50 $** when a referred client's demand is retained,
   **250 $** when a referred notary retains their first act — never deducted
   from the notary's fee and never added to the client's price.
3. **Paid, urgency-targeted.** Search on high-intent, high-urgency queries where
   the tier premium makes the economics work — a client who needs a signature in
   48 hours has a demand curve nothing else on the platform matches.

**Positioning to the profession matters as much as positioning to clients.** Nota
never touches the act, **takes nothing out of a notary's fees**, and never
disintermediates the notary-client relationship. It sells demand into empty calendar slots and hands
over complete files. The message to the Chambre is *demand generation for the
profession*, and the plan is to have that conversation early and in writing
rather than be discovered later.

---

## 11. Traction plan and milestones

| Milestone | Target | Why it matters |
| --- | --- | --- |
| Taxes and disbursements priced and displayed | Month 1 | Art. 71 3° and art. 68. A quote that omits them cannot be shown to a client. |
| Déontologie opinion on file | Month 2 | Qualifies Nota's own price. Unblocks everything downstream. |
| 25 notaries live, Québec City | Month 3 | Supply-side liquidity threshold. |
| First 10 acts completed | Month 5 | The mechanism clears with real money. |
| Fill rate > 45 % | Month 6 | The market is functioning, not just posting. |
| Grid re-priced against realized Stripe cost | Month 6 | Closes the negative middle of the date ladder (§8.2) with real data, not an assumption. |
| Urgency curve published | Month 8 | Proprietary data asset exists and is demonstrable. |
| Exception layer shipped | Month 9 | Phase 2 wedge live; remote acts become routine. |
| Fill rate > 60 %, 90 bids/mo | Month 11 | Liquidity proven. Series-A narrative intact. |
| 244 acts, 62 700 $ of Nota revenue | Month 12 | Bottom of the J-curve, with the curve visible. |

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
| Infrastructure, digital-signature certificates, insurance, tooling | 12 000 $ | Serverless keeps this small — the AWS stack idles at ~0 $. **Card processing is not here**: it is a cost of revenue (§8.2), ~21 700 $ in Year 1 at plan volume. |
| Contingency | 17 000 $ | ~7 %. |
| **Total** | **250 000 $** | ~20 800 $/mo average burn |

**Non-dilutive stacking.** As a Québec CCPC with a technical founder doing
eligible development, refundable SR&ED and Québec R&D wage credits can return a
meaningful share of the salary line, and IRAP is a live option. Conservatively
treated as runway extension, not as budgeted revenue — it plausibly buys 2–3
extra months.

### 12.2 Three-year projection

Recomputed from the shipped grid (§8.2). Volumes and operating expense are the
same plan as version 1.0; every money line below is new.

| | Y1 (2026-27) | Y2 (2027-28) | Y3 (2028-29) |
| --- | ---: | ---: | ---: |
| Notaries on platform | 30 | 220 | 700 |
| Bids posted | 434 | 4 912 | 17 742 |
| Fill rate | 56 % | 57 % | 62 % |
| **Acts completed** | **244** | **2 800** | **11 000** |
| Notary fees paid through the platform | 682 000 $ | 7 822 000 $ | 30 730 000 $ |
| Total charged to clients | 744 000 $ | 8 542 000 $ | 33 557 000 $ |
| **Nota revenue** (257 $ × acts) | **62 700 $** | **719 600 $** | **2 827 000 $** |
| Card processing | (21 700) $ | (248 500) $ | (976 400) $ |
| **Gross profit** | **41 000 $** | **471 100 $** | **1 850 600 $** |
| Gross margin | 66 % | 66 % | 66 % |
| Operating expense | (250 000) $ | (720 000) $ | (1 850 000) $ |
| **Net** | **(209 000) $** | **(249 000) $** | **+600 $** |
| Headcount (FTE) | 1 + contract | 4 | 10 |

**Cumulative capital required through Y3: ~460 000 $** — down from the
~1,05 M$ of version 1.0, because Nota's revenue per act is now 257 $ rather than
a 10 % cut of a 1 056 $ act, and the act values themselves are financing acts.
Y2 assumes province-wide matching is live; Y3 assumes the catalogue has widened
toward the *acte de vente*.

**Three sensitivities an investor should press on, all of which the model
exposes rather than hides:**

- **Volume is the only lever.** Nota's price does not scale with the act, so
  revenue is act count × ~257 $. Halve the act count and you halve the revenue;
  double the average act value and nothing changes except the Stripe bill.
- **The mix moves gross profit far less than it moves GMV.** Across the whole
  urgency ladder gross profit per act stays between 133 $ and 301 $ (§8.2). A
  pessimistic all-`standard` mix still yields 166 $ per act.
- **Card processing is the whole cost of revenue, and it grows with the
  notary's fee.** Every 1 000 $ added to a typical act adds 29 $ to Nota's cost
  and nothing to its revenue. This is why §8.2's re-pricing milestone sits at
  Month 6.

**Series A trigger:** exiting Y2 at a **700 K$ revenue run-rate with province-wide
liquidity proven and the exception layer in production** — raising ~3 M$ against
the full act catalogue and the first UINL corridor.

### 12.3 What has to be true

Four assumptions carry the model, and each has a named falsification test:

1. **Clients will pay a premium for a date.** *Test:* the realized premium
   distribution by tier in Phase 1. If `urgence` and `extreme` bids do not clear
   above `standard`, the core thesis is wrong and it is visible by month 6 for
   well under 100 K$.
2. **Notaries will sell short-notice availability.** *Test:* fill rate on
   `prioritaire`/`urgence` tiers specifically. Visible by month 5.
3. **Clients will pay Nota's own price on top of the notary's fee.** *Test:* the
   abandonment rate at the quote screen, where both lines are shown together
   before any card is engaged. Visible from the first fifty bids. This is a
   different question from (1) and version 1.0 never asked it, because a
   percentage taken out of the notary's fee was invisible to the client.
4. **Nota's own price is déontologically safe as structured.** *Test:* a written
   legal opinion, month 2. The direction of the money is already settled and
   verifiable on the Stripe wire; the qualification is not.

**Every one of these is answered inside this raise.** That is the argument for
the round size: 250 000 $ is enough to falsify or confirm the whole thesis, and
not a dollar is spent building something that has not been validated.

---

## 13. Team

**Anthony Paquet — founder.**

The case is the repository. Working solo: a hexagonally architected monorepo
with a dependency-free domain core; an HTTP/DynamoDB API on an IAM-authed Lambda
behind CloudFront OAC; a zero-runtime-dependency SPA; Stripe Connect payments
with deferred card holds, partial capture and reconciliation; notary and admin
authentication with role-based permissions; transactional email with scheduled
reminders; an ICS feed; analytics rollups with drift healing; Terraform
infrastructure live in `ca-central-1`; a Cucumber BDD suite and a Playwright
end-to-end suite; CI running unit, contract, DOM, BDD, E2E and
`terraform validate` on every push; Law 25 compliance designed in rather than
bolted on; and **thirty-seven architecture decision records** explaining the
reasoning — including the sequence that dismantled the platform's own revenue
model when four articles of Québec notarial law turned out to forbid it.

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
| **Qualification of Nota's own price under art. 32.1 L.N.** | **Critical** | The fee *share* is gone: the notary receives 100 % of their *honoraires* and Nota charges the client its own published price (§2.2, ADR 0031/0034). What remains is qualification, not structure. Written opinion budgeted at 20 K$, month 2; a flat per-act fee billed outside the act is the fallback structure. |
| **A retired claim survives in a document** | High | The 10 % commission, the 75/25 split, the 5–15 % cote-driven cut and the flat 400 $ price are all retired. They are wrong *and* they describe an arrangement Québec law forbids Nota from having, so every dated audit that cites them carries a retirement banner and this plan states the discipline in §2.2. |
| **Taxes and disbursements are not in the quote** | High | Art. 71 3° requires saying whether they are included; art. 68 forbids incomplete advertising. Priced and displayed as a Month 1 milestone (§11) before any client-facing claim of completeness. |
| **Art. 46 keeps remote signing exceptional** | High | Phase 2 is designed to be fully valuable under the current statute. The exception categories are large and under-served. Liberalization is upside, not plan. |
| **Cold-start liquidity fails** | High | Supply is free and frictionless. One dense city first. Fill rate monitored weekly with an explicit floor-adjustment lever. |
| **Low client repeat rate** | Medium-High | Supply-side moat, compounding organic capture, zero-CAC referral channels, recurring refinancing (§8.3). |
| **Chambre opposition** | Medium-High | Early, written, partnership-framed engagement. Nota never touches the act and takes nothing out of a notary's fees. Positioned as demand generation for the profession. |
| **The date ladder's middle is priced below its own cost** | Medium | Arithmetic, already measured (§8.2): `rapide` and `prioritaire` lose 9,45 $ and 18,90 $ against the Stripe fee they create. The grid is data, edited from the console without a deploy; re-priced against realized cost at Month 6. |
| **A funded competitor copies the mechanism** | Medium | The price curve requires running the market to obtain; the notary network is slow and in-person; the déontologie structure is non-obvious from outside Québec. |
| **Solo-founder key-person risk** | Medium | ADRs, BDD specs, early Y2 engineering hire. |
| **Race to the bottom on price** | Low | Hard floors per service ([ADR 0006](decisions/0006-service-floor-prices.md)) and a **5×** cap, enforced server-side in the domain core. |
| **No verification against the Tableau de l'Ordre** | Medium-High | The only check today is the URL format of a CNQ fiche. A real status check and an immediate-removal path are prerequisites to the first live act, not Phase 2 work. |
| **Law 25 / privacy incident** | Low-Medium | `ca-central-1` residency, anonymity default-on, consent at collection, right-to-erasure on the roadmap. |

---

## 15. The ask

**250 000 $ CAD pre-seed. 12 months.**

Structure: SAFE or convertible note, with an angel lead. An angel lead and an
accelerator relationship are explicitly targeted in this round because both are
prerequisites for Investissement Québec's Fonds Impulsion (250 K$–1 M$) as the
month-9-to-12 follow-on.

**What the money buys:**

- A written legal opinion on file qualifying Nota's own price — the structure
  (client-side, per service, nothing out of the notary's fee) is already shipped.
- 30 notaries and a functioning two-sided market in Québec City.
- 244 completed acts, ~62 700 $ of Nota revenue, and the first urgency price
  curve for the Québec notarial market — a dataset that does not otherwise
  exist, and one the pricing engine already knows how to learn from.
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

Thirty-seven ADRs live in [`docs/decisions/`](decisions/). The ones that carry
this plan:

**The revenue model, and its dismantling.** Read these four in order — they are
the record of the platform taking apart its own economics when Québec notarial
law turned out to forbid them.

- [ADR 0027 — Partage 75/25 selon la cote client](decisions/0027-partage-75-25-cote-client.md) *(retired)*
- [ADR 0028 — La cote sur 100 décide le partage](decisions/0028-la-cote-sur-100-decide-le-partage.md) *(retired)*
- [ADR 0030 — La déontologie prime : la cote ne se publie pas](decisions/0030-la-deontologie-prime-la-cote-ne-se-publie-pas.md)
- **[ADR 0031 — Le prix de Nota est celui de Nota](decisions/0031-le-prix-de-nota-est-celui-de-nota.md)** — the share is removed; the notary keeps 100 %
- **[ADR 0034 — Le prix de Nota est une grille par service](decisions/0034-le-prix-de-nota-est-une-grille-par-service.md)** — the single price becomes the grid this plan is costed on

**The catalogue and the price of time.**

- [ADR 0003 — Bounded intake](decisions/0003-bounded-intake.md)
- [ADR 0006 — Service floor prices](decisions/0006-service-floor-prices.md)
- [ADR 0010 — Financing-first catalogue](decisions/0010-financing-first-catalogue.md) — testament and procuration retired
- [ADR 0011 — Partner referral rewards](decisions/0011-partner-referral-commission.md)

**Money movement.**

- [ADR 0015 — Paid at signing](decisions/0015-paid-at-signing.md)
- [ADR 0023 — Late-cancellation fee](decisions/0023-late-cancellation-fee.md)
- [ADR 0029 — An off-platform settlement is a receivable](decisions/0029-un-reglement-hors-plateforme-est-une-creance.md)
- [ADR 0033 — La mise en relation est complète](decisions/0033-la-mise-en-relation-est-complete.md) — the cancellation fee goes to the notary
- [ADR 0035 — La caution tient jusqu'à la signature](decisions/0035-la-caution-tient-jusqua-la-signature.md)

**Platform and architecture.**

- [ADR 0001 — Flat fee, not commission](decisions/0001-flat-fee-not-commission.md) *(superseded — the notary pays nothing at all)*
- [ADR 0002 — Single-table DynamoDB](decisions/0002-single-table-dynamodb.md)
- [ADR 0004 — CloudFront OAC + IAM-authed Lambda](decisions/0004-cloudfront-oac-iam-api.md)
- [ADR 0005 — Stripe](decisions/0005-stripe-flat-subscription.md) *(the flat subscription it names is retired)*
- [ADR 0007 — Email notifications](decisions/0007-email-notifications.md)

**Compliance dossiers**, which an investor's counsel should read before this
plan: [`docs/legal/`](legal/) — the déontologie file, the draft client and
notary terms, the Law 25 policies — and [`docs/compliance/`](compliance/) — the
claims audit, the transaction audit trail and the SOC 2 gap analysis. Each of
those carries a banner where it describes the retired revenue share, because
they are dated records and the history is not rewritten.
