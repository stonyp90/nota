###############################################################################
# Outputs
###############################################################################

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain (use this, or the custom domain if configured)."
  value       = aws_cloudfront_distribution.web.domain_name
}

output "web_bucket_name" {
  description = "Name of the private S3 bucket holding the web assets."
  value       = aws_s3_bucket.web.bucket
}

output "dynamodb_table_name" {
  description = "Name of the single DynamoDB table."
  value       = aws_dynamodb_table.main.name
}

output "lambda_function_url" {
  description = "Direct Lambda function URL (normally reached via CloudFront /api/*)."
  value       = aws_lambda_function_url.api.function_url
}

# --- Admin surface (null unless enable_admin = true) -------------------------
# All guarded with try(...[0], null) so they never error when admin is disabled.

output "admin_cloudfront_distribution_id" {
  description = "Admin CloudFront distribution id. Set as GitHub variable ADMIN_CF_DISTRIBUTION_ID. Null when enable_admin = false."
  value       = try(aws_cloudfront_distribution.admin[0].id, null)
}

output "admin_web_bucket" {
  description = "Admin SPA S3 bucket name. Set as GitHub variable ADMIN_WEB_BUCKET. Null when enable_admin = false."
  value       = try(aws_s3_bucket.admin[0].bucket, null)
}

output "admin_lambda_name" {
  description = "Admin Lambda function name. Set as GitHub variable ADMIN_LAMBDA_NAME. Null when enable_admin = false."
  value       = try(aws_lambda_function.admin[0].function_name, null)
}

output "admin_domain" {
  description = "Admin surface domain. The custom domain when configured, otherwise the admin CloudFront domain. Null when enable_admin = false."
  value       = local.admin_has_domain ? var.admin_domain_name : try(aws_cloudfront_distribution.admin[0].domain_name, null)
}

output "admin_github_deploy_role_arn" {
  description = "ARN of the admin OIDC deploy role. Set as GitHub variable ADMIN_DEPLOY_ROLE_ARN. Null when enable_admin = false."
  value       = try(aws_iam_role.admin_github_deploy[0].arn, null)
}
