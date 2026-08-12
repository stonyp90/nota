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
