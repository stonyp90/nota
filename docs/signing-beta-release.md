# Nota signing room — working rehearsal beta

Date: 2026-09-09. This describes the implemented rehearsal, not authorization to execute notarial acts. Deployment verification is recorded in `docs/qa/signing-beta/`.

## Public entry and integration

The bilingual **Bêta** section at `/#t=beta` is available from desktop navigation,
the mobile menu, the footer and the notary workspace. Its primary action opens
`/signature.html`, where a visitor can preview their camera without an account.
Retained dossier links continue to open the authenticated two-person rehearsal.
The presentation separates working trials from the future authorized workflow.

PR #5's notarial ceremony demonstration is also integrated. It is an explicitly
secondary, collapsed option in the Beta section, with client and notary entry
points for retained dossiers. It uses the separate `/salle/*` API and records a
ceremony journal; it does not execute a legal signature. Identity attestations in
that demonstration must use fictional information. Its optional local recording
requires both participants' consent. Its ICE configuration is separate from the
`/signing-beta/*` relay configuration described below. The primary rehearsal does
not record media.

The two former mortgage acquisition pages and their English counterparts now
contain only localized `noindex` redirects to the carnet. They are absent from
navigation, `sitemap.xml` and `llms.txt`. Keeping the small redirect files in the
build overwrites old deployed objects and gives existing links a working destination.

## What the beta does

The Nota client and notary spaces expose **Salle de signature · Bêta** on retained, uncompleted dossiers. The public `/signature.html` introduction offers a private camera preview. The room uses the existing individual sign-in flow and requires mailbox verification within the preceding hour. Opening an invitation does not grant access: the API checks dossier ownership, the assigned active notary and the token role on every operation.

The notary creates a thirty-minute rehearsal. The customer joins its waiting room, and the notary explicitly admits them. Native WebRTC carries real audio and video between the two browsers. Production connections use a dedicated Canadian TURN relay; the relay forwards encrypted DTLS-SRTP packets and does not terminate or record the media. There is no third participant, transcription bot or server recorder.

Both browsers sign their signaling descriptions with temporary P-256 keys and verify the peer's signature. Participants compare a locally derived connection fingerprint through a separate trusted channel. This supplements access checks; it does not establish civil identity. The notary confirms the exercise checks, starts the shared reading and authorizes the test signature. The client signs first, then the notary.

The document is an immutable, explicitly fictitious exercise. Each browser checks its content and SHA-256 digest. Each acknowledgment is a real WebCrypto ECDSA signature over the session, role, document digest and a fresh server challenge. The API verifies each proof and its permitted sequence. The downloadable JSON receipt includes the document, public keys, signed messages, signatures and technical events, allowing independent verification. It is not a notarized deed or an authorized long-term signature container.

Camera or microphone loss, disconnection, stale presence, page hiding and explicit pause prevent the browser from signing. The server also requires fresh presence from both authenticated participants and valid state transitions. The notary must review again after a pause. This is browser telemetry and human observation, not independently attested liveness. Reconnecting resets connection verification. Closing the room stops its local media tracks.

## Explicit coming-soon scope

- Legal identity proofing, passkeys and the approved recovery workflow.
- ConsignO Cloud-CNQ integration, the notary's CertifO signature, authorized closure and preservation.
- Real document signing, witnesses/interpreters and legally operative multi-party ceremonies.
- Any recording feature, which requires a separately reviewed purpose, custody policy and participant process. The beta does not capture meeting audio or video.
- Independent security assessment and validation of the applicable Chambre requirements.

No beta action marks an act completed, initiates payment or changes a dossier's legal status. The application does not claim CNQ approval, certification or perfect security. The [ceremony plan](secure-signing-plan.md) and [security requirements](signing-security-requirements.md) remain the target for the authorized legal workflow; they are not all satisfied by this rehearsal.

## Security and operational boundaries

The dedicated signing document has no analytics or third-party JavaScript. Its CSP forbids framing and plugins and limits script/network origins. Camera and microphone permissions are enabled for that document only; the ordinary app retains its restrictive policy. The page and API responses are not cached. Static assets are content-hashed.

The room shares Nota's origin and existing browser account storage. A compromised endpoint, same-origin script or malicious web publisher could access plaintext at an endpoint. Browser E2EE does not protect against those threats or external participant recording. These residual boundaries must be stated in any evaluation.

The API stores temporary signaling and minimized events in dedicated DynamoDB records with a thirty-minute expiry. Expiry is enforced in application code; DynamoDB TTL removal is asynchronous. Closing/completing clears signaling and challenges. The receipt must be downloaded before the temporary session expires; the beta is not an archival service. Existing account/access audit policies continue to apply separately.

TURN credentials are minted only for an admitted, authenticated participant and expire with the session. A captured TURN credential can remain usable until that expiry; closing a browser does not instantly revoke the relay credential. Allocation, per-user, bandwidth and daily traffic quotas bound the pilot. Exhausted capacity produces a connection failure. No silent direct-media fallback is permitted when production TURN is configured.

The relay runs in `ca-central-1` with a dedicated VPC, encrypted disk, no SSH ingress, scoped SSM access, private/metadata peer denial rules and a separate SecureString. Provisioning never embeds its secret in Terraform state or EC2 user data. See the [deployment discovery and relay runbook](qa/signing-deployment-discovery.md).

Same-host relay traffic requires a narrow exception for the relay's own public/private address. Kernel rules restrict that exception to UDP source and destination ports in the reserved media range and block other private services. TURN permission acceptance alone is not the security test: packet canaries and firewall counters must prove that traffic to an unapproved service cannot pass. The final network verification record documents this boundary.

## Verification

`node --test e2e/signing-beta.test.mjs` opens two separate browser contexts against synthetic in-memory data. It completes real mailbox-challenge verification, admission, native audio/video, connection-code comparison, pause on camera interruption, repeated authorization, both cryptographic signatures and evidence download. It checks actual inbound audio/video bytes and connected DTLS transports and confirms no act completion. The headless local fixture permits loopback ICE candidates because macOS host networking otherwise prevents the two local contexts from connecting directly.

Set `NOTA_SIGNING_TURN_URLS` and `NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER` with an authorized AWS profile to run the same journey through the deployed relay. The test then also asserts a selected relay candidate. Never put the TURN shared secret in source control or test output.

`NOTA_SIGNING_RELEASE_DIR` optionally points this test at an isolated release's `api-patched/` and `web-patched/` directories. This verifies the exact staged production implementation while preserving unrelated working-tree changes.

## Rollout and rollback

Production deployment must preserve the current live package and static entry points, use Lambda revision and CloudFront ETag preconditions, and retain rollback copies. This workspace has concurrent unrelated work; copying the entire working tree to production is inappropriate. The signing release changes only its new modules, narrow authorization/repository hooks, app entry links, dedicated assets and page-specific CloudFront behavior.

The `NOTA_SIGNING_BETA_ENABLED` flag disables authenticated rehearsal routes. Legal signing remains unavailable regardless of this flag. On rollback, disable the flag first, then restore the immediately preceding code/static assets if required. Retain immutable historical assets so existing tabs can finish rendering. Do not delete other application assets or replace unrelated environment variables.

The YouTube demonstration uses only synthetic participants and the fictitious exercise document, with persistent beta and coming-soon disclosure. It does not demonstrate identity proofing or an official notarial signature.
