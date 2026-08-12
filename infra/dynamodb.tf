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
}
