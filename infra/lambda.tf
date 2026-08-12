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

# Least-privilege data access: only the three actions the handler performs,
# and only against this table's ARN (no wildcards on resources).
data "aws_iam_policy_document" "api_dynamodb" {
  statement {
    sid    = "TableAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
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
  memory_size = 256

  environment {
    variables = {
      # AWS_REGION is a reserved runtime variable set by Lambda automatically,
      # so it is intentionally NOT declared here.
      TABLE_NAME = aws_dynamodb_table.main.name

      # Stripe billing. Values come from TF_VAR_stripe_* / a gitignored tfvars,
      # never hardcoded here; use test-mode keys outside production.
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret
      STRIPE_PRICE_ID       = var.stripe_price_id
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
