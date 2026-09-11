# --- SMS (texto) — the third notification channel -----------------------------
#
# Nota texts a person only when they expressly asked for it: the client ticks
# « Me prévenir aussi par texto » at booking, the notary switches « Alertes par
# texto » on in their profile. The API publishes straight to the phone number
# through SNS (no topic), with the Transactional lane and a spend ceiling, so a
# runaway loop can cost at most `sms_monthly_spend_limit_usd`.
#
# Off by default: `sms_enabled = false` leaves the Lambda without the
# permission and without the env flag, and the notifier's SMS leg is a no-op.
# Turning it on is a deliberate `terraform apply`, like SES leaving the sandbox.

variable "sms_enabled" {
  description = "Grant the public Lambda sns:Publish to phone numbers and enable the SMS leg of the notifier. Off = the SMS port is not composed."
  type        = bool
  default     = false
}

variable "sms_sender_id" {
  description = "Alphanumeric sender id shown on handsets where the carrier supports it (≤ 11 chars). Canadian carriers largely ignore it; the number is what shows."
  type        = string
  default     = "Nota"
}

variable "sms_monthly_spend_limit_usd" {
  description = "SNS account-level monthly SMS spend ceiling (USD). SNS stops delivering past it; raising it above 1 USD requires an AWS support quota increase."
  type        = number
  default     = 10
}

# sns:Publish to a PhoneNumber has no resource ARN to scope to (there is no
# topic), so the grant is `*` but conditioned to the Transactional SMS type:
# the Lambda can never send Promotional texts, whatever the code does.
data "aws_iam_policy_document" "sms_publish" {
  count = var.sms_enabled ? 1 : 0
  statement {
    sid       = "PublishSms"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "sns:MessageAttributes/AWS.SNS.SMS.SMSType"
      values   = ["Transactional"]
    }
    # Never a topic: a `*` publish grant must not double as a fan-out grant.
    condition {
      test     = "Null"
      variable = "sns:TopicArn"
      values   = ["true"]
    }
  }
}

resource "aws_iam_role_policy" "api_sms" {
  count  = var.sms_enabled ? 1 : 0
  name   = "nota-api-sms"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.sms_publish[0].json
}

# The reminders Lambda texts too (the J-1 reminder, a refused hold).
resource "aws_iam_role_policy" "reminders_sms" {
  count  = var.sms_enabled ? 1 : 0
  name   = "nota-reminders-sms"
  role   = aws_iam_role.reminders.id
  policy = data.aws_iam_policy_document.sms_publish[0].json
}

# Account-wide SMS preferences: the spend ceiling and the transactional
# default. One per account/region — declared here because Nota is the only
# SMS sender in this account.
resource "aws_sns_sms_preferences" "nota" {
  count                        = var.sms_enabled ? 1 : 0
  default_sms_type             = "Transactional"
  default_sender_id            = var.sms_sender_id
  monthly_spend_limit          = var.sms_monthly_spend_limit_usd
  usage_report_s3_bucket       = null
  delivery_status_iam_role_arn = null
}
