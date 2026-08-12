###############################################################################
# DynamoDB — single-table design for the Nota API.
#
# Data residency: this table lives in ca-central-1 (the default provider region)
# so that all customer data stays in Canada, as required by Quebec's Law 25
# (Loi 25 / modernization of personal-information protection).
###############################################################################

resource "aws_dynamodb_table" "main" {
  name         = "${var.project_name}-main"
  billing_mode = "PAY_PER_REQUEST" # on-demand: no capacity planning, pay per request

  # Guard against accidental (or malicious) table deletion. Must be explicitly
  # disabled before the table can be destroyed.
  deletion_protection_enabled = true

  # FUTURE IMPROVEMENT: enable encryption at rest with a customer-managed KMS key
  # (SSE-KMS via a server_side_encryption block) instead of the default
  # AWS-owned key, for tighter key control / auditability.

  hash_key  = "PK"
  range_key = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # Point-in-time recovery: continuous backups for the last 35 days.
  point_in_time_recovery {
    enabled = true
  }

  # Auto-expire bids ~13 months after the signing date (Law 25 retention + no
  # storage cost for stale data). The API stamps an epoch-seconds `ttl` on bid
  # items only; notary/subscription items have no ttl and persist. TTL deletes
  # are free.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}
