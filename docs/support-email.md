# Email replies in the existing support conversation

The admin console, website widget and inbound email append to the same `SUPPORT#<threadId>` record through `apps/api/src/support-conversations.js`. Email never creates a conversation. The shared service validates text, merges concurrent writes, preserves human ownership and deduplicates a stable message identifier. See [the chat guide](support-chat.md) for the full experience.

The code and Terraform are ready for an opt-in rollout. They have been tested with synthetic MIME/SES events; no live receipt rule, DNS change or real email exchange has been activated by this work.

## Routing and authentication

When configured, operator notifications have a signed Reply-To address for that operator; customer notifications have a separate visitor-role address bound to the thread's saved email. `supportReplyAddress()` in `apps/api/src/support-email.js` takes `{threadId, role, sender, domain, secret, nowMs?, ttlMs?}`. It reuses `NOTA_NOTARY_SECRET` with a separate HMAC namespace. Addresses expire after 30 days, fit the 64-character SMTP local-part limit, and cannot be used as web/admin login tokens. Missing configuration does not use a development signing-key fallback.

The receiver uses SES's **SMTP envelope recipients**, never the visible To/Cc headers. It requires one unambiguous signed route, exactly one From address, a matching sender-bound signature, and current authorization: an operator allowlist match or the conversation's current saved customer email. Customer binding is rechecked during each shared-service write attempt. SES spam, virus and DMARC verdicts must be `PASS`, backed by at least one `PASS` SPF/DKIM result. Header text claiming a passing verdict has no authority. AWS documents the authoritative recipient and authentication fields in its [receiving concepts](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html) and [notification contents](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html).

`Auto-Submitted` responses, mailing lists, delivery reports, empty-envelope bounces and Nota's automation marker are ignored. Rejections do not send automatic replies or bounces, avoiding mail loops and backscatter. Supported senders must pass the authentication checks; configure/verify the operator domain's DKIM/SPF/DMARC before activation.

## Parsing and duplicate delivery

The [MailParser library](https://nodemailer.com/extras/mailparser) decodes MIME, character sets, quoted-printable and base64. The entire raw message is limited to 256 KiB before parsing. Only plain text enters the conversation; HTML is converted to text and never rendered as email HTML. Common French/English quote headers, quoted blocks and signature delimiters are removed conservatively. Write the reply **above** the quoted message. Empty, quoted-only or over-limit replies are rejected instead of truncated.

Attachment bytes and names are not added to the conversation, opened, executed, or passed to an AI model. They remain only in the short-lived raw receipt. The response is text-only; documents belong in the notary's dossier conversation.

The message identifier hashes the thread, sender role, authenticated sender and MIME Message-ID; absent usable Message-ID falls back to SES's receipt identifier. Repeated receipts reuse the same message. A conflicting body under the same identifier is refused. Notification delivery has a persisted claim/lease in the same conversation, allowing a retry after a failed callback. External email delivery cannot be guaranteed exactly once: a crash after SES accepts a send but before its ledger is saved can resend that notification. The transcript itself remains deduplicated.

## Provision, deploy, then activate

1. Verify the normal outbound SES sender and operator inbox. Keep `enable_support_email = false` and `support_email_activate = false` until rollout is intended.
2. Inspect the existing active SES receipt rule set in `ca-central-1`. If one exists, set `support_email_rule_set_name` to that set so the new rule joins it. SES supports only one active set in each region; do not replace unrelated receiving rules. Set `support_email_domain` to a dedicated subdomain, normally `replies.nota.ca`. The apex mailbox MX and the SES outbound MAIL FROM records stay intact.
3. Set `enable_support_email = true`, keep `support_email_activate = false`, review/apply the infrastructure plan. This creates a **disabled** receipt rule, a private encrypted S3 bucket, a Lambda with no public URL, a failure queue and monitoring. The source secret is the same signing secret already supplied to the public/admin runtimes. No new secret value is placed in this document or the new Terraform file.
4. Set the GitHub repository variable `SUPPORT_EMAIL_FUNCTION` to the provisioned function name (normally `nota-support-email`). The optional deploy step verifies `mailparser`, the worker entrypoint and shared conversation module from the isolated zip, then deploys the same artifact as the public API. With the variable set, any missing-function, access or update error fails deployment. An empty variable skips this worker.
5. Confirm DNS verification/MX, the deployed bundle, operator allowlist, outbound delivery permissions, and the alert topic subscription. Set `support_email_activate = true` only after that review. This enables the rule, activates the selected SES rule set and enables signed Reply-To addresses on public/admin notifications. Existing inboxes are unaffected.
6. With authorization for a real smoke test, use a controlled operator/customer pair: create one support thread, answer once in admin, reply through both email roles, then verify the same ordered transcript in admin and the widget. Redeliver the same receipt to confirm deduplication. This live activation/smoke test remains outstanding.

AWS lists `inbound-smtp.ca-central-1.amazonaws.com` as a [supported receiving endpoint](https://docs.aws.amazon.com/general/latest/gr/ses.html). The receipt rule writes MIME to S3 **before** invoking Lambda, as described in [AWS's receipt processing flow](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-concepts.html). The bucket uses S3 server-side encryption; the SES action intentionally does not enable the different client-side KMS encryption mode, which would require an additional decryption client. See [the S3 action documentation](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-action-s3.html).

## Runtime settings and operations

| Setting | Purpose |
| --- | --- |
| `NOTA_SUPPORT_EMAIL_DOMAIN` | Enables signed support Reply-To addresses; dedicated receiving subdomain. |
| `NOTA_NOTARY_SECRET` | Existing signing key, reused through a separate HMAC namespace. |
| `NOTA_SUPPORT_OPERATOR_EMAILS` | Comma-separated inbound operator allowlist; falls back to `NOTA_OPERATOR_EMAIL`. |
| `NOTA_SUPPORT_EMAIL_BUCKET`, `NOTA_SUPPORT_EMAIL_PREFIX` | Fixed worker receipt location; prefix defaults to `support/`. |
| `TABLE_NAME` | Existing public support conversation table. |
| `NOTA_RUNTIME_SECRET_ARN` | Existing runtime secret bundle when Secrets Manager is enabled. |

`support-email.handler` accepts direct SES Lambda events only. SES invocation permission is restricted to the current account and the exact receipt rule ARN; the bucket permits SES writes under the same restrictions. Worker table permissions are limited to support and notification-related partitions, and its S3 read permission covers only the configured receipt prefix. These follow [AWS's receiving permission examples](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-permissions.html).

Raw receipts expire after seven days. Logs contain only aggregate result/rejection codes, never subjects, senders, bodies or capabilities. `Nota/SupportEmail` exposes a rejection metric; storage/conversation/notification failures throw a scrubbed error for two asynchronous retries and then go to the monitored failure queue. A confirmed alert subscription is required for an operator to receive the queue alarm. Inspect the protected receipt when investigating a rejected/expired reply, contact the sender through the existing conversation if needed, and replay only after correcting the cause. Receipt and failure-queue retention are both seven days.

Local verification sends no email and uses no AWS credentials:

```sh
node --test apps/api/test/support-email.test.mjs apps/api/test/support-email-lambda.test.mjs
terraform -chdir=infra fmt -check support-email.tf
terraform -chdir=infra validate
```

Tests exercise actual MIME decoding, sender/role/thread binding, stale email changes, SES verdicts, missing threads, automatic replies, quoted history, attachment isolation, size limits, message deduplication, worker storage paths, failure handling and deployment boundaries. They do not assert delivery through a live provider.
