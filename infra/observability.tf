###############################################################################
# Production observability & cost guardrails
#
# Closes the audit finding "no CloudWatch alarms, no cost guard". Adds SNS
# alerting, a set of least-privilege CloudWatch alarms over the existing
# Lambda / DynamoDB / API Gateway resources, and a billing cost guard.
#
# Cost: free at idle. An SNS topic costs nothing until it delivers a message,
# and email notifications are free. CloudWatch alarms are ~$0.10/alarm/month at
# list price, and the first 10 standard-resolution alarms are covered by the
# AWS Free Tier — so this whole file runs at roughly $0.00–$1.10/month.
#
# Alarm inventory (11 alarms total):
#   Lambda Errors              x2  (api, reminders)
#   Lambda Throttles           x2  (api, reminders)
#   Lambda Duration p99        x2  (api, reminders — vs per-function timeout)
#   DynamoDB ReadThrottleEvents x1 (nota-main)
#   DynamoDB WriteThrottleEvents x1 (nota-main)
#   DynamoDB UserErrors        x1  (account/region-wide; see note below)
#   API Gateway 5xx            x1  (nota HTTP API)
#   Billing EstimatedCharges   x1  (cost guard, us-east-1)
###############################################################################

# ---------------------------------------------------------------------------
# Lambda functions we alarm on. Keyed by a static string so for_each keys are
# known at plan time. timeout_ms drives the per-function p99 Duration alarm, so
# nothing is hardcoded: the api Lambda (10s) trips at 8000ms and the reminders
# Lambda (60s) at 48000ms under the default 0.8 ratio.
# ---------------------------------------------------------------------------
locals {
  monitored_lambdas = {
    api = {
      function_name = aws_lambda_function.api.function_name
      timeout_ms    = aws_lambda_function.api.timeout * 1000
    }
    reminders = {
      function_name = aws_lambda_function.reminders.function_name
      timeout_ms    = aws_lambda_function.reminders.timeout * 1000
    }
  }

  # Create the email subscriptions only when an address is configured.
  alert_subscription_count = var.alert_email == "" ? 0 : 1
}

# ---------------------------------------------------------------------------
# SNS: alert fan-out
#
# Primary topic lives in the default region (ca-central-1) alongside the
# regional alarms. A CloudWatch alarm can only invoke an SNS topic in its OWN
# region, so the us-east-1 billing alarm gets its own companion topic below.
# ---------------------------------------------------------------------------
resource "aws_sns_topic" "alerts" {
  name = "${var.project_name}-alerts"
}

# Email subscription for the regional alarms. Guarded by count so an empty
# alert_email leaves the topic subscriber-less rather than failing the apply.
# NOTE: AWS emails a confirmation link on create; the operator MUST click it
# (confirm the SNS/SES subscription) before any alert is actually delivered.
resource "aws_sns_topic_subscription" "alerts_email" {
  count     = local.alert_subscription_count
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Companion topic in us-east-1, exclusively for the billing cost guard, because
# billing metrics (and therefore the alarm) only exist in us-east-1 and an alarm
# cannot target a cross-region SNS topic.
resource "aws_sns_topic" "billing_alerts" {
  provider = aws.us_east_1
  name     = "${var.project_name}-billing-alerts"
}

# Same operator-must-confirm-the-email caveat as above.
resource "aws_sns_topic_subscription" "billing_alerts_email" {
  provider  = aws.us_east_1
  count     = local.alert_subscription_count
  topic_arn = aws_sns_topic.billing_alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# ---------------------------------------------------------------------------
# Lambda alarms (per function)
# ---------------------------------------------------------------------------

# Any function error over a 5-minute window pages the topic.
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  for_each = local.monitored_lambdas

  alarm_name          = "${var.project_name}-lambda-errors-${each.key}"
  alarm_description   = "Lambda ${each.value.function_name} reported errors in the last 5 minutes."
  namespace           = "AWS/Lambda"
  metric_name         = "Errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# Throttles mean we hit the reserved-concurrency ceiling (or account limits) —
# requests are being dropped.
resource "aws_cloudwatch_metric_alarm" "lambda_throttles" {
  for_each = local.monitored_lambdas

  alarm_name          = "${var.project_name}-lambda-throttles-${each.key}"
  alarm_description   = "Lambda ${each.value.function_name} is being throttled (concurrency ceiling hit)."
  namespace           = "AWS/Lambda"
  metric_name         = "Throttles"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# p99 Duration creeping toward the configured timeout — early warning before
# requests start timing out. Threshold is a fraction of each function's own
# timeout (see local.monitored_lambdas), never a hardcoded millisecond value.
resource "aws_cloudwatch_metric_alarm" "lambda_duration_p99" {
  for_each = local.monitored_lambdas

  alarm_name          = "${var.project_name}-lambda-duration-p99-${each.key}"
  alarm_description   = "Lambda ${each.value.function_name} p99 duration is approaching its ${each.value.timeout_ms}ms timeout."
  namespace           = "AWS/Lambda"
  metric_name         = "Duration"
  extended_statistic  = "p99"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = each.value.timeout_ms * var.lambda_duration_p99_ratio
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = each.value.function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------------------------------------------------------------------------
# DynamoDB alarms (nota-main)
# ---------------------------------------------------------------------------

# On-demand tables can still be throttled during a sudden burst before the
# table auto-scales — surface it rather than silently dropping requests.
resource "aws_cloudwatch_metric_alarm" "dynamodb_read_throttles" {
  alarm_name          = "${var.project_name}-dynamodb-read-throttles"
  alarm_description   = "DynamoDB table ${aws_dynamodb_table.main.name} recorded read throttle events."
  namespace           = "AWS/DynamoDB"
  metric_name         = "ReadThrottleEvents"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = aws_dynamodb_table.main.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "dynamodb_write_throttles" {
  alarm_name          = "${var.project_name}-dynamodb-write-throttles"
  alarm_description   = "DynamoDB table ${aws_dynamodb_table.main.name} recorded write throttle events."
  namespace           = "AWS/DynamoDB"
  metric_name         = "WriteThrottleEvents"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    TableName = aws_dynamodb_table.main.name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# UserErrors catches malformed / rejected requests hitting DynamoDB. NOTE: this
# is an account/region-wide metric that does NOT support the TableName
# dimension, so the alarm is intentionally undimensioned (it covers every table
# in ca-central-1, which for this stack is effectively just nota-main).
resource "aws_cloudwatch_metric_alarm" "dynamodb_user_errors" {
  alarm_name          = "${var.project_name}-dynamodb-user-errors"
  alarm_description   = "DynamoDB UserErrors exceeded ${var.dynamodb_user_errors_threshold} in 5 minutes (account/region-wide)."
  namespace           = "AWS/DynamoDB"
  metric_name         = "UserErrors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.dynamodb_user_errors_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------------------------------------------------------------------------
# API Gateway (HTTP API v2) alarm
#
# HTTP APIs publish the metric named "5xx" (not "5XXError") under AWS/ApiGateway,
# dimensioned by ApiId. A cluster of 5xx over 5 minutes means the API tier is
# failing regardless of which Lambda/integration is at fault.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "apigw_5xx" {
  alarm_name          = "${var.project_name}-apigw-5xx"
  alarm_description   = "HTTP API ${aws_apigatewayv2_api.api.name} returned more than ${var.api_5xx_threshold} 5xx responses in 5 minutes."
  namespace           = "AWS/ApiGateway"
  metric_name         = "5xx"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.api_5xx_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    ApiId = aws_apigatewayv2_api.api.id
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ---------------------------------------------------------------------------
# Cost guard: monthly estimated charges
#
# Billing metrics (AWS/Billing EstimatedCharges) are ONLY published in
# us-east-1, so this alarm and its SNS topic both use the aws.us_east_1
# provider. The EstimatedCharges metric only appears once "Receive Billing
# Alerts" is enabled in the account (Billing console -> Billing preferences);
# until then the alarm sits in INSUFFICIENT_DATA (treated as not breaching).
#
# The metric is a slow-moving monthly cumulative value refreshed a few times a
# day, so we evaluate one 6-hour datapoint rather than a 5-minute window.
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "billing_cost_guard" {
  provider = aws.us_east_1

  alarm_name          = "${var.project_name}-billing-cost-guard"
  alarm_description   = "Estimated AWS charges this month exceeded $${var.monthly_budget_usd} USD."
  namespace           = "AWS/Billing"
  metric_name         = "EstimatedCharges"
  statistic           = "Maximum"
  period              = 21600 # 6h — matches how often the billing metric updates
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.monthly_budget_usd
  treat_missing_data  = "notBreaching"

  dimensions = {
    Currency = "USD"
  }

  alarm_actions = [aws_sns_topic.billing_alerts.arn]
  ok_actions    = [aws_sns_topic.billing_alerts.arn]
}

# ---------------------------------------------------------------------------
# Le puits d'audit : une écriture perdue doit se voir
#
# La règle applicative reste « l'audit ne bloque jamais l'argent » — un notaire
# ne doit pas rester impayé parce qu'une trace n'a pas pu s'écrire. Mais le
# `catch` qui l'applique avalait l'erreur en silence : un puits d'audit cassé
# était indistinguable d'une journée calme, et la piste se serait vidée sans que
# personne l'apprenne avant d'en avoir besoin.
#
# apps/api/src/handler.js émet désormais une ligne JSON structurée
# (`{"level":"error","event":"audit_write_failed",...}`) sur chaque écriture
# perdue. Le filtre ci-dessous la compte ; l'alarme la dit.
#
# Le filtre est posé sur les groupes de logs des Lambdas qui écrivent le
# journal : l'API publique (accès, connexions, règlements) et, quand la console
# est activée, l'API admin. Un seul nom de métrique pour les deux, donc une
# seule alarme : d'où qu'elle vienne, une trace perdue est une trace perdue.
#
# Coût : un filtre de métrique est gratuit, la métrique personnalisée coûte
# ~0,30 $/mois et l'alarme ~0,10 $ — hors franchise gratuite.
# ---------------------------------------------------------------------------
locals {
  audit_metric_namespace = "${var.project_name}/Audit"
  audit_metric_name      = "AuditWriteFailed"

  # Le motif JSON que CloudWatch Logs applique à chaque ligne : il ne compte que
  # les traces émises par le chemin d'audit, jamais les autres erreurs.
  audit_failure_pattern = "{ $.event = \"audit_write_failed\" }"
}

resource "aws_cloudwatch_log_metric_filter" "audit_write_failed_api" {
  name           = "${var.project_name}-audit-write-failed-api"
  log_group_name = aws_cloudwatch_log_group.api.name
  pattern        = local.audit_failure_pattern

  metric_transformation {
    name      = local.audit_metric_name
    namespace = local.audit_metric_namespace
    value     = "1"
    # Sans valeur par défaut, la métrique n'existe pas tant qu'aucune écriture
    # n'a échoué, et l'alarme resterait en INSUFFICIENT_DATA sans jamais passer
    # en OK — on ne saurait pas qu'elle veille.
    default_value = "0"
  }
}

resource "aws_cloudwatch_log_metric_filter" "audit_write_failed_admin" {
  count          = local.admin_enabled
  name           = "${var.project_name}-audit-write-failed-admin"
  log_group_name = aws_cloudwatch_log_group.admin[0].name
  pattern        = local.audit_failure_pattern

  metric_transformation {
    name          = local.audit_metric_name
    namespace     = local.audit_metric_namespace
    value         = "1"
    default_value = "0"
  }
}

# UNE seule écriture perdue suffit à alerter : contrairement à une erreur
# passagère de rendu, une entrée d'audit qui n'est pas écrite ne se rattrape
# jamais — il n'y a pas de reprise, l'événement est passé.
resource "aws_cloudwatch_metric_alarm" "audit_write_failed" {
  alarm_name          = "${var.project_name}-audit-write-failed"
  alarm_description   = "Au moins une entrée de la piste d'audit n'a pas pu être écrite dans les 5 dernières minutes. La trace est perdue : elle ne sera pas rejouée."
  namespace           = local.audit_metric_namespace
  metric_name         = local.audit_metric_name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  depends_on = [aws_cloudwatch_log_metric_filter.audit_write_failed_api]
}

# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
output "alerts_sns_topic_arn" {
  description = "ARN of the SNS topic that receives operational CloudWatch alarms (ca-central-1)."
  value       = aws_sns_topic.alerts.arn
}

output "billing_alerts_sns_topic_arn" {
  description = "ARN of the us-east-1 SNS topic that receives billing cost-guard alarms."
  value       = aws_sns_topic.billing_alerts.arn
}
