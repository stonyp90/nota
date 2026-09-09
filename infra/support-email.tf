# Opt-in email replies to the SAME SUPPORT# conversation as web/admin chat.
# Provisioning and activation are separate. Never alter the apex mailbox MX.
# SES receiving, the bucket, and Lambda all remain in ca-central-1.
variable "enable_support_email" {
  type        = bool
  default     = false
  description = "Provision the support-reply SES/S3/Lambda adapter. Does not activate the receipt rule set."
}

variable "support_email_activate" {
  type        = bool
  default     = false
  description = "Activate support receiving after verifying the deployed bundle, DNS, sender authentication and operator allowlist. Review the account's existing active SES rule set first."
}

variable "support_email_domain" {
  type        = string
  default     = ""
  description = "Dedicated reply subdomain; empty derives replies.<domain_name>. Never the apex or the existing mailbox domain."
}

variable "support_email_rule_set_name" {
  type        = string
  default     = ""
  description = "Existing SES rule set to append to, if any. Empty creates a dedicated set. SES allows only one active set per region."
}

variable "support_email_operator_emails" {
  type        = list(string)
  default     = []
  description = "Authenticated From addresses allowed to answer as Nota; empty uses operator_email. Each signed Reply-To also binds its intended sender."
}

locals {
  support_email_domain        = var.support_email_domain != "" ? lower(var.support_email_domain) : "replies.${var.domain_name}"
  support_email_rule_set_name = var.support_email_rule_set_name != "" ? var.support_email_rule_set_name : "${var.project_name}-support-email"
  support_email_rule_name     = "${var.project_name}-support-email"
  support_email_rule_arn      = "arn:aws:ses:${var.region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${local.support_email_rule_set_name}:receipt-rule/${local.support_email_rule_name}"
  support_email_operators     = length(var.support_email_operator_emails) > 0 ? var.support_email_operator_emails : compact([var.operator_email])
}

resource "aws_ses_domain_identity" "support_email" {
  count  = var.enable_support_email ? 1 : 0
  domain = local.support_email_domain
  lifecycle {
    precondition {
      condition     = var.region == "ca-central-1" && var.domain_name != "" && local.dns_zone_id != null && endswith(local.support_email_domain, ".${var.domain_name}")
      error_message = "Support receiving requires ca-central-1 and a dedicated subdomain in the existing hosted zone; the apex mailbox is never replaced."
    }
    precondition {
      condition     = length(local.support_email_operators) > 0 && var.from_email != ""
      error_message = "Configure the verified outbound sender and at least one support operator before provisioning email replies."
    }
  }
}

resource "aws_route53_record" "support_email_verification" {
  count   = var.enable_support_email ? 1 : 0
  zone_id = local.dns_zone_id
  name    = "_amazonses.${local.support_email_domain}"
  type    = "TXT"
  ttl     = 300
  records = [aws_ses_domain_identity.support_email[0].verification_token]
}

resource "aws_ses_domain_identity_verification" "support_email" {
  count      = var.enable_support_email ? 1 : 0
  domain     = aws_ses_domain_identity.support_email[0].id
  depends_on = [aws_route53_record.support_email_verification]
}

resource "aws_route53_record" "support_email_mx" {
  count   = var.enable_support_email ? 1 : 0
  zone_id = local.dns_zone_id
  name    = local.support_email_domain
  type    = "MX"
  ttl     = 300
  records = ["10 inbound-smtp.ca-central-1.amazonaws.com"]
}

resource "aws_s3_bucket" "support_email" {
  count         = var.enable_support_email ? 1 : 0
  bucket        = "${var.project_name}-support-email-${data.aws_caller_identity.current.account_id}"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "support_email" {
  count                   = var.enable_support_email ? 1 : 0
  bucket                  = aws_s3_bucket.support_email[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "support_email" {
  count  = var.enable_support_email ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "support_email" {
  count  = var.enable_support_email ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "support_email" {
  count  = var.enable_support_email ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  rule {
    id     = "short-lived-raw-receipts"
    status = "Enabled"
    filter { prefix = "" }
    expiration { days = 7 }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}

resource "aws_s3_bucket_policy" "support_email" {
  count  = var.enable_support_email ? 1 : 0
  bucket = aws_s3_bucket.support_email[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "OnlyThisSESReceiptRule", Effect = "Allow", Principal = { Service = "ses.amazonaws.com" }
        Action    = "s3:PutObject", Resource = "${aws_s3_bucket.support_email[0].arn}/*"
        Condition = { StringEquals = { "AWS:SourceAccount" = data.aws_caller_identity.current.account_id, "AWS:SourceArn" = local.support_email_rule_arn } }
      },
      {
        Sid       = "TLSOnly", Effect = "Deny", Principal = "*", Action = "s3:*"
        Resource  = [aws_s3_bucket.support_email[0].arn, "${aws_s3_bucket.support_email[0].arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      }
    ]
  })
}

resource "aws_sqs_queue" "support_email_failed" {
  count                     = var.enable_support_email ? 1 : 0
  name                      = "${var.project_name}-support-email-failed"
  message_retention_seconds = 604800
  sqs_managed_sse_enabled   = true
}

resource "aws_iam_role" "support_email" {
  count              = var.enable_support_email ? 1 : 0
  name               = "${var.project_name}-support-email"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy" "support_email" {
  count = var.enable_support_email ? 1 : 0
  name  = "${var.project_name}-support-email"
  role  = aws_iam_role.support_email[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([
      {
        Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.support_email[0].arn}/support/*"]
      },
      {
        Effect    = "Allow", Action = ["dynamodb:GetItem"], Resource = [aws_dynamodb_table.main.arn]
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["SUPPORT#*", "SENT#*", "UNSUB#*", "MAILPREF#*", "CONFIG#EMAIL"] } }
      },
      {
        Effect    = "Allow", Action = ["dynamodb:PutItem"], Resource = [aws_dynamodb_table.main.arn]
        Condition = { "ForAllValues:StringLike" = { "dynamodb:LeadingKeys" = ["SUPPORT#*", "SENT#*", "SUJET#*"] } }
      },
      {
        Effect    = "Allow", Action = ["ses:SendEmail"], Resource = ["*"]
        Condition = { StringEquals = { "ses:FromAddress" = var.from_email } }
      },
      {
        Effect = "Allow", Action = ["sqs:SendMessage"], Resource = [aws_sqs_queue.support_email_failed[0].arn]
      }
      ], var.use_secrets_manager ? [{
        Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.public[0].arn]
    }] : [])
  })
}

resource "aws_iam_role_policy_attachment" "support_email_logs" {
  count      = var.enable_support_email ? 1 : 0
  role       = aws_iam_role.support_email[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_cloudwatch_log_group" "support_email" {
  count             = var.enable_support_email ? 1 : 0
  name              = "/aws/lambda/${var.project_name}-support-email"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "support_email" {
  count                          = var.enable_support_email ? 1 : 0
  function_name                  = "${var.project_name}-support-email"
  role                           = aws_iam_role.support_email[0].arn
  runtime                        = "nodejs22.x"
  handler                        = "support-email.handler"
  filename                       = data.archive_file.api.output_path
  source_code_hash               = data.archive_file.api.output_base64sha256
  timeout                        = 30
  memory_size                    = 256
  reserved_concurrent_executions = 2
  depends_on                     = [aws_cloudwatch_log_group.support_email, aws_iam_role_policy.support_email]
  environment {
    variables = {
      NODE_ENV                     = "production"
      TABLE_NAME                   = aws_dynamodb_table.main.name
      NOTA_SUPPORT_EMAIL_BUCKET    = aws_s3_bucket.support_email[0].id
      NOTA_SUPPORT_EMAIL_PREFIX    = "support/"
      NOTA_SUPPORT_EMAIL_DOMAIN    = local.support_email_domain
      NOTA_SUPPORT_OPERATOR_EMAILS = join(",", local.support_email_operators)
      NOTA_RUNTIME_SECRET_ARN      = var.use_secrets_manager ? aws_secretsmanager_secret.public[0].arn : ""
      NOTA_REQUIRED_SECRETS        = "NOTA_NOTARY_SECRET"
      NOTA_NOTARY_SECRET           = var.use_secrets_manager ? "" : random_password.notary_secret.result
      NOTA_FROM_EMAIL              = var.from_email
      NOTA_OPERATOR_EMAIL          = var.operator_email
      NOTA_REPLY_TO_EMAIL          = var.reply_to_email
      NOTA_BASE_URL                = var.base_url
      NOTA_ADMIN_URL               = var.admin_domain_name != "" ? "https://${var.admin_domain_name}" : ""
      NOTA_EMAIL_LANGUAGE          = var.email_language
      NOTA_SENDER_ADDRESS          = var.sender_address
      NOTA_SES_CONFIGURATION_SET   = local.ses_domain_enabled ? aws_sesv2_configuration_set.main[0].configuration_set_name : ""
    }
  }
  # Like the API, production dependencies/domain must be vendored by CI.
  lifecycle { ignore_changes = [filename, source_code_hash] }
}

resource "aws_lambda_function_event_invoke_config" "support_email" {
  count                        = var.enable_support_email ? 1 : 0
  function_name                = aws_lambda_function.support_email[0].function_name
  maximum_event_age_in_seconds = 21600
  maximum_retry_attempts       = 2
  destination_config {
    on_failure { destination = aws_sqs_queue.support_email_failed[0].arn }
  }
}

resource "aws_lambda_permission" "support_email_ses" {
  count          = var.enable_support_email ? 1 : 0
  statement_id   = "OnlyThisSESReceiptRule"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.support_email[0].function_name
  principal      = "ses.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = local.support_email_rule_arn
}

resource "aws_ses_receipt_rule_set" "support_email" {
  count         = var.enable_support_email && var.support_email_rule_set_name == "" ? 1 : 0
  rule_set_name = local.support_email_rule_set_name
}

resource "aws_ses_receipt_rule" "support_email" {
  count         = var.enable_support_email ? 1 : 0
  name          = local.support_email_rule_name
  rule_set_name = local.support_email_rule_set_name
  recipients    = [local.support_email_domain]
  enabled       = var.support_email_activate
  scan_enabled  = true
  tls_policy    = "Require"
  s3_action {
    position          = 1
    bucket_name       = aws_s3_bucket.support_email[0].id
    object_key_prefix = "support/"
    # Deliberately omit SES client-side KMS encryption: the private bucket
    # applies server-side encryption, so the Node worker can read MIME safely.
  }
  lambda_action {
    position        = 2
    function_arn    = aws_lambda_function.support_email[0].arn
    invocation_type = "Event"
  }
  stop_action {
    position = 3
    scope    = "RuleSet"
  }
  depends_on = [aws_ses_receipt_rule_set.support_email, aws_s3_bucket_policy.support_email, aws_lambda_permission.support_email_ses, aws_ses_domain_identity_verification.support_email]
}

resource "aws_ses_active_receipt_rule_set" "support_email" {
  count         = var.enable_support_email && var.support_email_activate ? 1 : 0
  rule_set_name = local.support_email_rule_set_name
  depends_on    = [aws_ses_receipt_rule.support_email]
}

# The optional CI job is selected by SUPPORT_EMAIL_FUNCTION after provisioning.
# No new deploy permission is needed for installations that leave it unset.
resource "aws_iam_role_policy" "support_email_deploy" {
  count = var.enable_support_email ? 1 : 0
  name  = "${var.project_name}-support-email-deploy"
  role  = aws_iam_role.github_deploy.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect   = "Allow", Action = ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode"]
    Resource = [aws_lambda_function.support_email[0].arn]
  }] })
}

resource "aws_cloudwatch_metric_alarm" "support_email_failed" {
  count               = var.enable_support_email ? 1 : 0
  alarm_name          = "${var.project_name}-support-email-failed"
  alarm_description   = "An incoming support reply could not be processed after retries. Inspect the protected receipt/DLQ and replay after fixing the cause."
  namespace           = "AWS/SQS"
  metric_name         = "ApproximateNumberOfMessagesVisible"
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions          = { QueueName = aws_sqs_queue.support_email_failed[0].name }
  alarm_actions       = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_log_metric_filter" "support_email_rejected" {
  count          = var.enable_support_email ? 1 : 0
  name           = "${var.project_name}-support-email-rejected"
  log_group_name = aws_cloudwatch_log_group.support_email[0].name
  pattern        = "{ $.event = \"support_email\" && $.counts.accepted NOT EXISTS && $.counts.duplicate NOT EXISTS }"
  metric_transformation {
    name      = "Rejected"
    namespace = "Nota/SupportEmail"
    value     = "1"
  }
}

output "support_email_readiness" {
  value = {
    provisioned = var.enable_support_email
    activated   = var.enable_support_email && var.support_email_activate
    domain      = var.enable_support_email ? local.support_email_domain : null
    rule_set    = var.enable_support_email ? local.support_email_rule_set_name : null
    function    = var.enable_support_email ? aws_lambda_function.support_email[0].function_name : null
  }
}
