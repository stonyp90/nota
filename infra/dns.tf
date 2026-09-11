# GoDaddy remains the registrar. Delegate its nameservers to this public zone.
variable "create_hosted_zone" {
  description = "Create the authoritative Route 53 zone. Otherwise supply hosted_zone_id."
  type        = bool
  default     = false
}

variable "enable_www" {
  description = "Serve www.<domain_name> and permanently redirect it to the apex."
  type        = bool
  default     = false
}

resource "aws_route53_zone" "public" {
  count             = var.create_hosted_zone && var.domain_name != "" ? 1 : 0
  name              = var.domain_name
  delegation_set_id = var.delegation_set_id
  lifecycle {
    prevent_destroy = true
  }
}

variable "delegation_set_id" {
  description = "Optional reusable delegation set, preserving registrar nameservers during domain correction."
  type        = string
  default     = null
}

# Retain the initially provisioned typo zone until the domain migration is verified.
resource "aws_route53_zone" "legacy_gonata" {
  name = "gonata.ca"
  # The live zone sits on the same reusable delegation set as the public zone
  # (that is how the registrar's nameservers survived the domain correction).
  # Declaring it here keeps the config equal to the account: without this line
  # every plan wanted to replace the zone and prevent_destroy refused, which
  # blocked every apply (found 2026-09-11 while adding brand.gonota.ca).
  delegation_set_id = var.delegation_set_id
  lifecycle { prevent_destroy = true }
}

resource "aws_route53_delegation_set" "production" {
  lifecycle { prevent_destroy = true }
}

locals {
  dns_zone_id = var.create_hosted_zone && var.domain_name != "" ? aws_route53_zone.public[0].zone_id : var.hosted_zone_id
  plan_dns_zone_id = var.plan_hosted_zone_id != null ? var.plan_hosted_zone_id : (
    endswith(var.plan_domain_name, ".gonata.ca") ? aws_route53_zone.legacy_gonata.zone_id : local.dns_zone_id
  )
  pitch_dns_zone_id = var.pitch_hosted_zone_id != null ? var.pitch_hosted_zone_id : local.dns_zone_id
  brand_dns_zone_id = var.brand_hosted_zone_id != null ? var.brand_hosted_zone_id : local.dns_zone_id
}

resource "aws_route53_record" "www" {
  for_each = var.enable_www && var.domain_name != "" ? toset(["A", "AAAA"]) : toset([])
  zone_id  = local.dns_zone_id
  name     = "www.${var.domain_name}"
  type     = each.value
  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "plan_a" {
  count   = var.plan_domain_name != "" ? 1 : 0
  zone_id = local.plan_dns_zone_id
  name    = var.plan_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "plan_aaaa" {
  count   = var.plan_domain_name != "" ? 1 : 0
  zone_id = local.plan_dns_zone_id
  name    = var.plan_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "pitch_a" {
  count   = var.pitch_domain_name != "" ? 1 : 0
  zone_id = local.pitch_dns_zone_id
  name    = var.pitch_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "pitch_aaaa" {
  count   = var.pitch_domain_name != "" ? 1 : 0
  zone_id = local.pitch_dns_zone_id
  name    = var.pitch_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "brand_a" {
  count   = var.brand_domain_name != "" ? 1 : 0
  zone_id = local.brand_dns_zone_id
  name    = var.brand_domain_name
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "brand_aaaa" {
  count   = var.brand_domain_name != "" ? 1 : 0
  zone_id = local.brand_dns_zone_id
  name    = var.brand_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_cloudfront_distribution.web.domain_name
    zone_id                = aws_cloudfront_distribution.web.hosted_zone_id
    evaluate_target_health = false
  }
}

output "registrar_nameservers" {
  description = "Set these four authoritative nameservers at GoDaddy (not an NS record inside the old zone)."
  value       = var.create_hosted_zone && var.domain_name != "" ? aws_route53_zone.public[0].name_servers : []
}

# Preserve incoming mail when moving the registrar's DNS to Route 53. Values
# come from the chosen mailbox provider; no paid mailbox service is assumed.
variable "inbound_mx_records" {
  description = "MX records for gonota.ca inbox hosting, supplied by the mailbox provider."
  type        = list(string)
  default     = []
}
resource "aws_route53_record" "inbound_mail" {
  count   = var.domain_name != "" && length(var.inbound_mx_records) > 0 ? 1 : 0
  zone_id = local.dns_zone_id
  name    = var.domain_name
  type    = "MX"
  ttl     = 300
  records = var.inbound_mx_records
}
variable "mailbox_txt_records" {
  description = "Mailbox-provider verification/SPF TXT records, keyed by full DNS name. Keep only one SPF policy per name."
  type        = map(list(string))
  default     = {}
}
resource "aws_route53_record" "mailbox_txt" {
  for_each = var.mailbox_txt_records
  zone_id  = local.dns_zone_id
  name     = each.key
  type     = "TXT"
  ttl      = 300
  records  = each.value
}

variable "mailbox_cname_records" {
  description = "Mailbox-provider DKIM/verification CNAMEs, keyed by full DNS name."
  type        = map(string)
  default     = {}
}
resource "aws_route53_record" "mailbox_cname" {
  for_each = var.mailbox_cname_records
  zone_id  = local.dns_zone_id
  name     = each.key
  type     = "CNAME"
  ttl      = 300
  records  = [each.value]
}
