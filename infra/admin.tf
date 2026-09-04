###############################################################################
# Admin surface (admin.nota.ca) — PHASE 1, fully feature-flagged.
#
# EVERYTHING in this file and admin-cdn.tf is gated behind var.enable_admin
# (default false) via `count = local.admin_enabled`. With the flag OFF,
# `terraform plan` creates NONE of these resources: the live public stack is
# byte-for-byte unchanged. The ONLY ungated admin-related change lives in
# lambda.tf (a single additive dynamodb:UpdateItem grant so the public API can
# atomically bump the STATS# rollup counters that admin analytics read).
#
# Blast-radius isolation (Law 25): the admin surface has its OWN Lambda, its OWN
# DynamoDB table (nota-admin — admin identities / sessions / login-challenges /
# audit log / rate-limit items), its OWN CloudFront + WAF + deploy role. The
# admin Lambda can only READ the main customer table — never Scan, and its only
# write is the item-scoped CONFIG#EMAIL partition (email-template overrides,
# ADR 0018 §6 — see the LeadingKeys-conditioned statement below).
###############################################################################

locals {
  # Master switch. Used as `count` on every admin resource so the default plan
  # (enable_admin = false) is a no-op.
  admin_enabled = var.enable_admin ? 1 : 0

  # Domain-dependent admin resources (ACM cert, DNS validation + alias records,
  # CloudFront alias/cert selection). Gated on BOTH the flag AND a configured
  # admin_domain_name, so enabling admin before the domain is wired still plans
  # cleanly — the distribution falls back to the default *.cloudfront.net
  # certificate, exactly like the public distribution does without a domain.
  admin_has_domain     = var.enable_admin && var.admin_domain_name != ""
  admin_domain_enabled = local.admin_has_domain ? 1 : 0
}

# ---------------------------------------------------------------------------
# Admin token/session signing secret (NOTA_ADMIN_SECRET)
#
# Mirrors random_password.notary_secret (lambda.tf): generated in-stack so the
# production admin secret is NEVER empty/forge-able. Injected ONLY into the
# admin Lambda below — never into the public API Lambda. Rotate by tainting.
# ---------------------------------------------------------------------------
resource "random_password" "admin_secret" {
  count   = local.admin_enabled
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Admin DynamoDB table — SEPARATE from the customer table (nota-main).
#
# Holds admin identity / sessions / login-challenges / audit / rate-limit items.
# Physically isolated for blast-radius + Law-25 reasons. Same single-table
# (PK/SK) + TTL + PITR conventions as nota-main; on-demand billing.
# ---------------------------------------------------------------------------
resource "aws_dynamodb_table" "admin" {
  count        = local.admin_enabled
  name         = "${var.project_name}-admin"
  billing_mode = "PAY_PER_REQUEST"

  # Same guard as the main table: must be explicitly disabled before destroy.
  deletion_protection_enabled = true

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

  # Continuous backups (last 35 days).
  point_in_time_recovery {
    enabled = true
  }

  # Auto-expire ephemeral items (login challenges, sessions, rate-limit windows)
  # via an epoch-seconds `ttl` the handler stamps. TTL deletes are free.
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ---------------------------------------------------------------------------
# Admin Lambda IAM role + LEAST-PRIVILEGE inline policy
# ---------------------------------------------------------------------------

# Reuses data.aws_iam_policy_document.lambda_assume from lambda.tf (Lambda
# service trust) — no duplicate assume-role document.
resource "aws_iam_role" "admin" {
  count              = local.admin_enabled
  name               = "${var.project_name}-admin-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "admin_lambda" {
  count = local.admin_enabled

  # FULL item-level CRUD on the ADMIN table (+ any future indexes): admin
  # identities, sessions, login challenges, audit log, rate-limit counters.
  statement {
    sid    = "AdminTableFullAccess"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.admin[0].arn,
      "${aws_dynamodb_table.admin[0].arn}/index/*",
    ]
  }

  # « Journal append-only » cessait d'être vrai à l'étage IAM. Les écrivains
  # posent bien une ConditionExpression (`attribute_not_exists`) qui interdit
  # d'ÉCRASER une entrée, et la console l'affiche comme une garantie — mais le
  # statement ci-dessus accordait DeleteItem, UpdateItem et BatchWriteItem sur
  # TOUTE la table admin, partitions d'audit comprises. Le rôle pouvait donc
  # effacer la preuve qu'il venait d'écrire.
  #
  # Un Deny explicite l'emporte toujours sur un Allow, quel que soit l'ordre :
  # les Allow ci-dessus restent intacts, et cette interdiction se surimpose aux
  # seuls items dont la clé de partition ressemble à AUDIT#* (le seau par jour
  # ouvrable, apps/api/src/keys.js).
  #
  # CE QUE LA GARANTIE VAUT EXACTEMENT, ET RIEN DE PLUS :
  #   • couvre les appels item par item qui NOMMENT une clé de partition —
  #     DeleteItem, UpdateItem, BatchWriteItem, PutItem inclus dans un lot ;
  #   • ne couvre PAS ce qui ne porte pas `dynamodb:LeadingKeys` : une condition
  #     ForAnyValue ne s'applique jamais quand la clé de contexte est absente.
  #     PartiQL (ExecuteStatement), un TransactWriteItems non conditionné par la
  #     clé, ou une opération de niveau table (DeleteTable, RestoreTable) passent
  #     donc à côté — ce sont d'autres actions, non accordées ici ;
  #   • ne protège que CE rôle. Un humain avec la console AWS, un administrateur
  #     du compte ou un point de restauration PITR peuvent toujours réécrire
  #     l'histoire. L'immuabilité réelle demanderait un puits séparé
  #     (CloudTrail Lake, ou un bucket S3 Object Lock) : ce Deny ferme le chemin
  #     applicatif, il ne rend pas la table inviolable.
  #   • PutItem reste permis — c'est l'écriture du journal — et il faut le dire
  #     jusqu'au bout : PutItem ÉCRASE par défaut. Un PutItem sur la clé d'une
  #     entrée existante réécrirait donc la preuve, sans passer par UpdateItem.
  #     Aucune condition IAM ne sait exiger qu'un PutItem porte une
  #     ConditionExpression ; l'y ajouter en Deny ne rendrait pas la piste
  #     inaltérable, il la rendrait VIDE. Contre l'écrasement, la seule garde
  #     reste donc applicative : le `attribute_not_exists` de
  #     apps/api/src/repo-dynamo.js, sur les deux journaux, tenu par
  #     apps/api/test/audit-promesses-infra.test.mjs. Ce Deny ferme la
  #     suppression et la modification ; il ne ferme pas la réécriture.
  statement {
    sid    = "AdminTableAuditAppendOnly"
    effect = "Deny"
    actions = [
      "dynamodb:DeleteItem",
      "dynamodb:UpdateItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [aws_dynamodb_table.admin[0].arn]

    condition {
      test     = "ForAnyValue:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["AUDIT#*"]
    }
  }

  # READ-ONLY on the MAIN customer table (+ its indexes). Deliberately NO
  # dynamodb:Scan and NO write actions: the admin surface can inspect customer
  # data but can never mutate it or table-scan it (blast-radius / Law 25).
  statement {
    sid    = "MainTableReadOnly"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
    ]
    resources = [
      aws_dynamodb_table.main.arn,
      "${aws_dynamodb_table.main.arn}/index/*",
    ]
  }

  # The write door on the MAIN table, item-scoped to product CONFIGURATION
  # partitions only: the admin-editable email template overrides (ADR 0018 §6,
  # PK = 'CONFIG#EMAIL', SK = TPL#<templateKey>), the admin-decided commission
  # price of Nota (ADR 0031, PK = 'CONFIG#PRIX', SK = PRIX — this replaced
  # CONFIG#COMMISSION, whose rate schedule art. 29.1 of the Code de déontologie
  # ruled out) and the admin-decided cancellation-fee barème (ADR 0023 §2,
  # PK = 'CONFIG#ANNULATION', SK = BAREME) — see apps/api/src/keys.js. The dynamodb:LeadingKeys condition
  # confines EVERY action in this statement to items whose partition key is one
  # of those values, so the admin console can edit product configuration but
  # still cannot read, write or delete a single customer item — the read-only
  # statement above remains its only access to the rest of the table. No index
  # resource on purpose: the LeadingKeys condition key does not apply to GSI
  # queries, and every config is read/written by primary key only.
  statement {
    sid    = "MainTableConfigWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
    ]
    resources = [aws_dynamodb_table.main.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["CONFIG#EMAIL", "CONFIG#PRIX", "CONFIG#ANNULATION"]
    }
  }

  # The SECOND write door on the MAIN table: targeted campaigns
  # (apps/api/src/segments.js + the /admin/campaigns routes). Three fixed
  # partitions, and the same LeadingKeys confinement as the configuration door
  # above — see apps/api/src/keys.js:
  #
  #   AUDIENCE#GROUPES  SK = GROUP#<id>       a stored list of RECIPIENTS. NOT
  #                                           the RBAC group (GROUPS on the
  #                                           admin table), which bundles admin
  #                                           permissions — two partitions on
  #                                           two tables, never the same item.
  #   CONSENT#COURRIEL  SK = EMAIL#<address>  the CASL consent basis of one
  #                                           address (S.C. 2010, c. 23, s. 10).
  #   CAMPAGNE#ENVOIS   SK = EMAIL#<address>  the last commercial campaign that
  #                                           address received.
  #
  # The last one is not bookkeeping: it is what makes the frequency cap real.
  # Art. 56 1° of the Code de déontologie des notaires makes it derogatory to
  # solicit someone "de façon pressante ou répétée"; segments.js caps how often
  # an address can be mailed, and the cap only means something because the send
  # WRITES here afterwards. Without this grant every campaign send would fail
  # with AccessDenied on that write, and the guard would be decorative in
  # production while looking green in the tests.
  #
  # A separate statement rather than three more values on the one above, because
  # the intent differs: that one lets the console edit product CONFIGURATION,
  # this one lets it record who was written to. Reads need nothing here — the
  # MainTableReadOnly statement already covers GetItem / Query / BatchGetItem,
  # which is exactly what lastCampaignAtMany uses. No index resource: the
  # LeadingKeys condition key does not apply to GSI queries, and every one of
  # these items is read and written by primary key only.
  statement {
    sid    = "MainTableCampaignWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:BatchGetItem",
    ]
    resources = [aws_dynamodb_table.main.arn]

    condition {
      test     = "ForAllValues:StringEquals"
      variable = "dynamodb:LeadingKeys"
      values   = ["AUDIENCE#GROUPES", "CONSENT#COURRIEL", "CAMPAGNE#ENVOIS"]
    }
  }

  # The THIRD write door on the MAIN table: activating a notary (2026-09-02,
  # POST /admin/notaries/{id}/activer in apps/api/src/admin.js). The operator
  # checks the Tableau de l'Ordre and stamps `approuveLe` on the notary's own
  # record (PK = 'NOTARY#<id>', SK = PROFILE — see apps/api/src/keys.js), which
  # is the ONE field the public console gate reads; the same click moves the
  # « actifs / en intégration » gauge (PK = 'STATS#GAUGE', an atomic ADD).
  # Without this grant the activation would answer 200 in the tests and
  # AccessDenied in production — the notary would wait forever.
  #
  # LeadingKeys with a wildcard (StringLike) confines PutItem to notary
  # profiles and UpdateItem to the gauge item; the console still cannot touch a
  # bid, a dossier, a ledger row or a challenge. GetItem on the profile is
  # already covered by MainTableReadOnly.
  statement {
    sid    = "MainTableNotaryActivation"
    effect = "Allow"
    actions = [
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]
    resources = [aws_dynamodb_table.main.arn]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "dynamodb:LeadingKeys"
      values   = ["NOTARY#*", "STATS#GAUGE"]
    }
  }

  # SES send for admin login-challenge / notification email. Scoped to the
  # configured sender address exactly the way the public notifier is scoped
  # (notifications.tf): by the ses:FromAddress condition, not a brittle ARN.
  statement {
    sid       = "SendEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail", "ses:SendRawEmail"]
    resources = ["*"]

    dynamic "condition" {
      for_each = var.from_email == "" ? [] : [1]
      content {
        test     = "StringEquals"
        variable = "ses:FromAddress"
        values   = [var.from_email]
      }
    }
  }
}

resource "aws_iam_role_policy" "admin_lambda" {
  count  = local.admin_enabled
  name   = "${var.project_name}-admin-api-policy"
  role   = aws_iam_role.admin[0].id
  policy = data.aws_iam_policy_document.admin_lambda[0].json
}

# Basic execution role — CloudWatch Logs (mirrors the public API role).
resource "aws_iam_role_policy_attachment" "admin_logs" {
  count      = local.admin_enabled
  role       = aws_iam_role.admin[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# Admin Lambda — reuses the SAME apps/api bundle (data.archive_file.api) as the
# public API + reminders Lambdas; only the handler differs (admin.handler).
# AWS_REGION is set automatically by Lambda at runtime (not declared here).
# ---------------------------------------------------------------------------
resource "aws_lambda_function" "admin" {
  count         = local.admin_enabled
  function_name = "${var.project_name}-admin-api"
  role          = aws_iam_role.admin[0].arn

  runtime = "nodejs20.x"
  handler = "admin.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 10
  memory_size = var.admin_memory_size

  # Blast-radius cap: modest concurrency ceiling for the admin API. The dashboard
  # overview is a heavier read, so 5 was too tight for a few concurrent operators.
  reserved_concurrent_executions = var.admin_reserved_concurrency

  # Use the retention-capped log group (logs.tf) rather than a never-expire one.
  depends_on = [aws_cloudwatch_log_group.admin]

  environment {
    variables = {
      NODE_ENV = "production"

      # In-stack admin signing secret (never empty in production).
      NOTA_ADMIN_SECRET = random_password.admin_secret[0].result

      # Admin's own isolated table (full CRUD) + the main table (READ-ONLY use).
      ADMIN_TABLE_NAME = aws_dynamodb_table.admin[0].name
      TABLE_NAME       = aws_dynamodb_table.main.name

      # Allowlisted admin login addresses + public base URL for links.
      NOTA_ADMIN_EMAILS = join(",", var.admin_emails)
      # Custom domain when set; otherwise fall back to the CloudFront default
      # domain so the emailed magic-link is always an absolute, working URL.
      NOTA_ADMIN_BASE_URL = var.admin_domain_name != "" ? "https://${var.admin_domain_name}" : "https://${aws_cloudfront_distribution.admin[0].domain_name}"

      # Reuse the same verified SES sender the public stack uses (notifications.tf).
      NOTA_FROM_EMAIL = var.from_email
    }
  }

  # LE CODE APPARTIENT À LA CI, PAS À TERRAFORM (2026-09-01).
  # `archive_file` empaquette `apps/api` tel quel ; le déploiement, lui, VENDORE
  # d'abord @nota/domain dans apps/api/node_modules (voir
  # .github/workflows/deploy.yml). Un `terraform apply` qui reprend la main sur
  # le code livrerait donc une Lambda incapable de résoudre le domaine — une
  # panne totale, déclenchée par un changement de configuration sans rapport.
  # Terraform possède l'infrastructure ; la CI possède le code.
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}

# ---------------------------------------------------------------------------
# Admin API Gateway (HTTP API v2) — SAME rationale as the public API (apigateway.tf):
# the account SCP blocks Lambda function URLs, so the admin Lambda is invoked via
# an HTTP API (lambda:InvokeFunction). CloudFront's /api/admin/* behavior points
# at this API's execute-api host; the admin Lambda strips the leading /api itself.
# No custom domain on the API — the admin CloudFront distribution fronts it.
# ---------------------------------------------------------------------------
resource "aws_apigatewayv2_api" "admin" {
  count         = local.admin_enabled
  name          = "${var.project_name}-admin-http-api"
  protocol_type = "HTTP"
  description   = "HTTP API fronting the ${var.project_name}-admin-api Lambda (reached via the admin CloudFront /api/admin/*)."
}

resource "aws_apigatewayv2_integration" "admin" {
  count                  = local.admin_enabled
  api_id                 = aws_apigatewayv2_api.admin[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.admin[0].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "admin_default" {
  count     = local.admin_enabled
  api_id    = aws_apigatewayv2_api.admin[0].id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.admin[0].id}"
}

resource "aws_apigatewayv2_stage" "admin_default" {
  count       = local.admin_enabled
  api_id      = aws_apigatewayv2_api.admin[0].id
  name        = "$default"
  auto_deploy = true

  # Low default throttling to cap abuse (WAF already gates by IP, but this
  # protects the Lambda's reserved concurrency behind the allowlist too).
  default_route_settings {
    throttling_rate_limit  = 10
    throttling_burst_limit = 20
  }
}

resource "aws_lambda_permission" "admin_apigateway" {
  count         = local.admin_enabled
  statement_id  = "AllowAdminAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.admin[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.admin[0].execution_arn}/*/*"
}

# ---------------------------------------------------------------------------
# Admin CI/CD deploy role — SEPARATE least-privilege OIDC role (gated).
#
# Distinct from the public github_deploy role (cicd.tf) for blast-radius: this
# role can ONLY touch the admin bucket / distribution / Lambda. Its trust is
# scoped to the PROTECTED "admin-production" GitHub Environment (required
# reviewers on deploy-admin.yml), so an admin deploy needs human approval.
# Publish its ARN as the GitHub variable ADMIN_DEPLOY_ROLE_ARN.
# ---------------------------------------------------------------------------
data "aws_iam_policy_document" "admin_github_deploy_assume" {
  count = local.admin_enabled

  statement {
    sid     = "GitHubActionsOIDCAdmin"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Only workflows running in the PROTECTED "admin-production" environment may
    # assume this role. Same immutable numeric-ID subject shape as cicd.tf, but
    # keyed on `environment:` instead of `ref:refs/heads/main`.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:stonyp90@*/nota@*:environment:admin-production"]
    }
  }
}

resource "aws_iam_role" "admin_github_deploy" {
  count              = local.admin_enabled
  name               = "${var.project_name}-admin-github-deploy"
  description        = "Assumed by GitHub Actions (OIDC, admin-production environment) to deploy the Nota admin surface."
  assume_role_policy = data.aws_iam_policy_document.admin_github_deploy_assume[0].json
}

data "aws_iam_policy_document" "admin_github_deploy" {
  count = local.admin_enabled

  # S3: publish the built admin SPA to the admin bucket.
  statement {
    sid       = "AdminWebBucketObjects"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:DeleteObject", "s3:GetObject"]
    resources = ["${aws_s3_bucket.admin[0].arn}/*"]
  }

  # ListBucket for `aws s3 sync --delete`.
  statement {
    sid       = "AdminWebBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.admin[0].arn]
  }

  # CloudFront: bust the admin distribution's edge cache after publishing.
  statement {
    sid       = "AdminCloudFrontInvalidation"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = [aws_cloudfront_distribution.admin[0].arn]
  }

  # Lambda: push new code for the admin function only.
  statement {
    sid       = "AdminLambdaUpdateCode"
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode", "lambda:GetFunction"]
    resources = [aws_lambda_function.admin[0].arn]
  }
}

resource "aws_iam_role_policy" "admin_github_deploy" {
  count  = local.admin_enabled
  name   = "${var.project_name}-admin-github-deploy"
  role   = aws_iam_role.admin_github_deploy[0].id
  policy = data.aws_iam_policy_document.admin_github_deploy[0].json
}
