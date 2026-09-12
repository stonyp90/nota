# Notary calendar positioning — 2026-09-12

The notary landing now leads with subscribing to the public calendar, opening
an offer and confirming acceptance in Nota. Calendar subscription precedes the
account gate on desktop and precedes the benefits/inventory on compact screens.
The existing brand tokens and logo are retained. French copy has English entries.

The UI distinguishes an ongoing calendar subscription from a downloaded ICS
snapshot. Provider polling controls delivery; it does not promise instant
notifications. The existing ICS event URL opens the offer, and retention remains
an authenticated, explicitly confirmed action. No acceptance or billing rules
were changed.

Urgency is presented as a potential opportunity, with the fair/reasonable fee
obligation. The landing links to the official Code and the Bureau du syndic's
warning, and identifies competence/resources, conflicts, confidentiality,
independence and fee obligations. It does not claim Chambre approval or certify
an individual notary's compliance. The project's legal assessment still requires
written qualification of the separate per-act client fee.

Sources checked on 2026-09-12:

- [Official Code, current PDF dated April 15, 2026](https://www.legisquebec.gouv.qc.ca/fr/pdf/cr/N-3,%20R.%202.pdf), particularly articles 8, 29–32, 35, 49 and 51.
- [Bureau du syndic warning, January 25, 2024](https://www.cnq.org/la-chambre-et-votre-protection/actualites-et-salle-de-presse/loi-23-mise-en-garde-du-bureau-du-syndic/).
- Repository assessment: `docs/legal/conformite-deontologique-notaires.md`, section 1 and risk table.

Verification:

- 28 content, translation and introductory UI tests passed.
- 11 ICS tests passed.
- 39 notary feed, focus and sign-up regression tests passed, including explicit
  confirmation before retention and background offer refresh.
- Both calendar retention browser journeys passed: direct acceptance and a
  counter-offer accepted by the client, with client/signing calendar consistency.
- Four landing browser cases passed: French/English at 390/1440 pixels, including
  subscription URL, ordering, legal disclosure and horizontal overflow.
- 12 surface checks passed: signed-out landing and authenticated console across
  Chromium, Firefox, WebKit, iPhone, Android and iPad configurations.
- Light and dark desktop views inspected in the local browser; corrected the
  narrow calendar layout and removed the floating amount's heading overlap.
- Web build and whitespace checks passed.

Browser journeys use local memory persistence and development sign-in. They do
not verify ingestion or notification timing in real Google/Outlook/Apple accounts.
Changes are local; no production deployment was performed.
