###############################################################################
# CloudFront — single distribution fronting BOTH the SPA and the API so they
# are served same-origin (no CORS needed).
#
# Origins:
#   1. S3 bucket (via OAC)        -> default behavior, serves the static SPA.
#   2. API Gateway HTTP API       -> ordered behavior for /api/*, no caching.
#
# FUTURE ADDITIONS (not built yet):
#   - SES for transactional email (continue-prompt #5).
#   - Presigned-URL S3 upload bucket(s) for user uploads (#2).
###############################################################################

# Origin Access Control originally created to SigV4-sign CloudFront -> Lambda
# function URL requests. The /api/* origin now goes through API Gateway (public
# HTTPS, no OAC needed) because the account SCP blocks lambda:InvokeFunctionUrl.
# This resource is retained but unused (harmless); safe to remove later.
resource "aws_cloudfront_origin_access_control" "lambda" {
  name                              = "${var.project_name}-lambda-oac"
  description                       = "SigV4 signing for the Lambda function URL origin (unused)"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  s3_origin_id     = "s3-web"
  lambda_origin_id = "lambda-api"

  # The /api/* origin is the public HTTP API Gateway endpoint, a bare host:
  # "<api-id>.execute-api.<region>.amazonaws.com". CloudFront proxies to it
  # over HTTPS; no OAC/SigV4 signing is needed (the API is public and the
  # Lambda is protected by the SCP-allowed lambda:InvokeFunction path).
  api_origin_domain = "${aws_apigatewayv2_api.api.id}.execute-api.${var.region}.amazonaws.com"

  # Attach a custom domain only when var.domain_name is set.
  has_custom_domain = var.domain_name != ""
}

# ---------------------------------------------------------------------------
# Security response-headers policy — attached to BOTH cache behaviors so every
# response (SPA assets and API) carries hardened security headers.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "security" {
  name    = "${var.project_name}-security-headers"
  comment = "Security headers (HSTS, nosniff, frame-deny, referrer, CSP, Permissions-Policy) for the SPA + API."

  security_headers_config {
    # HSTS: 2 years, cover subdomains, and request preload-list inclusion.
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    # X-Content-Type-Options: nosniff.
    content_type_options {
      override = true
    }

    # X-Frame-Options: DENY (defense in depth alongside frame-ancestors 'none').
    frame_options {
      frame_option = "DENY"
      override     = true
    }

    # Referrer-Policy.
    referrer_policy {
      referrer_policy = "strict-origin-when-cross-origin"
      override        = true
    }

    # Content-Security-Policy. Tuned to NOT break the app: it loads the Inter
    # stylesheet + font from https://rsms.me, external app.js/domain.js on 'self',
    # inline JSON-LD + inline styles, and fetches /api on 'self'.
    content_security_policy {
      content_security_policy = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://rsms.me; font-src 'self' https://rsms.me data:; script-src 'self' 'unsafe-inline'; connect-src 'self'"
      override                = true
    }
  }

  # Permissions-Policy: disable powerful features the app does not use.
  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
}

# ---------------------------------------------------------------------------
# CloudFront Function (viewer-request) — SPA router.
#
# Attached to the DEFAULT (S3) behavior ONLY. It rewrites "extensionless" paths
# (no "." in the last path segment) that are NOT under /api to /index.html, so
# client-side routing handles unknown SPA routes. This replaces the old
# distribution-level custom_error_response 403/404 -> /index.html mapping, which
# also swallowed API errors (turning /api/nope into a 200 index.html). Real
# assets (foo.js, foo.css, foo.png) keep their extension and pass through; API
# requests never reach this function because they match the /api/* behavior, and
# the /api guard is belt-and-suspenders.
# ---------------------------------------------------------------------------
resource "aws_cloudfront_function" "spa_router" {
  name    = "${var.project_name}-spa-router"
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite extensionless non-/api paths to /index.html for SPA routing."
  publish = true

  code = <<-EOT
    function handler(event) {
      var request = event.request;
      var uri = request.uri;

      // Never rewrite API paths (defense in depth; /api/* uses its own behavior).
      if (uri.startsWith('/api')) {
        return request;
      }

      // Last path segment (e.g. "index.html", "app.js", or "" for "/foo/").
      var lastSegment = uri.slice(uri.lastIndexOf('/') + 1);

      // No file extension => treat as an SPA route and serve the app shell.
      if (lastSegment.indexOf('.') === -1) {
        request.uri = '/index.html';
      }

      return request;
    }
  EOT
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

  # --- Origin 2: API Gateway HTTP API (public HTTPS) --------------------
  # Repointed from the Lambda function URL to an API Gateway HTTP API because
  # the account SCP blocks lambda:InvokeFunctionUrl. The HTTP API endpoint is
  # public; CloudFront simply proxies to it over HTTPS (no OAC/SigV4). The
  # $default route forwards /api/* to the same Lambda.
  origin {
    origin_id   = local.lambda_origin_id
    domain_name = local.api_origin_domain

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only" # API Gateway is HTTPS only
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

    # Attach hardened security response headers.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    # SPA routing: rewrite extensionless non-/api paths to /index.html.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
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

    # Attach hardened security response headers.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  # NOTE: the distribution-level custom_error_response 403/404 -> /index.html
  # blocks were REMOVED. They masked API errors as 200 index.html (e.g.
  # /api/nope returned 200 HTML). SPA fallback is now handled per-request by the
  # spa_router CloudFront function on the default behavior only, so /api/* 4xx/5xx
  # responses pass through unchanged. default_root_object stays index.html.

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
