# OAuth client IDs are public identifiers. Client secrets and the encryption
# key belong exclusively in the existing runtime Secrets Manager bundle.
variable "oauth_origin" {
  description = "Canonical HTTPS origin used for account OAuth callbacks. Empty disables account OAuth."
  type        = string
  default     = ""
  validation {
    condition     = var.oauth_origin == "" || can(regex("^https://[^/]+$", var.oauth_origin))
    error_message = "oauth_origin must be an HTTPS origin without a path or trailing slash."
  }
}

variable "oauth_client_ids" {
  description = "Public OAuth application IDs by provider; never include client secrets here."
  type        = map(string)
  default     = {}
  validation {
    condition     = alltrue([for provider in keys(var.oauth_client_ids) : contains(["google", "microsoft", "linkedin"], provider)])
    error_message = "Only google, microsoft and linkedin client IDs are supported."
  }
}

variable "outlook_client_id" {
  description = "Public Microsoft application ID for optional Outlook calendar connection."
  type        = string
  default     = ""
}

variable "outlook_redirect_uri" {
  description = "Exact HTTPS redirect URI registered for Outlook calendar connection."
  type        = string
  default     = ""
  validation {
    condition     = var.outlook_redirect_uri == "" || can(regex("^https://[^/]+/api/calendar/outlook/callback$", var.outlook_redirect_uri))
    error_message = "outlook_redirect_uri must be an HTTPS calendar callback URL."
  }
}
