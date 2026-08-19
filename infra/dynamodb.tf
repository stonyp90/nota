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

  # GSI1 partition/sort attributes. Only items that carry these attributes appear
  # in the index (a SPARSE GSI). Today the sole writer is the open-bid enumeration
  # used by the daily reminder worker (apps/api keys.js: GSI1PK = "OPENBID"); admin
  # phase 2 can overload the same index with its own GSI1PK namespaces.
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  attribute {
    name = "GSI1SK"
    type = "S"
  }

  # GSI1 — sparse index over OPEN bids so the daily reminder scheduler reads the
  # open set with one Query instead of a full-table Scan (cost scales with the
  # number of open bids, not the whole table). PAY_PER_REQUEST table => the index
  # is on-demand too (no capacity to provision). Projection ALL so the worker gets
  # the full bid item from the index without a second GetItem.
  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "GSI1SK"
    projection_type = "ALL"
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
