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

variable "sender_address" {
  description = "The registered mailing address that identifies Nota in every email (LCAP / CASL). Empty leaves the placeholder, which the email suite refuses in production."
  type        = string
  default     = ""
}

variable "commission_rate" {
  description = "Nota's share of a completed act at the START of the ladder, as a fraction (ADR 0028: 0.15 = 15%, the most Nota ever takes). Set via TF_VAR_commission_rate."
  type        = number
  default     = 0.15

  validation {
    condition     = var.commission_rate >= 0 && var.commission_rate < 1
    error_message = "commission_rate must be a fraction in [0, 1)."
  }
}

variable "commission_rate_floor" {
  description = "The floor Nota's share never crosses, however high a notary's cote (ADR 0028: 0.05 = 5%, so the best notaries keep 95%)."
  type        = number
  default     = 0.05

  validation {
    condition     = var.commission_rate_floor >= 0 && var.commission_rate_floor < 1
    error_message = "commission_rate_floor must be a fraction in [0, 1)."
  }
}

variable "commission_tiers" {
  description = "The cote ladder as JSON, each rung `{cote, taux}` (ADR 0028). Empty string keeps the built-in defaults: 60→12%, 70→10%, 80→8%, 90→5%."
  type        = string
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

# Cost control: Lambda auto-creates its /aws/lambda/<fn> log group with retention
# set to "Never expire", so log storage grows forever. Declaring the groups in
# Terraform (see logs.tf) caps retention at this many days. 14 balances useful
# debugging history against storage cost; raise for longer forensic windows.
variable "log_retention_days" {
  description = "CloudWatch Logs retention (days) for the Lambda log groups. Caps otherwise-unbounded log storage cost."
  type        = number
  default     = 14

  validation {
    # Only values AWS actually accepts for retention_in_days.
    condition = contains(
      [1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653],
      var.log_retention_days
    )
    error_message = "log_retention_days must be one of the values CloudWatch Logs accepts (e.g. 1, 3, 5, 7, 14, 30, 60, 90, 365, ...)."
  }
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

# --- Admin surface (admin.nota.ca) — PHASE 1, feature-flagged ----------------
# The entire admin stack (admin.tf + admin-cdn.tf) is gated behind enable_admin.
# With enable_admin = false (the default) `terraform plan` creates NO admin
# resources: the live public stack is unchanged. The ONLY ungated admin-related
# change is a single additive dynamodb:UpdateItem grant on the public API role
# (see lambda.tf) for STATS# analytics rollups.
variable "enable_admin" {
  description = "Master switch for the admin surface (admin.tf + admin-cdn.tf). Leave false to keep the admin stack entirely uncreated."
  type        = bool
  default     = false
}

variable "admin_domain_name" {
  description = "Custom domain for the admin CloudFront distribution (e.g. admin.nota.ca). Empty falls back to the default *.cloudfront.net domain (no ACM/Route53 for admin). Uses var.hosted_zone_id for DNS validation + alias records."
  type        = string
  default     = ""
}

variable "admin_emails" {
  description = "Allowlisted admin login email addresses (injected as NOTA_ADMIN_EMAILS). Empty means no one can log in."
  type        = list(string)
  default     = []
}

# --- Scale / capacity limits ------------------------------------------------
# Raised from the initial sane-low defaults so the public API is not the launch
# ceiling (it was 20 req/s + 20 concurrent). Kept as variables — never hardcoded
# — so capacity grows with traffic. The account concurrency pool is 1000; keep at
# least 100 unreserved across all functions.
variable "api_throttle_rate_limit" {
  description = "API Gateway steady-state requests/sec for the public API stage."
  type        = number
  default     = 500
}

variable "api_throttle_burst_limit" {
  description = "API Gateway burst request ceiling for the public API stage."
  type        = number
  default     = 1000
}

variable "api_reserved_concurrency" {
  description = "Reserved concurrent executions for the public API Lambda (blast-radius cap)."
  type        = number
  default     = 100
}

variable "api_memory_size" {
  description = "Memory (MB) for the public API Lambda. Lambda CPU scales with memory; 512 keeps partition-heavy reads (whole-month Queries, .ics feeds) CPU-comfortable."
  type        = number
  default     = 512
}

variable "admin_reserved_concurrency" {
  description = "Reserved concurrent executions for the admin API Lambda."
  type        = number
  default     = 10
}

variable "admin_memory_size" {
  description = "Memory (MB) for the admin API Lambda."
  type        = number
  default     = 512
}

variable "prix_nota_cents" {
  description = "L'ANCIEN prix unique du service de Nota, en cents (ADR 0031). Vide = la grille du catalogue (ADR 0034) ; le poser aplatit cette grille sur un seul nombre, sans aucune garantie de date. Ne le posez que pour figer un déploiement sur son prix d'avant le 2026-09-03. La console admin surcharge les deux à l'exécution via CONFIG#PRIX."
  type        = string
  default     = ""
}

variable "prix_nota_grille" {
  description = "La GRILLE du prix de Nota (ADR 0034), en JSON : {\"services\":{\"refinancement\":24900},\"garantieDate\":{\"rapide\":5000}} — en cents. Vide = la grille du catalogue. Une cellule absente reste celle du catalogue. Dès que cette variable porte une grille lisible, elle décide SEULE : prix_nota_cents est alors ignoré (les deux ne se composent jamais). La console admin la surcharge à l'exécution via CONFIG#PRIX."
  type        = string
  default     = ""
}
