###############################################################################
# ACM + Route53 — custom domain support (OPTIONAL).
#
# Every resource here is guarded by `count = var.domain_name == "" ? 0 : 1`, so
# with no domain configured the stack creates nothing in this file and uses the
# default *.cloudfront.net certificate instead.
#
# The certificate is created through the aws.us_east_1 provider because
# CloudFront only accepts ACM certificates from us-east-1.
###############################################################################

# DNS-validated certificate in us-east-1.
resource "aws_acm_certificate" "cert" {
  count    = var.domain_name == "" ? 0 : 1
  provider = aws.us_east_1

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Route53 DNS records that prove domain ownership to ACM.
resource "aws_route53_record" "cert_validation" {
  for_each = var.domain_name == "" ? {} : {
    for dvo in aws_acm_certificate.cert[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

# Blocks until ACM observes the validation records and issues the certificate.
resource "aws_acm_certificate_validation" "cert" {
  count    = var.domain_name == "" ? 0 : 1
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.cert[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

# Alias records pointing the custom domain at the CloudFront distribution.
resource "aws_route53_record" "alias_a" {
  count   = var.domain_name == "" ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "alias_aaaa" {
  count   = var.domain_name == "" ? 0 : 1
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}
