###############################################################################
# Input variables
###############################################################################

variable "region" {
  description = "AWS region for all regional resources (data residency: Quebec Law 25)."
  type        = string
  default     = "ca-central-1"
}

variable "project_name" {
  description = "Short project identifier, used as a name prefix for resources."
  type        = string
  default     = "nota"
}

# Custom domain is OPTIONAL. When domain_name is "" the stack serves the SPA
# through the default *.cloudfront.net domain and no ACM/Route53 resources are
# created. Set both variables together to attach a custom domain.
variable "domain_name" {
  description = "Custom domain for the CloudFront distribution (e.g. app.example.com). Leave empty to use the default CloudFront domain."
  type        = string
  default     = ""
}

variable "hosted_zone_id" {
  description = "Route53 hosted zone ID that owns domain_name. Required only when domain_name is set."
  type        = string
  default     = null
}

# --- Stripe (flat monthly subscription billing) ----------------------------
# Values are NEVER hardcoded: supply them at apply time via TF_VAR_stripe_*
# environment variables or a gitignored terraform.tfvars. Use Stripe TEST-MODE
# keys everywhere except production.
variable "stripe_secret_key" {
  description = "Stripe secret API key (sk_...). Set via TF_VAR_stripe_secret_key; test-mode outside prod."
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_webhook_secret" {
  description = "Stripe webhook signing secret (whsec_...). Set via TF_VAR_stripe_webhook_secret."
  type        = string
  sensitive   = true
  default     = ""
}

variable "stripe_price_id" {
  description = "Stripe Price id (price_...) of the flat monthly subscription. Set via TF_VAR_stripe_price_id."
  type        = string
  sensitive   = true
  default     = ""
}

# --- Notary console auth -----------------------------------------------------
# The HMAC signing secret for notary console tokens (NOTA_NOTARY_SECRET) is NOT
# an input variable: it is generated in-stack by random_password.notary_secret
# (see lambda.tf) so production is never left with an empty, forge-able secret.

# --- Observability & cost guard (see observability.tf) -----------------------
# Where operational alarms and the monthly cost guard send their notifications.
# Left empty by default so the stack still applies cleanly with no email wired
# up: the SNS topics are created but carry no subscription. When set, AWS sends
# a confirmation email that the operator MUST click before delivery starts.
variable "alert_email" {
  description = "Email address subscribed to the CloudWatch alarm + cost-guard SNS topics. Empty = create topics without a subscription. When set, the operator must confirm the SNS subscription email AWS sends."
  type        = string
  default     = ""
}

# Cost guard threshold. Requires 'Receive Billing Alerts' to be enabled in the
# account (Billing console -> Billing preferences) or the EstimatedCharges
# metric is never published and the alarm simply stays in INSUFFICIENT_DATA.
variable "monthly_budget_usd" {
  description = "Alarm when AWS EstimatedCharges for the current month exceed this USD amount."
  type        = number
  default     = 25
}

variable "api_5xx_threshold" {
  description = "Alarm when the HTTP API returns more than this many 5xx responses within a 5-minute window."
  type        = number
  default     = 5
}

variable "dynamodb_user_errors_threshold" {
  description = "Alarm when DynamoDB UserErrors (client-side 400s) exceed this count in 5 minutes. Note: UserErrors is an account/region-wide metric with no TableName dimension."
  type        = number
  default     = 10
}

variable "lambda_duration_p99_ratio" {
  description = "Fraction of each Lambda's configured timeout at which its p99 Duration alarm trips (0.8 = 80%). Catches functions creeping toward their timeout before they start failing outright."
  type        = number
  default     = 0.8

  validation {
    condition     = var.lambda_duration_p99_ratio > 0 && var.lambda_duration_p99_ratio <= 1
    error_message = "lambda_duration_p99_ratio must be between 0 (exclusive) and 1 (inclusive)."
  }
}
