###############################################################################
# Lambda — the Nota API (Node.js 20) behind a Lambda function URL.
#
# The function code is the apps/api directory, zipped at plan time by the
# archive_file data source. TABLE_NAME is injected via the environment; the
# handler also reads AWS_REGION, which Lambda sets automatically at runtime.
###############################################################################

# NOTE: this archive includes apps/api/node_modules if it is present on disk.
# That is acceptable here (the AWS SDK v3 clients are the only real deps), but a
# proper build pipeline should run `npm ci --omit=dev` inside apps/api first so
# only production dependencies are packaged. The workspace-linked @nota/domain
# dependency must also be vendored/bundled by that build step for runtime use.
data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.module}/../apps/api"
  output_path = "${path.module}/build/api.zip"
}

# ---------------------------------------------------------------------------
# IAM role + least-privilege policy
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "api" {
  name               = "${var.project_name}-api-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Least-privilege data access: only the actions the handler performs, and only
# against this table's ARN (no wildcards on resources).
data "aws_iam_policy_document" "api_dynamodb" {
  statement {
    sid    = "TableAccess"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      # UpdateItem lets the public API atomically ADD to the STATS# rollup
      # counters (best-effort analytics the admin surface reads). This is the
      # ONLY admin-related grant that is NOT gated behind var.enable_admin — it
      # is purely additive (no dynamodb:Scan, no new resources).
      "dynamodb:UpdateItem",
    ]

    resources = [aws_dynamodb_table.main.arn]
  }
}

resource "aws_iam_role_policy" "api_dynamodb" {
  name   = "${var.project_name}-api-dynamodb"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_dynamodb.json
}

# Basic execution role: allows writing logs to CloudWatch Logs.
resource "aws_iam_role_policy_attachment" "api_logs" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# ---------------------------------------------------------------------------
# Notary console token signing secret
# ---------------------------------------------------------------------------

# Generated in Terraform so the production signing secret is NEVER empty (an
# empty secret would make the API fall back to a public dev constant and let
# anyone forge console tokens — the handler now fails closed on that in prod).
# Stored in state (sensitive); rotate by tainting this resource.
resource "random_password" "notary_secret" {
  length  = 48
  special = false
}

# ---------------------------------------------------------------------------
# Function + function URL
# ---------------------------------------------------------------------------

resource "aws_lambda_function" "api" {
  function_name = "${var.project_name}-api"
  role          = aws_iam_role.api.arn

  runtime = "nodejs20.x"
  handler = "index.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 10
  memory_size = var.api_memory_size

  # Blast-radius cap: hard ceiling on concurrent executions so a traffic spike
  # or DoS can't exhaust account-wide Lambda concurrency or run up unbounded cost.
  reserved_concurrent_executions = var.api_reserved_concurrency

  # Ensure the retention-capped log group (logs.tf) exists before the first
  # invocation, so Lambda writes to it instead of auto-creating a never-expire one.
  depends_on = [aws_cloudwatch_log_group.api]

  environment {
    variables = {
      # AWS_REGION is a reserved runtime variable set by Lambda automatically,
      # so it is intentionally NOT declared here.
      TABLE_NAME = aws_dynamodb_table.main.name

      # Marks this as a production runtime so the API's notary auth fails CLOSED:
      # a missing/empty NOTA_NOTARY_SECRET throws instead of signing tokens with
      # the public dev fallback constant.
      NODE_ENV = "production"

      # Stripe billing — free-for-notaries + commission (Stripe Connect). Values
      # come from TF_VAR_stripe_* / a gitignored tfvars, never hardcoded here;
      # use test-mode Connect keys outside production. The secret key must belong
      # to a Connect-enabled platform account.
      STRIPE_SECRET_KEY     = var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.stripe_webhook_secret

      # ADR 0031 — il n'y a plus de commission. Nota ne prélève aucune part des
      # honoraires du notaire : elle vend son service à son PRIX. Les trois
      # variables de taux qui vivaient ici ont été retirées le 2026-09-02 :
      # plus aucun code ne les lit, et les laisser décrirait l'opération que
      # l'art. 32 du Code de déontologie interdit au notaire.
      #
      # ADR 0034 — ce prix est devenu une GRILLE : une ligne par service, plus
      # la garantie de date sur sa propre ligne. NOTA_PRIX_GRILLE la porte en
      # JSON ; NOTA_PRIX_CENTS est l'ANCIEN prix unique, gardé pour qu'un
      # déploiement d'avant le 2026-09-03 tarife exactement ce qu'il tarifait la
      # veille. Les deux ne se composent JAMAIS : une grille lisible décide
      # seule. Les deux vides = la grille du catalogue, ce qui est le cas voulu
      # aujourd'hui. La console admin surcharge le tout via CONFIG#PRIX — et
      # cette ligne stockée l'emporte sur l'environnement, donc changer ces
      # variables sur un déploiement qui porte déjà une grille en base ne
      # changera rien tant que l'opérateur n'aura pas remis la sienne à zéro.
      NOTA_PRIX_CENTS  = var.prix_nota_cents
      NOTA_PRIX_GRILLE = var.prix_nota_grille
      # Where Stripe returns the notary after Connect onboarding (hash routes to
      # the Notaires tab; base_url falls back to the CloudFront domain).
      NOTA_ONBOARDING_RETURN_URL  = "${var.base_url}/#notaires"
      NOTA_ONBOARDING_REFRESH_URL = "${var.base_url}/#notaires"

      # Notary console token signing secret, generated by Terraform so it is
      # never empty in production (see random_password.notary_secret above).
      NOTA_NOTARY_SECRET = random_password.notary_secret.result

      # Email notifications (see notifications.tf). When NOTA_FROM_EMAIL is empty
      # the handler leaves notifications DISABLED, so the stack is fully
      # functional without SES configured. Set var.from_email to enable.
      NOTA_FROM_EMAIL     = var.from_email
      NOTA_OPERATOR_EMAIL = var.operator_email
      NOTA_BASE_URL       = var.base_url
      # L'origine où Stripe renvoie le client après le paiement. Le handler
      # retombe désormais sur NOTA_BASE_URL, mais la poser explicitement rend
      # l'intention lisible : sans origine, `POST /bids` refuse franchement
      # plutôt que de créer une offre dont le paiement ne peut pas aboutir.
      NOTA_SITE_URL = var.base_url
      # LCAP: full identification of the sender. Empty leaves the recognizable
      # placeholder in emails.js, which a test refuses in production — a
      # commercial message must carry a REAL mailing address.
      NOTA_SENDER_ADDRESS = var.sender_address
      # ADR 0032 — le seau des documents de la messagerie. VIDE = les portes de
      # document répondent 503 et la messagerie reste texte : un déploiement
      # sans seau n'est pas cassé, il est simplement plus étroit.
      NOTA_DOCS_BUCKET     = aws_s3_bucket.documents.bucket
      NOTA_DOCS_KMS_KEY_ID = aws_kms_key.documents.arn
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

# Public function URL (auth NONE). Access control is delegated to CloudFront,
# which is the only intended caller (path /api/* behavior). Keeping auth NONE
# lets CloudFront forward requests without SigV4 signing of the origin.
resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "AWS_IAM"
}

# Only CloudFront (this distribution) may invoke the function URL, via the OAC
# that signs requests with SigV4. The raw function URL stays private.
resource "aws_lambda_permission" "cloudfront_url" {
  statement_id           = "AllowCloudFrontInvokeUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "cloudfront.amazonaws.com"
  source_arn             = aws_cloudfront_distribution.web.arn
  function_url_auth_type = "AWS_IAM"
}
