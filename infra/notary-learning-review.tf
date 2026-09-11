###############################################################################
# Weekly notary-learning review — reporting only
#
# This worker measures the structured review signal collected during the beta.
# It has no provider credential, no model-training permission and no write port
# for model/configuration data. Any offline preference optimization remains a
# separately authorized, manually approved operation.
###############################################################################

resource "aws_sqs_queue" "notary_learning_review_dlq" {
  name                      = "${var.project_name}-notary-learning-review-dlq"
  message_retention_seconds = 1209600
}

resource "aws_iam_role" "notary_learning_review" {
  name               = "${var.project_name}-notary-learning-review-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "notary_learning_review_dynamodb" {
  statement {
    sid       = "ReadLearningSignalsOnly"
    effect    = "Allow"
    actions   = ["dynamodb:Query"]
    resources = [aws_dynamodb_table.main.arn]
    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["LEARNING#*"]
    }
  }
}

resource "aws_iam_role_policy" "notary_learning_review_dynamodb" {
  name   = "${var.project_name}-notary-learning-review-dynamodb"
  role   = aws_iam_role.notary_learning_review.id
  policy = data.aws_iam_policy_document.notary_learning_review_dynamodb.json
}

resource "aws_iam_role_policy_attachment" "notary_learning_review_logs" {
  role       = aws_iam_role.notary_learning_review.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "notary_learning_review" {
  function_name = "${var.project_name}-notary-learning-review"
  role          = aws_iam_role.notary_learning_review.arn
  runtime       = "nodejs22.x"
  handler       = "notary-learning-review.handler"

  filename                       = data.archive_file.api.output_path
  source_code_hash               = data.archive_file.api.output_base64sha256
  timeout                        = 60
  memory_size                    = 256
  reserved_concurrent_executions = 1

  depends_on = [aws_cloudwatch_log_group.notary_learning_review]

  environment {
    variables = {
      TABLE_NAME    = aws_dynamodb_table.main.name
      NODE_ENV      = "production"
      NOTA_TIMEZONE = var.time_zone
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

data "aws_iam_policy_document" "notary_learning_review_scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "notary_learning_review_scheduler" {
  name               = "${var.project_name}-notary-learning-review-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.notary_learning_review_scheduler_assume.json
}

data "aws_iam_policy_document" "notary_learning_review_scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.notary_learning_review.arn]
  }

  statement {
    effect    = "Allow"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.notary_learning_review_dlq.arn]
  }
}

resource "aws_iam_role_policy" "notary_learning_review_scheduler_invoke" {
  name   = "${var.project_name}-notary-learning-review-scheduler-invoke"
  role   = aws_iam_role.notary_learning_review_scheduler.id
  policy = data.aws_iam_policy_document.notary_learning_review_scheduler_invoke.json
}

resource "aws_scheduler_schedule" "notary_learning_review" {
  name = "${var.project_name}-weekly-notary-learning-review"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 14 ? * MON *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.notary_learning_review.arn
    role_arn = aws_iam_role.notary_learning_review_scheduler.arn

    dead_letter_config {
      arn = aws_sqs_queue.notary_learning_review_dlq.arn
    }

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
  }
}
