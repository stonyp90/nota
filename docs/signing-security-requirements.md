# Nota signing: security requirements and trust boundaries

Date: 2026-09-09. **Target requirements for the authorized legal workflow.** This specification supplements [the ceremony plan](secure-signing-plan.md). The [working rehearsal beta](signing-beta-release.md) implements a subset and documents its remaining gaps. This specification is neither a security assessment of deployed Nota nor evidence of Chambre des notaires du Québec (CNQ) approval. “Must” below defines proposed acceptance criteria. Standards inform the engineering design; they do not confer legal approval.

## Security promise and boundaries

The intended property is that live audio, video and screen sharing are intelligible only at the admitted customer/notary endpoints, extended explicitly to required witnesses or interpreters. Nota's media infrastructure must have no media decryption keys. Document storage, identity verification, signaling metadata and the signature provider have separate trust boundaries; media E2EE does not encrypt all dossier information.

WebRTC authenticates encrypted media transports, but malicious signaling can substitute peers unless identities are securely bound to endpoint keys. Its security architecture also trusts the browser and acknowledges limitations in deployed peer-identity mechanisms. [IETF RFC 8827, §§3–4](https://www.rfc-editor.org/rfc/rfc8827.html)

| Boundary | Proposed access and responsibility |
| --- | --- |
| Customer/notary devices | Plaintext media and documents they are authorized to view. Malware, extensions, external recording and off-camera coercion remain risks. |
| TURN/media forwarding service | Encrypted media; necessary connection metadata. No content keys or silent observer. |
| Nota control plane | Membership, authorization, decision references and minimized operational events. No media content. |
| Identity/signature providers | Only information necessary for their contracted function, with authenticated results and scoped access. |
| Web application delivery | Security-critical: whoever can replace executing room JavaScript can capture plaintext before encryption. |

**E1 — Delivery trust.** Isolate the signing origin, exclude analytics and third-party scripts, restrict CSP/Permissions Policy, protect releases with independent review and deployment audit, and test document-renderer isolation. CSP and integrity attributes cannot defend against a malicious publisher that can replace the page and its policies. Claiming protection against that publisher requires a separately distributed, independently verifiable client and update-trust design; ordinary browser delivery cannot substantiate it.

## Mandatory enrollment and verified participants

**I1 — Individual accounts.** Require registration and verified contact details for every signer before dossier access. Invitations must be single-use, expiring and bound server-side to the intended account, dossier and role. Shared accounts and unauthenticated guest signatures are disallowed. Test stolen invitations, wrong-account acceptance and cross-dossier access.

**I2 — Identity proofing.** Keep identity evidence validation, person-to-evidence verification and account enrollment as separate recorded outcomes. The notary approves the procedure and resolves failures; an email link, SMS code or face on video is insufficient alone. Retain the necessary outcome/reference, limiting identity images to the approved custody policy. [NIST SP 800-63A-4](https://pages.nist.gov/800-63-4/sp800-63a.html) provides useful proofing distinctions, not Quebec notarial authorization.

**I3 — Authentication and recovery.** Require phishing-resistant authentication for notaries and strong multifactor authentication for customers, with passkeys as the default. Define an accessible, reviewed recovery/fallback route with equivalent risk controls. Require fresh authentication before signature release and signer intent confirmation. Recovery, a new device or replacement authenticator suspends existing releases until the required rechecks finish. Test replay, expired sessions and recovery-based takeover. [NIST SP 800-63B-4](https://pages.nist.gov/800-63-4/sp800-63b.html)

**I4 — Passkey verification.** Verify challenge, origin, RP ID, credential ownership, signature and required user-verification flag on the server. Device PIN/biometric verification demonstrates authenticator use; it does not establish the customer's civil identity or produce the official notarial signature. Bind the one-use step-up challenge to the specific actor, ceremony, document version and action. [W3C WebAuthn](https://www.w3.org/TR/webauthn-3/)

**I5 — Professional authority.** Verify notary identity, entitlement to practise and required signing credential through the applicable authoritative process. Only the acting notary decides remote eligibility, identity sufficiency, capacity, free consent, legal explanation, witnesses and closure. Automated readiness checks cannot override a negative or missing notary decision; support staff cannot impersonate the notary.

## Media encryption and ceremony control

**E2 — Authenticated endpoints.** For a two-person evaluation, use browser-to-browser DTLS-SRTP, with TURN relaying encrypted packets when necessary. Bind fresh endpoint keys and the ceremony identifier to verified participant identities using a reviewed authentication protocol. Provide a peer-verification step and key-change alerts. A code supplied solely by the signaling server is not independent authentication. Test malicious fingerprint substitution and admission changes.

**E3 — Group topology.** An SFU must forward application-encrypted frames without possessing content keys. Use an independently reviewed implementation; do not invent cryptography. SFrame is one candidate, but it requires separate key management, membership rotation and replay protection, and does not itself supply per-sender authentication. Treat authorship evidence separately. [IETF RFC 9605, §§5, 7, 9](https://www.rfc-editor.org/rfc/rfc9605.html)

**E4 — No downgrade.** Fail closed when required encryption, peer verification or browser capability is unavailable. Re-key on admission, removal and reconnection as required by the selected protocol. Demonstrate that removed devices cannot decrypt subsequent media, injected/replayed frames are rejected, and server captures contain no decodable content. Retain only non-secret diagnostic evidence; never log keys.

**C1 — Human control.** The Nota room must display the admitted roster, notary, document version and actual encryption state, with bilingual accessible pause controls. Signing requires current notary release and required participant observation. Loss of observation suspends new releases; resumption requires a notary decision. Full-screen improves focus but does not prevent screen capture or establish identity.

## Recording and final signature

**R1 — Strict E2EE mode.** Disable service-side recording, transcription and AI media processing. A recorder that decrypts content becomes an additional endpoint, changing the customer/notary-only promise. Any separately authorized endpoint recording requires its own necessity, consent, access and retention design; endpoint-encrypted upload is possible, but subsequent replay access must be explicit. Never portray browser recording as unalterable evidence.

Microsoft's current Teams E2EE documentation disables recording/transcription and excludes the Web client. Supported desktop/mobile participation therefore needs evaluation for any optional Teams integration; an embedded Teams browser experience cannot be assumed. [Microsoft Teams E2EE, updated 2026-08-28](https://learn.microsoft.com/en-us/microsoftteams/teams-end-to-end-encryption)

**S1 — Authorized provider.** Require written confirmation of the applicable CNQ workflow, exact tenant/product, official-signature credentials and integration rights before live use. Generic vendor availability is insufficient. Notarius documents that embedded signing needs a configured organization tenant and transfers signer authentication responsibility to the embedding platform. [ConsignO Cloud Basic API](https://support.notarius.com/wp-content/uploads/api/consigno-cloud-api-en.html)

**S2 — Provider-side release.** Prove that signing cannot bypass Nota through an old link, another tab, provider email or direct request. Bind release to signer, immutable document/annex manifest, order, session and expiry. Test withdrawal while a provider operation is in flight. If the provider cannot enforce timely suspension/revocation, this integration fails the proposed gated workflow; disabling a Nota button is insufficient.

**S3 — Verified closure.** Retrieve and verify provider results server-side: intended participants, document lineage, allowed PDF revisions, signature coverage, certificate chain and applicable revocation/timestamp evidence. A redirect or webhook alone cannot close the act. The notary applies their official credential under their control; Nota's audit seal is supporting evidence. Verify preservation receipts separately. Preserve signed artifacts through reconciliation; pending preservation, payment or delivery cannot reverse an already executed act.

The provider workflow must let the notary apply the official signature immediately after the final party signature, within the required notary-controlled sequence. Check readiness before releasing signatures. An asynchronous verification worker must not defer the legal closure step; delayed evidence verification leaves Nota's confirmation pending. [CNQ closure specification, §3(d)](https://www.cnq.org/wp-content/uploads/2024/07/877502-2024_07_26_cahier_charges_solution_cloture_v1.1.pdf)

## Evidence required before a live pilot

The security lead must produce the threat model, independent assessment, adversarial test results, deployment evidence, recovery drill and resolved critical/high findings. The practising notary and legal/privacy reviewers must confirm the exact act scope, identity process, video configuration, signature workflow and custody arrangements. Record the required CNQ/provider permissions explicitly.

Every control above remains **unverified** until its evidence is attached. Demonstrations must identify simulated steps and use synthetic identities/documents. Successful demonstrations support an evaluation request; they do not establish approval, perfect security or legal validity for every act.
