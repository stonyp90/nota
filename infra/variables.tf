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
