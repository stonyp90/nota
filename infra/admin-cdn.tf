###############################################################################
# Admin edge tier — ACM, private S3 SPA origin, strict security headers, a WAF
# IP-allowlist (default BLOCK), the admin CloudFront distribution, and DNS.
#
# All gated behind var.enable_admin (see locals in admin.tf). Domain-dependent
# pieces are additionally gated on local.admin_has_domain.
###############################################################################

locals {
  admin_s3_origin_id  = "s3-admin-web"
  admin_api_origin_id = "admin-api"
}

# ---------------------------------------------------------------------------
# ACM certificate (us-east-1, reusing the aws.us_east_1 alias) for the admin
# domain, DNS-validated in the existing hosted zone (var.hosted_zone_id).
# CloudFront only accepts us-east-1 certs — same constraint as acm.tf.
# ---------------------------------------------------------------------------
resource "aws_acm_certificate" "admin" {
  count    = local.admin_domain_enabled
  provider = aws.us_east_1

  domain_name       = var.admin_domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "admin_cert_validation" {
  for_each = local.admin_has_domain ? {
    for dvo in aws_acm_certificate.admin[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "admin" {
  count    = local.admin_domain_enabled
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.admin[0].arn
  validation_record_fqdns = [for r in aws_route53_record.admin_cert_validation : r.fqdn]
}

# ---------------------------------------------------------------------------
# Private S3 bucket for the admin SPA (mirrors s3.tf: block all public access,
# versioning, lifecycle, SSE, reached ONLY via CloudFront + OAC).
# ---------------------------------------------------------------------------
resource "random_id" "admin_bucket_suffix" {
  count       = local.admin_enabled
  byte_length = 4
}

resource "aws_s3_bucket" "admin" {
  count  = local.admin_enabled
  bucket = "${var.project_name}-admin-web-${random_id.admin_bucket_suffix[0].hex}"
}

resource "aws_s3_bucket_versioning" "admin" {
  count  = local.admin_enabled
  bucket = aws_s3_bucket.admin[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "admin" {
  count      = local.admin_enabled
  bucket     = aws_s3_bucket.admin[0].id
  depends_on = [aws_s3_bucket_versioning.admin]

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "admin" {
  count  = local.admin_enabled
  bucket = aws_s3_bucket.admin[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "admin" {
  count  = local.admin_enabled
  bucket = aws_s3_bucket.admin[0].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Origin Access Control: CloudFront signs S3 reads with SigV4.
resource "aws_cloudfront_origin_access_control" "admin" {
  count                             = local.admin_enabled
  name                              = "${var.project_name}-admin-web-oac"
  description                       = "OAC for ${var.project_name} admin web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy: allow ONLY the admin CloudFront distribution (SourceArn).
data "aws_iam_policy_document" "admin_bucket_policy" {
  count = local.admin_enabled

  statement {
    sid    = "AllowCloudFrontReadViaOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.admin[0].arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.admin[0].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "admin" {
  count      = local.admin_enabled
  bucket     = aws_s3_bucket.admin[0].id
  policy     = data.aws_iam_policy_document.admin_bucket_policy[0].json
  depends_on = [aws_s3_bucket_public_access_block.admin]
}

# ---------------------------------------------------------------------------
# Strict admin security-headers policy — NO 'unsafe-inline' anywhere (the public
# policy in cloudfront.tf relaxes CSP for rsms.me fonts + inline styles; the
# admin SPA must not). Attached to the admin SPA behavior (and the API behavior).
# ---------------------------------------------------------------------------
resource "aws_cloudfront_response_headers_policy" "admin_security" {
  count   = local.admin_enabled
  name    = "${var.project_name}-admin-security-headers"
  comment = "Strict security headers for the admin SPA (locked-down CSP, no unsafe-inline)."

  security_headers_config {
    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }

    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
      override                = true
    }
  }

  custom_headers_config {
    items {
      header   = "Permissions-Policy"
      value    = "camera=(), microphone=(), geolocation=()"
      override = true
    }
  }
}

# ---------------------------------------------------------------------------
# WAFv2 (scope CLOUDFRONT => created via aws.us_east_1) — IP allowlist with a
# default action of BLOCK. Only source IPs in var.admin_allowed_cidrs pass.
#
# SAFE CLOSED DEFAULT: an EMPTY var.admin_allowed_cidrs means the allow rule
# matches nothing, so the default BLOCK applies to everyone — the admin surface
# is reachable by NOBODY. Admins on dynamic IPs MUST keep this allowlist current
# (a changed home/office IP locks them out until the list is updated).
# ---------------------------------------------------------------------------
resource "aws_wafv2_ip_set" "admin_allowlist" {
  count              = local.admin_enabled
  provider           = aws.us_east_1
  name               = "${var.project_name}-admin-allowlist"
  description        = "IPv4 CIDRs permitted to reach the admin surface. EMPTY = nobody by default."
  scope              = "CLOUDFRONT"
  ip_address_version = "IPV4"
  addresses          = var.admin_allowed_cidrs
}

resource "aws_wafv2_web_acl" "admin" {
  count       = local.admin_enabled
  provider    = aws.us_east_1
  name        = "${var.project_name}-admin-acl"
  scope       = "CLOUDFRONT"
  description = "Default-BLOCK web ACL for the admin surface - only allowlisted IPs pass."

  # Closed by default: block everything that doesn't match the allow rule below.
  default_action {
    block {}
  }

  rule {
    name     = "allow-allowlisted-ips"
    priority = 0

    action {
      allow {}
    }

    statement {
      ip_set_reference_statement {
        arn = aws_wafv2_ip_set.admin_allowlist[0].arn
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${var.project_name}-admin-ipallow"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${var.project_name}-admin-acl"
    sampled_requests_enabled   = true
  }
}

# ---------------------------------------------------------------------------
# Admin CloudFront distribution: SPA from S3 (default) + admin API from the
# admin HTTP API (/api/admin/*). WAF-gated by IP. Mirrors the public
# distribution's origin/behavior wiring (cloudfront.tf).
# ---------------------------------------------------------------------------
resource "aws_cloudfront_distribution" "admin" {
  count               = local.admin_enabled
  enabled             = true
  is_ipv6_enabled     = true
  comment             = "${var.project_name} admin SPA + admin API"
  default_root_object = "index.html"
  price_class         = "PriceClass_100"

  # IP allowlist enforcement. Empty allowlist => WAF blocks everyone.
  web_acl_id = aws_wafv2_web_acl.admin[0].arn

  # --- Origin 1: private admin S3 bucket via OAC -------------------------
  origin {
    origin_id                = local.admin_s3_origin_id
    domain_name              = aws_s3_bucket.admin[0].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.admin[0].id
  }

  # --- Origin 2: admin API Gateway HTTP API (public HTTPS) --------------
  origin {
    origin_id   = local.admin_api_origin_id
    domain_name = "${aws_apigatewayv2_api.admin[0].id}.execute-api.${var.region}.amazonaws.com"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only" # API Gateway is HTTPS only
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  # --- Default behavior: serve the admin SPA from S3 --------------------
  default_cache_behavior {
    target_origin_id       = local.admin_s3_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed "CachingOptimized".
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"

    # Strict admin security headers.
    response_headers_policy_id = aws_cloudfront_response_headers_policy.admin_security[0].id

    # SPA routing: REUSE the existing viewer-request function (cloudfront.tf),
    # which rewrites extensionless non-/api paths to /index.html. It already
    # exists unconditionally, so no [0] index.
    #
    # NOTE: distribution-level custom_error_response 403/404 -> /index.html is
    # deliberately NOT used here. It is distribution-wide and would mask
    # /api/admin/* 4xx (e.g. a 403 unauthorized) as 200 index.html — the exact
    # bug the public distribution removed (see cloudfront.tf). The function gives
    # SPA fallback for app routes while letting API errors pass through.
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_router.arn
    }
  }

  # --- /api/admin/* behavior: route to the admin API, no caching --------
  ordered_cache_behavior {
    path_pattern           = "/api/admin/*"
    target_origin_id       = local.admin_api_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    # Managed "CachingDisabled" — admin API responses must never be cached.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # Managed "AllViewerExceptHostHeader" — forwards everything except Host,
    # including the Authorization header the admin session needs.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"

    response_headers_policy_id = aws_cloudfront_response_headers_policy.admin_security[0].id
  }

  # Custom domain alias only when a domain is configured; else default cert.
  aliases = local.admin_has_domain ? [var.admin_domain_name] : []

  viewer_certificate {
    cloudfront_default_certificate = local.admin_has_domain ? null : true
    acm_certificate_arn            = local.admin_has_domain ? aws_acm_certificate_validation.admin[0].certificate_arn : null
    ssl_support_method             = local.admin_has_domain ? "sni-only" : null
    minimum_protocol_version       = local.admin_has_domain ? "TLSv1.2_2021" : "TLSv1"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
}

# ---------------------------------------------------------------------------
# Route53 alias records for the admin domain -> admin CloudFront distribution.
# ---------------------------------------------------------------------------
resource "aws_route53_record" "admin_alias_a" {
  count   = local.admin_domain_enabled
  zone_id = var.hosted_zone_id
  name    = var.admin_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.admin[0].domain_name
    zone_id                = aws_cloudfront_distribution.admin[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "admin_alias_aaaa" {
  count   = local.admin_domain_enabled
  zone_id = var.hosted_zone_id
  name    = var.admin_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.admin[0].domain_name
    zone_id                = aws_cloudfront_distribution.admin[0].hosted_zone_id
    evaluate_target_health = false
  }
}
