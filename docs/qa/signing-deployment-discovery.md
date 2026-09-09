# Signing beta deployment discovery — 2026-09-09

This records local inspection, read-only production checks and the separately authorized Canadian TURN provisioning. The beta is a technical rehearsal; these deployment checks do not establish CNQ approval or legal signature capability. No signing-provider credentials were found or manufactured.

## Account and deployment boundary

AWS account `436136277668`, region `ca-central-1`, was verified by STS. The `aws-prod` SSO session originally used the wrong Identity Center region (`us-east-1`). The portal's CLI setup identified `us-east-2`; that one setting was corrected, the existing start URL retained, and the owner-approved device login succeeded. No AWS credential values were printed. CLI 2.28.24 does not implement `aws login`; that command needs 2.32+ and is not the direct Identity Center login route. [AWS authentication guidance](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)

Live metadata before this release:

| Surface | Resource | Observed state |
| --- | --- | --- |
| Public | `nota-web-17087f79`, CloudFront `E1Z4E4PF2FD9VG` | `gonota.ca`, `www.gonota.ca`; S3 object versioning enabled |
| Admin | `nota-admin-web-3cda0b03`, CloudFront `E379M6ERHNFZNL` | `admin.gonota.ca` |
| API | `nota-api`, `index.handler` | Node 22; 11,032,820-byte ZIP; modified 2026-09-08 14:35 UTC |
| Reminders | `nota-reminders`, `reminders.handler` | Same package size; modified 2026-09-08 14:35 UTC |
| Admin API | `nota-admin-api`, `admin.handler` | Node 22; modified 2026-09-08 12:25 UTC |
| Database | `nota-main` and `nota-admin` | Existing DynamoDB single-table architecture |
| DNS | `Z030833035KR62N8OK4LD` | Existing `gonota.ca` zone |

GitHub authentication has repo/workflow scopes and push/admin rights for `stonyp90/nota`. The production workflow's latest inspected successful run was [34238795360](https://github.com/stonyp90/nota/actions/runs/34238795360), revision `5d43669daa7387e47a9da32cd2d6e18a884c5bef`. GitHub OIDC remains usable independently of local AWS credentials. Its role can update public/reminder code, write web assets and invalidate CloudFront; it cannot provision EC2 or modify CloudFront settings.

The workflow vendors the complete production `@nota/api` dependency tree, dereferencing workspace links, into `apps/api/node_modules`; it ZIPs `apps/api` while excluding tests/evaluation data. It updates both public and reminder functions with the same ZIP and waits for updates. Public assets use short caching by default, immutable caching only for fingerprinted JS/CSS, and no-cache for HTML/service worker, followed by invalidation and routing smoke checks. API Gateway references the unqualified Lambda invoke ARN; no alias rollout was found.

## Release and rollback controls

The starting worktree contained more than 140 changed/untracked entries. Build a reviewed isolated release from the intended production base and selected changes; do not package the entire dirty tree. Run the repository's required domain/API, web/admin, BDD, browser, build and infrastructure checks against that exact release.

Before shipping, retain the current Lambda ZIP and its hash/version, S3 current-object/version manifest, CloudFront configuration with its ETag, and a private Terraform-state backup. Lambda rollback must restore the prior ZIP to the traffic-serving function; publishing or changing an unused version alone does not reroute an unqualified integration. Restore the previous asset set/index/service worker and invalidate CloudFront as a coordinated rollback. Keep database changes additive and do not delete ceremony evidence when disabling the beta.

Local Terraform state was stale (serial 301 still described Node 20) while live functions were Node 22. Never apply the whole dirty stack without reconciliation. TURN provisioning used a reviewed, saved, narrowly targeted plan and a mode-0600 state backup under `~/.aws/nota-state-backups`. The rollout owner separately deployed the CloudFront signing-path header change through a conditional API update. Its new response-headers policy `fbfe2f67-d480-408b-b7e1-9e71e1df40e9` was imported at `aws_cloudfront_response_headers_policy.signing`; no broad CloudFront apply was performed. Serializing all Terraform writes remains necessary because state is local. An existing empty `sender_address` production precondition also needs reconciliation before a future full apply.

Before this release, the public HTTPS response set `camera=(), microphone=()` and permitted Google Tag Manager scripts. A web-only upload cannot make conferencing work under that policy. The signing document needs its own camera/microphone policy and restrictive script policy, plus verified isolation from analytics.

## Canadian relay

No EC2 instances or TURN configuration existed in the inspected Canadian account region. No default VPC existed; every existing VPC belonged to another project. The authorized design therefore uses a new dedicated `nota-signing-turn` VPC/subnet/route/Internet gateway, one t4g.micro, 8 GiB encrypted gp3, one Elastic IP, a dedicated security group and SSM administration. No NAT gateway, SSH ingress, cross-project VPC access or public web server is added.

AWS Pricing API quotations, effective 2026-09-01, were retrieved on 2026-09-09: t4g.micro Linux shared tenancy in Canada Central is USD 0.0092/hour; gp3 is USD 0.088/GB-month. At 730 hours, compute is USD 6.72, 8 GiB storage USD 0.70 and one IPv4 address USD 3.65, totaling approximately **USD 11.07/month before egress, DNS requests and tax**. CPU credits use standard mode to avoid unlimited-credit surcharges. [AWS IPv4 price](https://aws.amazon.com/vpc/pricing/)

The relay exposes UDP/TCP 3478, TLS/TCP 443 and UDP allocation ports 49160–49200. It uses authenticated coturn REST credentials; the static secret remains in dedicated SSM SecureString `/nota/production/signing/turn-secret`. The EC2 role can retrieve only that parameter, and the API role's added TURN policy grants only that parameter. Terraform and user data contain its name, never its value. Certbot may modify only the hostname's ACME TXT record. IMDSv2, certificate renewal, private/link-local/metadata peer denial, allocation/bandwidth quotas and a per-process 5 GiB/day UTC egress limit are configured. Credentials expire with the authenticated room, at most 30 minutes; the server's allocation lifetime is at most 600 seconds and requires renewal with still-valid credentials. [Coturn configuration reference](https://github.com/coturn/coturn/blob/master/README.turnserver)

Quotas are 8 allocations per authenticated username and 24 globally, at most 1,000,000 bytes/second per session and 4,000,000 bytes/second overall. These allow three candidate transports per participant plus a bounded retry, and room for two small beta sessions. The original global 10/per-user 4 limits were too tight for simultaneous gathering and temporarily lingering failed allocations; increasing those counts does not increase the instance size or daily egress cap. Production concurrency needs its own load test and operating budget.

The daily budget is a beta operating limit: exhaustion interrupts relayed media and must prevent completion in the room. It resets at boot/midnight, not ordinary service restart. It does not promise an exact AWS bill or defeat endpoint compromise. Do not fall back to a direct connection silently when a relay/privacy requirement fails. Test two forced-relay peers and TLS-only transport before claiming connectivity.

Source files: `infra/signing-turn.tf`, `infra/templates/signing-turn-cloud-init.sh.tftpl`, and `infra/scripts/provision-signing-turn.py`. The helper initially permits only new TURN resource creation and rejects unrelated changes/replacements; maintenance needs its own reviewed plan. `signing_turn_enabled=true` is persisted in ignored `infra/gonata.tfvars`; preserve it in future plans. Do not run a default full apply that would disable it. Infrastructure syntax validation and the Python/Node helper syntax checks passed.

Runtime configuration:

```text
NOTA_SIGNING_TURN_SECRET_SSM_PARAMETER=/nota/production/signing/turn-secret
NOTA_SIGNING_TURN_URLS=["turn:turn.gonota.ca:3478?transport=udp","turn:turn.gonota.ca:3478?transport=tcp","turns:turn.gonota.ca:443?transport=tcp"]
```

The deployed relay is instance `i-0b4ef082546b9fbfb`, Elastic IP `35.182.162.25`, DNS `turn.gonota.ca`, private IP `10.98.0.30`, security group `sg-092dac7dde9e577ad`. It is managed over SSM, with a verified TLS certificate valid through 2026-12-08 and enabled renewal timer. The initial bootstrap instance was replaced after correcting an unavailable Ubuntu package; the replacement completed bootstrap successfully. The shared secret's absence from actual EC2 user data and Terraform state was verified by an in-memory comparison that printed only booleans.

`infra/scripts/check-signing-turn.cjs` exercises two real Chromium peers with relay-only ICE and distinct ephemeral credentials per role. Before the final ACL adjustment, UDP 3478, TCP 3478 and TLS 443 each completed a data-channel exchange with both selected candidates reported as `relay` and DTLS state `connected`; invalid credentials yielded no relay candidates. This proves transport connectivity, not the whole ceremony. The rollout owner separately tests actual two-party audio/video, authenticated signaling, browser signatures and receipt generation against the integrated release. Use separate credentials for every transport check; reusing a username can collide with allocation quotas while old failed allocations age out.

An additional raw TLS probe caught a coturn edge: `external-ip=public/private` automatically whitelists the private half, overriding a broad deny for the relay's own address. The final single-NIC configuration uses `external-ip=35.182.162.25`, the documented form for a single NAT-mapped relay, so it creates no private allowlist. `infra/scripts/check-signing-turn-permissions.py` passed all seven 403 denials: `127.0.0.1`, `169.254.169.254`, `10.98.0.1`, the relay's own `10.98.0.30`, `172.16.0.1`, `192.168.1.1` and `100.64.0.1`. The same probe verified the TLS certificate, rejected anonymous allocation, accepted a valid ephemeral credential and released its allocation. [Official single-address mapping configuration](https://github.com/coturn/coturn/blob/master/examples/etc/turnserver.conf)

The correction was applied to persistent host configuration and bootstrap source. A controlled stop/start synchronized EC2 user data to that source without replacing the instance, certificate or EIP. The final narrowly targeted Terraform plan showed **zero resource changes**, including no instance replacement. Existing CloudFront/Lambda drift outside the TURN targets remains outside that conclusion. Relay restarts interrupt active media: coordinate maintenance with the room owner and require the room to pause/reconnect rather than complete through a disconnected participant.

To suspend the beta, disable the API's signing-beta flag first and preserve existing evidence. A relay-only outage must remain a room failure, not an automatic direct-media fallback. To retire the infrastructure later, review a separate plan limited to these isolated TURN resources and the added API parameter-read policy; do not apply a broad stack destroy or disturb existing DNS/CloudFront resources. The shared parameter was created outside Terraform and needs deliberate removal only after all dependent rooms and runtimes are disabled. Merely stopping EC2 still incurs EIP and disk charges.

## Video creation and upload discovery

`output/youtube-nota-2026-09-09/create_videos.py` is a local generator, not an uploader. It uses Pillow for 1920×1080 artwork, macOS `say` with Amélie for Quebec French/Samantha for English, and ffmpeg H.264/AAC rendering, subtitles, thumbnails and upload metadata. ffmpeg 9.0.1, ffprobe, these voices and Pillow are installed. `gcloud` is installed; `youtube-upload`, Google API Python libraries and a project-local YouTube API uploader were not found. No OAuth tokens were searched or read.

Six earlier introduction videos and captions exist. Their manifest still says rendered/not uploaded, so it is not current publication proof. Their README's earlier channel-creation status is stale relative to the rollout owner's newer browser observation of Nota YouTube Studio channel `UCchyPqEdwYPz-J46IEUA9YQ`. The owner of browser automation must verify the channel identity and upload status there. No video was uploaded by this discovery/provisioning agent. A signing demo should use actual verified beta capture, synthetic participants/documents, accurate rehearsal labels, and matching narration/captions rather than reuse introductory slides as proof of conferencing.
