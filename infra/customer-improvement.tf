###############################################################################
# Daily bounded customer-experience improvement
#
# This worker has no model key and no permission to update bids, documents,
# pricing, legal configuration or notary records. It reads the sharded aggregate
# counters plus the separate append-only learning signal stream and writes only
# CONFIG#EXPERIENCE / POLICY. The public API projects that item into the one
# reversible guidance mode the browser may use.
###############################################################################

resource "aws_iam_role" "customer_improvement" {
  name               = "${var.project_name}-customer-improvement-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "customer_improvement_dynamodb" {
  statement {
    sid       = "ReadStatsAndLearningSignals"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [aws_dynamodb_table.main.arn]
    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["STATS#GLOBAL#*", "LEARNING#*"]
    }
  }

  statement {
    sid       = "ReadExperiencePolicyOnly"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = [aws_dynamodb_table.main.arn]
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["CONFIG#EXPERIENCE"]
    }
  }

  statement {
    sid       = "WriteExperiencePolicyOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.main.arn]
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["CONFIG#EXPERIENCE"]
    }
  }

  statement {
    sid       = "AppendImprovementAuditOnly"
    effect    = "Allow"
    actions   = ["dynamodb:PutItem"]
    resources = [aws_dynamodb_table.main.arn]
    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["AUDIT#*"]
    }
  }
}

resource "aws_iam_role_policy" "customer_improvement_dynamodb" {
  name   = "${var.project_name}-customer-improvement-dynamodb"
  role   = aws_iam_role.customer_improvement.id
  policy = data.aws_iam_policy_document.customer_improvement_dynamodb.json
}

resource "aws_iam_role_policy_attachment" "customer_improvement_logs" {
  role       = aws_iam_role.customer_improvement.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "customer_improvement" {
  function_name = "${var.project_name}-customer-improvement"
  role          = aws_iam_role.customer_improvement.arn

  runtime = "nodejs22.x"
  handler = "customer-improvement.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 60
  memory_size = 256

  depends_on = [aws_cloudwatch_log_group.customer_improvement]

  environment {
    variables = {
      TABLE_NAME                          = aws_dynamodb_table.main.name
      NODE_ENV                            = "production"
      NOTA_TIMEZONE                       = var.time_zone
      NOTA_AUTONOMOUS_IMPROVEMENT_ENABLED = "true"
    }
  }

  # Code is deployed by CI from the same vendored API bundle as the other
  # Lambdas; Terraform owns the schedule, role and environment only.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

data "aws_iam_policy_document" "customer_improvement_scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "customer_improvement_scheduler" {
  name               = "${var.project_name}-customer-improvement-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.customer_improvement_scheduler_assume.json
}

data "aws_iam_policy_document" "customer_improvement_scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.customer_improvement.arn]
  }
}

resource "aws_iam_role_policy" "customer_improvement_scheduler_invoke" {
  name   = "${var.project_name}-customer-improvement-scheduler-invoke"
  role   = aws_iam_role.customer_improvement_scheduler.id
  policy = data.aws_iam_policy_document.customer_improvement_scheduler_invoke.json
}

# A little after the reminders run so its complete-day window includes the
# prior day and cannot compete with the reminder batch for a hot partition.
resource "aws_scheduler_schedule" "customer_improvement" {
  name = "${var.project_name}-daily-customer-improvement"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(15 13 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.customer_improvement.arn
    role_arn = aws_iam_role.customer_improvement_scheduler.arn
  }
}
