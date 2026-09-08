# Opt-in migration: populate these bundles out of band before switching runtime
# configuration. Keep existing signing values when migrating to preserve links.
variable "use_secrets_manager" {
  description = "Load public/admin credential bundles from Secrets Manager at runtime. Populate versions before enabling."
  type        = bool
  default     = false
}

variable "create_runtime_secrets" {
  description = "Provision empty secret containers ahead of the runtime migration. Terraform never reads their values."
  type        = bool
  default     = false
}

locals {
  runtime_secrets_enabled = var.create_runtime_secrets || var.use_secrets_manager
}

resource "aws_secretsmanager_secret" "public" {
  count                   = local.runtime_secrets_enabled ? 1 : 0
  name                    = "${var.project_name}/production/public"
  description             = "Public API and reminders: signing, payment and optional assistant credentials (JSON)."
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret" "admin" {
  count                   = local.runtime_secrets_enabled && var.enable_admin ? 1 : 0
  name                    = "${var.project_name}/production/admin"
  description             = "Admin signing and password hash, plus shared unsubscribe signing key (JSON)."
  recovery_window_in_days = 30
}

resource "aws_iam_role_policy" "runtime_public_secrets" {
  for_each = var.use_secrets_manager ? { api = aws_iam_role.api.id, reminders = aws_iam_role.reminders.id } : {}
  name     = "${var.project_name}-runtime-secrets"
  role     = each.value
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.public[0].arn
  }] })
}

resource "aws_iam_role_policy" "runtime_admin_secrets" {
  count = var.use_secrets_manager && var.enable_admin ? 1 : 0
  name  = "${var.project_name}-runtime-secrets"
  role  = aws_iam_role.admin[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = aws_secretsmanager_secret.admin[0].arn
  }] })
}

output "runtime_secret_arns" {
  value = {
    public = local.runtime_secrets_enabled ? aws_secretsmanager_secret.public[0].arn : null
    admin  = local.runtime_secrets_enabled && var.enable_admin ? aws_secretsmanager_secret.admin[0].arn : null
  }
}

variable "stripe_mode" {
  description = "Non-secret readiness metadata for admin when Secrets Manager is used. Set only after verifying both payment credentials."
  type        = string
  default     = "unconfigured"
  validation {
    condition     = contains(["live", "test", "unconfigured"], var.stripe_mode)
    error_message = "stripe_mode must be live, test, or unconfigured."
  }
}
