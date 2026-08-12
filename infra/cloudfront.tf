###############################################################################
# CloudFront — single distribution fronting BOTH the SPA and the API so they
# are served same-origin (no CORS needed).
#
# Origins:
#   1. S3 bucket (via OAC)        -> default behavior, serves the static SPA.
#   2. Lambda function URL        -> ordered behavior for /api/*, no caching.
#
# FUTURE ADDITIONS (not built yet):
#   - SES for transactional email (continue-prompt #5).
#   - Presigned-URL S3 upload bucket(s) for user uploads (#2).
###############################################################################

# Origin Access Control that signs CloudFront -> Lambda function URL requests
# with SigV4, so the IAM-authed function URL accepts them.
resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${var.project_name}-lambda-oac"
  description                       = "SigV4 signing for the Lambda function URL origin"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  s3_origin_id     = "s3-web"
  lambda_origin_id = "lambda-api"

  # Lambda function URL comes back as "https://<id>.lambda-url.<region>.on.aws/".
  # CloudFront custom origins need a bare host, so strip scheme and trailing slash.
  lambda_origin_domain = replace(
    replace(aws_lambda_function_url.api.function_url, "https://", ""),
    "/",
    "",
  )

  # Attach a custom domain only when var.domain_name is set.
  has_custom_domain = var.domain_name != ""
}

resource "aws_cloudfront_distribution" "web" {
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} SPA + API"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # --- Origin 1: private S3 bucket via OAC -------------------------------
  origin {
    origin_id                = local.s3_origin_id
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  # --- Origin 2: Lambda function URL via OAC ----------------------------
  # The function URL is AuthType AWS_IAM (never public — org SCPs commonly
  # block public function URLs anyway). CloudFront signs each origin request
  # with SigV4 through this Origin Access Control, so the API is reachable
  # only through the distribution.
  origin {
    origin_id                = local.lambda_origin_id
    domain_name              = local.lambda_origin_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.lambda.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only" # Lambda URLs are HTTPS only
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # --- Default behavior: serve the SPA from S3 --------------------------
  default_cache_behavior {
    target_origin_id       = local.s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]

    # AWS managed "CachingOptimized" policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  # --- /api/* behavior: route to Lambda, no caching ---------------------
  ordered_cache_behavior {
    path_pattern           = "/api/*"
    target_origin_id       = local.lambda_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]

    # AWS managed "CachingDisabled" policy — API responses must not be cached.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AWS managed "AllViewerExceptHostHeader" origin request policy: forwards
    # everything except Host (Lambda function URLs reject a mismatched Host).
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  # SPA fallback: with OAC a missing S3 key returns 403 (not 404), because the
  # OAC principal is not allowed to List the bucket. Map BOTH 403 and 404 to
  # index.html with a 200 so client-side routing handles unknown paths.
  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 0
  }

  # Custom domain aliases, only when a domain is configured.
  aliases = local.has_custom_domain ? [var.domain_name] : []

  # Use the ACM cert (us-east-1) when a domain is set; otherwise fall back to
  # the default *.cloudfront.net certificate.
  viewer_certificate {
    cloudfront_default_certificate = local.has_custom_domain ? null : true
    # Reference the validation resource so CloudFront waits until the cert is issued.
    acm_certificate_arn      = local.has_custom_domain ? aws_acm_certificate_validation.cert[0].certificate_arn : null
    ssl_support_method       = local.has_custom_domain ? "sni-only" : null
    minimum_protocol_version = local.has_custom_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}
