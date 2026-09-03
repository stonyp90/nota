###############################################################################
# SES — identité de DOMAINE (DKIM + MAIL FROM + DMARC), optionnelle.
#
# Pourquoi ce fichier existe : l'identité `aws_sesv2_email_identity.sender`
# (notifications.tf) vérifie une ADRESSE. Envoyer depuis une adresse Gmail via
# SES casse l'alignement SPF/DKIM — c'est du courrier indésirable presque
# garanti, et AWS n'accorde pas la sortie du bac à sable sans domaine vérifié.
#
# Tout ici est gardé par `var.domain_name` ET `var.hosted_zone_id` (acm.tf
# utilise les mêmes) : sans domaine, aucune ressource n'est créée. Avec un
# domaine, Terraform pose lui-même les enregistrements DNS :
#   - 3 CNAME DKIM (Easy DKIM, clé RSA 2048) ;
#   - MX + TXT (SPF) sur le sous-domaine MAIL FROM `courriel.<domaine>` ;
#   - TXT DMARC sur `_dmarc.<domaine>`, en quarantaine, rapports agrégés vers
#     `var.dmarc_report_email` si elle est fournie.
#
# Ce que Terraform ne fait PAS : sortir du bac à sable. C'est une demande au
# support AWS (cas « Service limit increase » → SES sending limits). Le texte de
# la demande est dans docs/go-to-market/plan-pmf-30-jours.md.
###############################################################################

variable "dmarc_report_email" {
  description = "Boîte qui reçoit les rapports DMARC agrégés (rua). Vide = aucune adresse de rapport dans l'enregistrement."
  type        = string
  default     = ""
}

variable "mail_from_subdomain" {
  description = "Sous-domaine MAIL FROM personnalisé (alignement SPF). Le domaine complet devient <sous-domaine>.<domain_name>."
  type        = string
  default     = "courriel"
}

locals {
  ses_domain_enabled = var.domain_name != "" && var.hosted_zone_id != null
  ses_mail_from      = "${var.mail_from_subdomain}.${var.domain_name}"
}

# --- L'identité de domaine ----------------------------------------------------
resource "aws_sesv2_email_identity" "domain" {
  count          = local.ses_domain_enabled ? 1 : 0
  email_identity = var.domain_name

  dkim_signing_attributes {
    next_signing_key_length = "RSA_2048_BIT"
  }
}

# Easy DKIM : trois CNAME, un par jeton publié par SES.
resource "aws_route53_record" "ses_dkim" {
  count   = local.ses_domain_enabled ? 3 : 0
  zone_id = var.hosted_zone_id
  name    = "${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}._domainkey.${var.domain_name}"
  type    = "CNAME"
  ttl     = 600
  records = ["${aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens[count.index]}.dkim.amazonses.com"]
}

# --- MAIL FROM personnalisé (alignement SPF) ----------------------------------
resource "aws_sesv2_email_identity_mail_from_attributes" "domain" {
  count            = local.ses_domain_enabled ? 1 : 0
  email_identity   = aws_sesv2_email_identity.domain[0].email_identity
  mail_from_domain = local.ses_mail_from
  # Si le MAIL FROM ne peut pas être utilisé, SES retombe sur amazonses.com
  # plutôt que de refuser l'envoi : la délivrabilité baisse, le courriel part.
  behavior_on_mx_failure = "USE_DEFAULT_VALUE"
}

resource "aws_route53_record" "ses_mail_from_mx" {
  count   = local.ses_domain_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.ses_mail_from
  type    = "MX"
  ttl     = 600
  records = ["10 feedback-smtp.${var.region}.amazonses.com"]
}

resource "aws_route53_record" "ses_mail_from_spf" {
  count   = local.ses_domain_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = local.ses_mail_from
  type    = "TXT"
  ttl     = 600
  records = ["v=spf1 include:amazonses.com -all"]
}

# --- DMARC --------------------------------------------------------------------
# Quarantaine plutôt que rejet : au démarrage, un faux positif coûte un
# courriel de notaire perdu ; passer à `p=reject` une fois les rapports propres.
resource "aws_route53_record" "ses_dmarc" {
  count   = local.ses_domain_enabled ? 1 : 0
  zone_id = var.hosted_zone_id
  name    = "_dmarc.${var.domain_name}"
  type    = "TXT"
  ttl     = 600
  records = [
    var.dmarc_report_email == ""
    ? "v=DMARC1; p=quarantine; adkim=s; aspf=s"
    : "v=DMARC1; p=quarantine; adkim=s; aspf=s; rua=mailto:${var.dmarc_report_email}"
  ]
}

# --- Rebonds et plaintes → le sujet d'alertes existant ------------------------
# La demande de sortie du bac à sable exige de décrire la gestion des rebonds
# et des plaintes. Ici : chaque événement part sur le même sujet SNS que les
# alarmes (observability.tf), donc vers `var.alert_email` une fois abonné.
resource "aws_sesv2_configuration_set" "main" {
  count                  = local.ses_domain_enabled ? 1 : 0
  configuration_set_name = "${var.project_name}-transactionnel"

  delivery_options {
    tls_policy = "REQUIRE"
  }

  reputation_options {
    reputation_metrics_enabled = true
  }
}

resource "aws_sesv2_configuration_set_event_destination" "alerts" {
  count                  = local.ses_domain_enabled ? 1 : 0
  configuration_set_name = aws_sesv2_configuration_set.main[0].configuration_set_name
  event_destination_name = "rebonds-et-plaintes"

  event_destination {
    enabled              = true
    matching_event_types = ["BOUNCE", "COMPLAINT", "REJECT"]

    sns_destination {
      topic_arn = aws_sns_topic.alerts.arn
    }
  }
}

output "ses_domain_identity" {
  description = "Domaine vérifié pour l'envoi (vide tant qu'aucun domaine n'est configuré)."
  value       = local.ses_domain_enabled ? aws_sesv2_email_identity.domain[0].email_identity : ""
}
