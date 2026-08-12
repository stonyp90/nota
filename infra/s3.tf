###############################################################################
# S3 — private origin bucket for the web (SPA) assets.
#
# The bucket is fully private: no public access, no website endpoint. CloudFront
# reaches it through an Origin Access Control (OAC) and a bucket policy that
# grants read access ONLY to this distribution (scoped by the distribution ARN).
###############################################################################

# Suffix keeps the (globally unique) bucket name stable but non-guessable.
resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "web" {
  bucket = "${var.project_name}-web-${random_id.bucket_suffix.hex}"
}

# Enable object versioning so overwritten/deleted assets can be recovered.
resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Server-side encryption at rest (S3-managed keys, AES256).
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Block ALL public access — the bucket is only ever read via CloudFront + OAC.
resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Origin Access Control: modern (SigV4) replacement for Origin Access Identity.
# CloudFront signs requests to S3 with this OAC.
resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${var.project_name}-web-oac"
  description                       = "OAC for ${var.project_name} web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Bucket policy: allow ONLY the CloudFront service principal, and only when the
# request originates from this exact distribution (AWS:SourceArn condition).
data "aws_iam_policy_document" "web_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontReadViaOAC"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.web.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.web.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id
  policy = data.aws_iam_policy_document.web_bucket_policy.json

  # Ensure public-access-block is applied before the policy is attached.
  depends_on = [aws_s3_bucket_public_access_block.web]
}
