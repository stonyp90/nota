# 3. Three services with a bounded, client-assemblable intake

- Status: Accepted
- Date: 2026-08-12

## Context

For a marketplace to work, a client must be able to post a complete, actionable
request **by themselves**, in one sitting, without a professional pre-consult.
That only holds for acts whose intake is *bounded*: a short, well-understood
checklist of documents and facts a layperson can assemble.

Not every notarial act is like that. Some require a professional file to be
assembled and transferred between parties before the notary can even begin —
which is a coordinated document transfer, not a web form.

## Decision

Nota launches with **exactly three services**, each with a bounded,
client-assemblable intake defined in `packages/domain` (its own document
checklist and info fields, each with plain-language fr-CA help text):

- **Testament et mandat de protection** — *prix de départ* 495 $
- **Procuration** — *prix de départ* 295 $
- **Refinancement hypothécaire** — *prix de départ* 950 $

**Acte de vente (real-estate purchase) is deliberately excluded.** A sale cannot
be reduced to a self-serve form: it depends on a **promesse d'achat**, a
**certificat de localisation**, and **lender instructions**, all of which arrive
from third parties (broker, surveyor, financial institution) on their own
timelines. That is a professional file transfer between parties, not something a
client can assemble alone at the moment they post a date — so it does not fit the
marketplace's "post your date and price" model.

## Consequences

- **Positive:** every listable service has an intake a client can actually
  complete, keeping the post-a-bid flow honest and self-serve; the domain's
  service list stays small and fully specified with checklists and help text;
  onboarding copy and the TTS reader have concrete, bounded content to work from.
- **Negative / trade-offs:** Nota forgoes real-estate purchase volume, a large
  segment, at launch; adding it later means designing a multi-party document
  exchange (out of scope for the current bounded-intake model), not just adding
  a row to the service list.
- **Guardrail:** new services must clear the same bar — a bounded intake a client
  can assemble alone — before being added to `packages/domain`.
