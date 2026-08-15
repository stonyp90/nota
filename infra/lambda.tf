###############################################################################
# Lambda — the Nota API (Node.js 20) behind a Lambda function URL.
#
# The function code is the apps/api directory, zipped at plan time by the
# archive_file data source. TABLE_NAME is injected via the environment; the
# handler also reads AWS_REGION, which Lambda sets automatically at runtime.
###############################################################################

# NOTE: this archive includes apps/api/node_modules if it is present on disk.
# That is acceptable here (the AWS SDK v3 clients are the only real deps), but a
# proper build pipeline should run `npm ci --omit=dev` inside apps/api first so
# only production dependencies are packaged. The workspace-linked @nota/domain
# dependency must also be vendored/bundled by that build step for runtime use.
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../apps/api"
  output_path = "${path.module}/build/api.zip"
}

# ---------------------------------------------------------------------------
# IAM role + least-privilege policy
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.project_name}-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Least-privilege data access: only the actions the handler performs, and only
# against this table's ARN (no wildcards on resources).
data "aws_iam_policy_document" "api_dynamodb" {
  statement {
    sid    = "TableAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      # UpdateItem lets the public API atomically ADD to the STATS# rollup
      # counters (best-effort analytics the admin surface reads). This is the
      # ONLY admin-related grant that is NOT gated behind var.enable_admin — it
      # is purely additive (no dynamodb:Scan, no new resources).
      "dynamodb:UpdateItem",
    ]

    resources = [aws_dynamodb_table.main.arn]
  }
}

resource "aws_iam_role_policy" "api_dynamodb" {
  name   = "${var.project_name}-api-dynamodb"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_dynamodb.json
}

# Basic execution role: allows writing logs to CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# Notary console token signing secret
# ---------------------------------------------------------------------------

# Generated in Terraform so the production signing secret is NEVER empty (an
# empty secret would make the API fall back to a public dev constant and let
# anyone forge console tokens — the handler now fails closed on that in prod).
# Stored in state (sensitive); rotate by tainting this resource.
resource "random_password" "notary_secret" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Function + function URL
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api"
  role          = aws_iam_role.api.arn

  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 10
  memory_size = var.api_memory_size

  # Blast-radius cap: hard ceiling on concurrent executions so a traffic spike
  # or DoS can't exhaust account-wide Lambda concurrency or run up unbounded cost.
  reserved_concurrent_executions = var.api_reserved_concurrency

  environment {
    variables = {
      # AWS_REGION is a reserved runtime variable set by Lambda automatically,
      # so it is intentionally NOT declared here.
      TABLE_NAME = aws_dynamodb_table.main.name

      # Marks this as a production runtime so the API's notary auth fails CLOSED:
      # a missing/empty NOTA_NOTARY_SECRET throws instead of signing tokens with
      # the public dev fallback constant.
      NODE_ENV = "production"

      # Stripe billing — free-for-notaries + commission (Stripe Connect). Values
      # come from TF_VAR_stripe_* / a gitignored tfvars, never hardcoded here;
      # use test-mode Connect keys outside production. The secret key must belong
      # to a Connect-enabled platform account.
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret

      # Commission the platform takes on a completed act (share of its value).
      NOTA_COMMISSION_RATE = tostring(var.commission_rate)
      # Where Stripe returns the notary after Connect onboarding (hash routes to
      # the Notaires tab; base_url falls back to the CloudFront domain).
      NOTA_ONBOARDING_RETURN_URL  = "${var.base_url}/#notaires"
      NOTA_ONBOARDING_REFRESH_URL = "${var.base_url}/#notaires"

      # Notary console token signing secret, generated by Terraform so it is
      # never empty in production (see random_password.notary_secret above).
      NOTA_NOTARY_SECRET = random_password.notary_secret.result

      # Email notifications (see notifications.tf). When NOTA_FROM_EMAIL is empty
      # the handler leaves notifications DISABLED, so the stack is fully
      # functional without SES configured. Set var.from_email to enable.
      NOTA_FROM_EMAIL     = var.from_email
      NOTA_OPERATOR_EMAIL = var.operator_email
      NOTA_BASE_URL       = var.base_url
    }
  }
}

# Public function URL (auth NONE). Access control is delegated to CloudFront,
# which is the only intended caller (path /api/* behavior). Keeping auth NONE
# lets CloudFront forward requests without SigV4 signing of the origin.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

# Only CloudFront (this distribution) may invoke the function URL, via the OAC
# that signs requests with SigV4. The raw function URL stays private.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.web.arn
  function_url_auth_type = "AWS_IAM"
}
