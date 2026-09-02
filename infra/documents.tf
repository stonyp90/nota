###############################################################################
# Le seau des DOCUMENTS de la messagerie (ADR 0032).
#
# Nota est dépositaire, jamais destinataire : elle conserve des octets pour les
# deux seules parties d'une conversation retenue. Les art. 35 à 37 du Code de
# déontologie tiennent le notaire au secret professionnel, et l'art. 12 lui
# impose de veiller au respect de la loi par ceux qui collaborent avec lui —
# c'est pourquoi la console admin n'a AUCUN accès à ce seau, et pourquoi le
# chiffrement se fait sous une clé dont l'usage est journalisé.
#
# Les octets ne transitent jamais par la Lambda : le navigateur parle
# directement à S3 par une URL signée que l'API émet après avoir décidé de
# l'accès. La Lambda n'a donc que le droit de SIGNER — pas de lire.
###############################################################################

# La clé de chiffrement. Une clé gérée par Nota plutôt que la clé de service
# S3 : l'usage devient journalisable dans CloudTrail, et la révocation est
# possible. C'est ce qui distingue « chiffré » de « chiffré et vérifiable ».
resource "aws_kms_key" "documents" {
  description             = "${var.project_name} — documents de la messagerie notaire ⇄ client"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "documents" {
  name          = "alias/${var.project_name}-documents"
  target_key_id = aws_kms_key.documents.key_id
}

resource "aws_s3_bucket" "documents" {
  bucket = "${var.project_name}-documents-${random_id.bucket_suffix.hex}"
}

# Aucun accès public, sous aucune forme. C'est la ceinture ; la politique de
# seau ci-dessous est la bretelle.
resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.documents.arn
    }
    # Réduit les appels KMS par objet sans changer la garantie.
    bucket_key_enabled = true
  }
}

# La conservation suit celle de l'offre : 12 mois au plus après la date de
# signature (politique de conservation, Loi 25). Un objet dont personne n'a plus
# besoin est un risque qui ne rapporte rien.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "effacer-apres-12-mois"
    status = "Enabled"
    filter {}
    expiration {
      days = 400
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# TLS obligatoire, et chiffrement obligatoire. Un dépôt en clair est refusé par
# le seau lui-même — l'adaptateur l'impose déjà dans l'autorisation signée, mais
# une garantie qui ne tient qu'au code applicatif n'en est pas une.
resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = data.aws_iam_policy_document.documents_bucket.json
}

data "aws_iam_policy_document" "documents_bucket" {
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid    = "DenyUnencryptedPut"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
    condition {
      test     = "StringNotEquals"
      variable = "s3:x-amz-server-side-encryption"
      values   = ["aws:kms"]
    }
  }
}

# CORS : le navigateur du client et celui du notaire téléversent DIRECTEMENT
# ici. Sans cette autorisation d'origine, le dépôt échouerait dans le
# navigateur, après le choix du fichier — l'échec le plus opaque possible.
resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_methods = ["PUT", "GET"]
    # L'origine publique du site. La console admin n'est PAS listée : elle n'a
    # aucun accès aux documents (ADR 0032 — Nota est dépositaire, jamais
    # destinataire), et une origine autorisée « au cas où » finit toujours par
    # servir à quelque chose.
    allowed_origins = compact([var.base_url])
    allowed_headers = ["content-type", "x-amz-server-side-encryption", "x-amz-server-side-encryption-aws-kms-key-id"]
    expose_headers  = ["etag"]
    max_age_seconds = 300
  }
}

output "documents_bucket_name" {
  description = "Le seau des documents de la messagerie (NOTA_DOCS_BUCKET)."
  value       = aws_s3_bucket.documents.bucket
}

output "documents_kms_key_arn" {
  description = "La clé de chiffrement des documents (NOTA_DOCS_KMS_KEY_ID)."
  value       = aws_kms_key.documents.arn
}

###############################################################################
# La permission de la Lambda publique : SIGNER, jamais LIRE.
#
# Les octets ne transitent pas par la fonction (ADR 0032). Elle n'a donc besoin
# que de fabriquer des URL signées et de constater qu'un dépôt est arrivé —
# `HeadObject`. `GetObject` figure parce que S3 exige la permission SOUS-JACENTE
# pour signer une lecture : une URL signée ne peut jamais accorder plus que ce
# que son signataire possède. C'est aussi ce qui rend la fuite bornée — le
# signataire est une fonction sans terminal, dont chaque signature est
# journalisée par l'application.
#
# `PutObject` est là pour la même raison, côté dépôt. Aucun `ListBucket` : la
# fonction ne doit jamais pouvoir énumérer les documents de la plateforme, et
# rien dans le produit ne le demande — une clé se dérive, elle ne se cherche pas.
###############################################################################
data "aws_iam_policy_document" "api_documents" {
  statement {
    sid    = "SignerEtConstater"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:DeleteObject",
    ]
    resources = ["${aws_s3_bucket.documents.arn}/*"]
  }

  # Le chiffrement et le déchiffrement passent par la clé de Nota. L'usage est
  # journalisé dans CloudTrail : « chiffré » devient « chiffré et vérifiable ».
  statement {
    sid    = "ChiffrerAvecLaCleDeNota"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
    ]
    resources = [aws_kms_key.documents.arn]
  }
}

resource "aws_iam_role_policy" "api_documents" {
  name   = "${var.project_name}-api-documents"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_documents.json
}
