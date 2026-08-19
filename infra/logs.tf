###############################################################################
# CloudWatch Log Groups — explicit, retention-capped Lambda logs.
#
# Cost optimization: if a Lambda is invoked without its log group already
# existing, Lambda AUTO-creates /aws/lambda/<function-name> with retention set
# to "Never expire". Those logs then accumulate forever at ~$0.03/GB-month with
# nothing ever reclaiming the storage — the classic silent serverless cost leak.
#
# Declaring the groups here instead:
#   - caps retention at var.log_retention_days (14 by default) so old logs age
#     out and storage cost stays flat instead of growing without bound;
#   - puts the groups under Terraform management, so `terraform destroy` also
#     removes the logs (an auto-created group is orphaned on destroy);
#   - keeps the name identical to what Lambda would create (/aws/lambda/<fn>),
#     so the function writes to THIS group rather than making its own.
#
# The name is built from the constructed function name string (not a reference
# to the function resource) to avoid a create ordering cycle; each Lambda takes
# a depends_on so the retention-capped group exists BEFORE the function's first
# invocation, preventing Lambda from racing in a never-expire group first.
#
# NOTE (one-time, only if the stack is already deployed): if these log groups
# were already auto-created by a prior invocation, import them once before the
# next apply, e.g.:
#   terraform import aws_cloudwatch_log_group.api      /aws/lambda/nota-api
#   terraform import aws_cloudwatch_log_group.reminders /aws/lambda/nota-reminders
#   terraform import 'aws_cloudwatch_log_group.admin[0]' /aws/lambda/nota-admin-api
###############################################################################

# Public API Lambda logs.
resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = var.log_retention_days
}

# Daily reminder Lambda logs.
resource "aws_cloudwatch_log_group" "reminders" {
  name              = "/aws/lambda/${var.project_name}-reminders"
  retention_in_days = var.log_retention_days
}

# Admin API Lambda logs — gated behind the same enable_admin flag as the
# function itself (admin.tf), so nothing is created when admin is off.
resource "aws_cloudwatch_log_group" "admin" {
  count             = local.admin_enabled
  name              = "/aws/lambda/${var.project_name}-admin-api"
  retention_in_days = var.log_retention_days
}
