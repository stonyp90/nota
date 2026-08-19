###############################################################################
# Email notifications + daily reminder scheduler
#
# What this file adds:
#   - an SES v2 email identity for the sender address (var.from_email);
#   - SES send permission for the existing API Lambda (it now sends the offer
#     confirmation and subscription lifecycle emails);
#   - a daily reminder Lambda (handler `reminders.handler`) that reuses the same
#     apps/api code bundle as the API Lambda;
#   - an EventBridge Scheduler that invokes the reminder Lambda once a day
#     (~13:00 UTC ≈ 09:00 in Québec), with least-privilege IAM.
#
# SES SANDBOX CAVEAT (read before going live):
#   A new SES account/region starts in the SANDBOX: you may only send TO
#   verified addresses, and at a low rate. To email real clients and notaries
#   you must (1) verify a sending DOMAIN with DKIM, and (2) request PRODUCTION
#   access ("exit the sandbox") from AWS Support. Nothing in Terraform leaves the
#   sandbox automatically — until you do, verify each individual test recipient.
#   Data residency (Law 25): SES here runs in the default provider region
#   (ca-central-1), like the rest of the stack.
###############################################################################

# --- Variables (kept local to this file; the rest of infra is unaffected) ----

variable "from_email" {
  description = "Verified SES sender address (e.g. bonjour@nota.ca). Empty string disables email and creates no SES resources. Verify a domain and exit the SES sandbox before production."
  type        = string
  sensitive   = true
  default     = ""
}

variable "operator_email" {
  description = "Nota's own inbox for operator notifications (new lead, notary subscribed). Empty disables operator emails."
  type        = string
  default     = ""
}

variable "base_url" {
  description = "Public site origin used to build CTA + unsubscribe links in emails (e.g. https://nota.ca)."
  type        = string
  default     = ""
}

# --- SES email identity ------------------------------------------------------
# Created only when a sender address is configured. For production prefer a
# verified DOMAIN identity (better deliverability + DKIM); a single-address
# identity is enough for sandbox testing.
resource "aws_sesv2_email_identity" "sender" {
  count          = var.from_email == "" ? 0 : 1
  email_identity = var.from_email
}

# --- SES send permission (shared policy document) ----------------------------
# SES v2 SendEmail maps to the ses:SendEmail IAM action. There is no convenient
# per-identity resource ARN to scope to, so we constrain by the From address
# instead — least privilege without brittle ARNs.
data "aws_iam_policy_document" "ses_send" {
  statement {
    sid       = "SendEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail"]
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

# Attach SES send to the EXISTING API Lambda role (defined in lambda.tf): the
# API now emits the offer-published confirmation and subscription lifecycle
# emails inline (fire-and-forget).
resource "aws_iam_role_policy" "api_ses" {
  name   = "${var.project_name}-api-ses"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.ses_send.json
}

# --- Reminder Lambda role + least-privilege policies -------------------------
resource "aws_iam_role" "reminders" {
  name               = "${var.project_name}-reminders-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# The scheduler reads open bids (Scan), reads the sent/unsub ledgers (GetItem)
# and writes the sent ledger (PutItem); Query is included for parity with the
# API role. Scoped to this one table's ARN — no wildcards on resources.
data "aws_iam_policy_document" "reminders_dynamodb" {
  statement {
    sid    = "TableReadWrite"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]

    resources = [aws_dynamodb_table.main.arn]
  }
}

resource "aws_iam_role_policy" "reminders_dynamodb" {
  name   = "${var.project_name}-reminders-dynamodb"
  role   = aws_iam_role.reminders.id
  policy = data.aws_iam_policy_document.reminders_dynamodb.json
}

resource "aws_iam_role_policy" "reminders_ses" {
  name   = "${var.project_name}-reminders-ses"
  role   = aws_iam_role.reminders.id
  policy = data.aws_iam_policy_document.ses_send.json
}

resource "aws_iam_role_policy_attachment" "reminders_logs" {
  role       = aws_iam_role.reminders.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Reminder Lambda ---------------------------------------------------------
# Reuses the SAME zip as the API Lambda (data.archive_file.api in lambda.tf);
# only the handler differs. AWS_REGION is set automatically by Lambda at runtime.
resource "aws_lambda_function" "reminders" {
  function_name = "${var.project_name}-reminders"
  role          = aws_iam_role.reminders.arn

  runtime = "nodejs20.x"
  handler = "reminders.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 60
  memory_size = 256

  # Use the retention-capped log group (logs.tf) rather than a never-expire one.
  depends_on = [aws_cloudwatch_log_group.reminders]

  environment {
    variables = {
      TABLE_NAME          = aws_dynamodb_table.main.name
      NOTA_FROM_EMAIL     = var.from_email
      NOTA_OPERATOR_EMAIL = var.operator_email
      NOTA_BASE_URL       = var.base_url
    }
  }
}

# --- EventBridge Scheduler: fire the reminder Lambda daily -------------------
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project_name}-reminders-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.reminders.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "${var.project_name}-reminders-scheduler-invoke"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

# Daily at 13:00 UTC (~09:00 in Québec, EDT). EventBridge Scheduler (not the
# legacy CloudWatch Events rule) invokes the Lambda directly via the role above,
# so no resource-based lambda permission is needed.
resource "aws_scheduler_schedule" "reminders" {
  name = "${var.project_name}-daily-reminders"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 13 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.reminders.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
