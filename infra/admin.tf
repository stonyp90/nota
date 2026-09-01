###############################################################################
# Admin surface (admin.nota.ca) — PHASE 1, fully feature-flagged.
#
# EVERYTHING in this file and admin-cdn.tf is gated behind var.enable_admin
# (default false) via `count = local.admin_enabled`. With the flag OFF,
# `terraform plan` creates NONE of these resources: the live public stack is
# byte-for-byte unchanged. The ONLY ungated admin-related change lives in
# lambda.tf (a single additive dynamodb:UpdateItem grant so the public API can
# atomically bump the STATS# rollup counters that admin analytics read).
#
# Blast-radius isolation (Law 25): the admin surface has its OWN Lambda, its OWN
# DynamoDB table (nota-admin — admin identities / sessions / login-challenges /
# audit log / rate-limit items), its OWN CloudFront + WAF + deploy role. The
# admin Lambda can only READ the main customer table — never Scan, and its only
# write is the item-scoped CONFIG#EMAIL partition (email-template overrides,
# ADR 0018 §6 — see the LeadingKeys-conditioned statement below).
###############################################################################

locals {
  # Master switch. Used as `count` on every admin resource so the default plan
  # (enable_admin = false) is a no-op.
  admin_enabled = var.enable_admin ? 1 : 0

  # Domain-dependent admin resources (ACM cert, DNS validation + alias records,
  # CloudFront alias/cert selection). Gated on BOTH the flag AND a configured
  # admin_domain_name, so enabling admin before the domain is wired still plans
  # cleanly — the distribution falls back to the default *.cloudfront.net
  # certificate, exactly like the public distribution does without a domain.
  admin_has_domain     = var.enable_admin && var.admin_domain_name != ""
  admin_domain_enabled = local.admin_has_domain ? 1 : 0
}

# ---------------------------------------------------------------------------
# Admin token/session signing secret (NOTA_ADMIN_SECRET)
#
# Mirrors random_password.notary_secret (lambda.tf): generated in-stack so the
# production admin secret is NEVER empty/forge-able. Injected ONLY into the
# admin Lambda below — never into the public API Lambda. Rotate by tainting.
# ---------------------------------------------------------------------------
resource "random_password" "admin_secret" {
  count   = local.admin_enabled
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Admin DynamoDB table — SEPARATE from the customer table (nota-main).
#
# Holds admin identity / sessions / login-challenges / audit / rate-limit items.
# Physically isolated for blast-radius + Law-25 reasons. Same single-table
# (PK/SK) + TTL + PITR conventions as nota-main; on-demand billing.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "admin" {
  count        = local.admin_enabled
  name         = "${var.project_name}-admin"
  billing_mode = "PAY_PER_REQUEST"

  # Same guard as the main table: must be explicitly disabled before destroy.
  deletion_protection_enabled = true

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # Continuous backups (last 35 days).
  point_in_time_recovery {
    enabled = true
  }

  # Auto-expire ephemeral items (login challenges, sessions, rate-limit windows)
  # via an epoch-seconds `ttl` the handler stamps. TTL deletes are free.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# Admin Lambda IAM role + LEAST-PRIVILEGE inline policy
# ---------------------------------------------------------------------------

# Reuses data.aws_iam_policy_document.lambda_assume from lambda.tf (Lambda
# service trust) — no duplicate assume-role document.
resource "aws_iam_role" "admin" {
  count              = local.admin_enabled
  name               = "${var.project_name}-admin-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "admin_lambda" {
  count = local.admin_enabled

  # FULL item-level CRUD on the ADMIN table (+ any future indexes): admin
  # identities, sessions, login challenges, audit log, rate-limit counters.
  statement {
    sid    = "AdminTableFullAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.admin[0].arn,
      "${aws_dynamodb_table.admin[0].arn}/index/*",
    ]
  }

  # READ-ONLY on the MAIN customer table (+ its indexes). Deliberately NO
  # dynamodb:Scan and NO write actions: the admin surface can inspect customer
  # data but can never mutate it or table-scan it (blast-radius / Law 25).
  statement {
    sid    = "MainTableReadOnly"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
    ]
    resources = [
      aws_dynamodb_table.main.arn,
      "${aws_dynamodb_table.main.arn}/index/*",
    ]
  }

  # The write door on the MAIN table, item-scoped to product CONFIGURATION
  # partitions only: the admin-editable email template overrides (ADR 0018 §6,
  # PK = 'CONFIG#EMAIL', SK = TPL#<templateKey>), the admin-decided commission
  # barème (ADR 0021 §4, PK = 'CONFIG#COMMISSION', SK = BAREME) and the
  # admin-decided cancellation-fee barème (ADR 0023 §2, PK = 'CONFIG#ANNULATION',
  # SK = BAREME) — see apps/api/src/keys.js. The dynamodb:LeadingKeys condition
  # confines EVERY action in this statement to items whose partition key is one
  # of those values, so the admin console can edit product configuration but
  # still cannot read, write or delete a single customer item — the read-only
  # statement above remains its only access to the rest of the table. No index
  # resource on purpose: the LeadingKeys condition key does not apply to GSI
  # queries, and every config is read/written by primary key only.
  statement {
    sid    = "MainTableConfigWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.main.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["CONFIG#EMAIL", "CONFIG#COMMISSION", "CONFIG#ANNULATION"]
    }
  }

  # SES send for admin login-challenge / notification email. Scoped to the
  # configured sender address exactly the way the public notifier is scoped
  # (notifications.tf): by the ses:FromAddress condition, not a brittle ARN.
  statement {
    sid       = "SendEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]

    dynamic "condition" {
      for_each = var.from_email == "" ? [] : [1]
      content {
        test     = "StringEquals"
        variable = "ses:FromAddress"
        values   = [var.from_email]
      }
    }
  }
}

resource "aws_iam_role_policy" "admin_lambda" {
  count  = local.admin_enabled
  name   = "${var.project_name}-admin-api-policy"
  role   = aws_iam_role.admin[0].id
  policy = data.aws_iam_policy_document.admin_lambda[0].json
}

# Basic execution role — CloudWatch Logs (mirrors the public API role).
resource "aws_iam_role_policy_attachment" "admin_logs" {
  count      = local.admin_enabled
  role       = aws_iam_role.admin[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# Admin Lambda — reuses the SAME apps/api bundle (data.archive_file.api) as the
# public API + reminders Lambdas; only the handler differs (admin.handler).
# AWS_REGION is set automatically by Lambda at runtime (not declared here).
# ---------------------------------------------------------------------------
resource "aws_lambda_function" "admin" {
  count         = local.admin_enabled
  function_name = "${var.project_name}-admin-api"
  role          = aws_iam_role.admin[0].arn

  runtime = "nodejs20.x"
  handler = "admin.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 10
  memory_size = var.admin_memory_size

  # Blast-radius cap: modest concurrency ceiling for the admin API. The dashboard
  # overview is a heavier read, so 5 was too tight for a few concurrent operators.
  reserved_concurrent_executions = var.admin_reserved_concurrency

  # Use the retention-capped log group (logs.tf) rather than a never-expire one.
  depends_on = [aws_cloudwatch_log_group.admin]

  environment {
    variables = {
      NODE_ENV = "production"

      # In-stack admin signing secret (never empty in production).
      NOTA_ADMIN_SECRET = random_password.admin_secret[0].result

      # Admin's own isolated table (full CRUD) + the main table (READ-ONLY use).
      ADMIN_TABLE_NAME = aws_dynamodb_table.admin[0].name
      TABLE_NAME       = aws_dynamodb_table.main.name

      # Allowlisted admin login addresses + public base URL for links.
      NOTA_ADMIN_EMAILS = join(",", var.admin_emails)
      # Custom domain when set; otherwise fall back to the CloudFront default
      # domain so the emailed magic-link is always an absolute, working URL.
      NOTA_ADMIN_BASE_URL = var.admin_domain_name != "" ? "https://${var.admin_domain_name}" : "https://${aws_cloudfront_distribution.admin[0].domain_name}"

      # Reuse the same verified SES sender the public stack uses (notifications.tf).
      NOTA_FROM_EMAIL = var.from_email
    }
  }

  # LE CODE APPARTIENT À LA CI, PAS À TERRAFORM (2026-09-01).
  # `archive_file` empaquette `apps/api` tel quel ; le déploiement, lui, VENDORE
  # d'abord @nota/domain dans apps/api/node_modules (voir
  # .github/workflows/deploy.yml). Un `terraform apply` qui reprend la main sur
  # le code livrerait donc une Lambda incapable de résoudre le domaine — une
  # panne totale, déclenchée par un changement de configuration sans rapport.
  # Terraform possède l'infrastructure ; la CI possède le code.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ---------------------------------------------------------------------------
# Admin API Gateway (HTTP API v2) — SAME rationale as the public API (apigateway.tf):
# the account SCP blocks Lambda function URLs, so the admin Lambda is invoked via
# an HTTP API (lambda:InvokeFunction). CloudFront's /api/admin/* behavior points
# at this API's execute-api host; the admin Lambda strips the leading /api itself.
# No custom domain on the API — the admin CloudFront distribution fronts it.
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "admin" {
  count         = local.admin_enabled
  name          = "${var.project_name}-admin-http-api"
  protocol_type = "HTTP"
  description   = "HTTP API fronting the ${var.project_name}-admin-api Lambda (reached via the admin CloudFront /api/admin/*)."
}

resource "aws_apigatewayv2_integration" "admin" {
  count                  = local.admin_enabled
  api_id                 = aws_apigatewayv2_api.admin[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin_default" {
  count     = local.admin_enabled
  api_id    = aws_apigatewayv2_api.admin[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.admin[0].id}"
}

resource "aws_apigatewayv2_stage" "admin_default" {
  count       = local.admin_enabled
  api_id      = aws_apigatewayv2_api.admin[0].id
  name        = "$default"
  auto_deploy = true

  # Low default throttling to cap abuse (WAF already gates by IP, but this
  # protects the Lambda's reserved concurrency behind the allowlist too).
  default_route_settings {
    throttling_rate_limit  = 10
    throttling_burst_limit = 20
  }
}

resource "aws_lambda_permission" "admin_apigateway" {
  count         = local.admin_enabled
  statement_id  = "AllowAdminAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.admin[0].execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Admin CI/CD deploy role — SEPARATE least-privilege OIDC role (gated).
#
# Distinct from the public github_deploy role (cicd.tf) for blast-radius: this
# role can ONLY touch the admin bucket / distribution / Lambda. Its trust is
# scoped to the PROTECTED "admin-production" GitHub Environment (required
# reviewers on deploy-admin.yml), so an admin deploy needs human approval.
# Publish its ARN as the GitHub variable ADMIN_DEPLOY_ROLE_ARN.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "admin_github_deploy_assume" {
  count = local.admin_enabled

  statement {
    sid     = "GitHubActionsOIDCAdmin"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only workflows running in the PROTECTED "admin-production" environment may
    # assume this role. Same immutable numeric-ID subject shape as cicd.tf, but
    # keyed on `environment:` instead of `ref:refs/heads/main`.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:stonyp90@*/nota@*:environment:admin-production"]
    }
  }
}

resource "aws_iam_role" "admin_github_deploy" {
  count              = local.admin_enabled
  name               = "${var.project_name}-admin-github-deploy"
  description        = "Assumed by GitHub Actions (OIDC, admin-production environment) to deploy the Nota admin surface."
  assume_role_policy = data.aws_iam_policy_document.admin_github_deploy_assume[0].json
}

data "aws_iam_policy_document" "admin_github_deploy" {
  count = local.admin_enabled

  # S3: publish the built admin SPA to the admin bucket.
  statement {
    sid       = "AdminWebBucketObjects"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.admin[0].arn}/*"]
  }

  # ListBucket for `aws s3 sync --delete`.
  statement {
    sid       = "AdminWebBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.admin[0].arn]
  }

  # CloudFront: bust the admin distribution's edge cache after publishing.
  statement {
    sid       = "AdminCloudFrontInvalidation"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.admin[0].arn]
  }

  # Lambda: push new code for the admin function only.
  statement {
    sid       = "AdminLambdaUpdateCode"
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction"]
    resources = [aws_lambda_function.admin[0].arn]
  }
}

resource "aws_iam_role_policy" "admin_github_deploy" {
  count  = local.admin_enabled
  name   = "${var.project_name}-admin-github-deploy"
  role   = aws_iam_role.admin_github_deploy[0].id
  policy = data.aws_iam_policy_document.admin_github_deploy[0].json
}
