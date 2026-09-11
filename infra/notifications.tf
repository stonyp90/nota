###############################################################################
# Email notifications + daily reminder scheduler
#
# What this file adds:
#   - an SES v2 email identity for the sender address (var.from_email);
#   - SES send permission for the existing API Lambda (it now sends the offer
#     confirmation and subscription lifecycle emails);
#   - a daily reminder Lambda (handler `reminders.handler`) that reuses the same
#     apps/api code bundle as the API Lambda;
#   - an EventBridge Scheduler that invokes the reminder Lambda once a day
#     (~13:00 UTC ≈ 09:00 in Québec), with least-privilege IAM.
#
# SES SANDBOX CAVEAT (read before going live):
#   A new SES account/region starts in the SANDBOX: you may only send TO
#   verified addresses, and at a low rate. To email real clients and notaries
#   you must (1) verify a sending DOMAIN with DKIM, and (2) request PRODUCTION
#   access ("exit the sandbox") from AWS Support. Nothing in Terraform leaves the
#   sandbox automatically — until you do, verify each individual test recipient.
#   Data residency (Law 25): SES here runs in the default provider region
#   (ca-central-1), like the rest of the stack.
###############################################################################

# --- Variables (kept local to this file; the rest of infra is unaffected) ----

variable "from_email" {
  description = "Verified SES sender address (e.g. bonjour@nota.ca). Empty string disables email and creates no SES resources. Verify a domain and exit the SES sandbox before production."
  type        = string
  default     = ""
}

variable "operator_email" {
  description = "Nota's own inbox for operator notifications (new lead, notary subscribed). Empty disables operator emails."
  type        = string
  default     = ""
}

variable "operator_name" {
  description = "Le prénom de la personne qui reprend les questions escaladées (ADR 0046). L'assistant le nomme au visiteur ; vide, c'est « Nota » qui répond."
  type        = string
  default     = ""
}

variable "base_url" {
  description = "Public site origin used to build CTA + unsubscribe links in emails (e.g. https://nota.ca)."
  type        = string
  default     = ""
}

# --- L'assistant de la messagerie (ADR 0046) ---------------------------------
# Une clé VIDE laisse la messagerie exactement comme avant : chaque question
# part par courriel à l'opérateur, aucune réponse automatique. C'est une
# dégradation propre, pas une panne — et c'est l'état par défaut.
# LA CLÉ N'EST PAS UNE VARIABLE TERRAFORM, ET NE DOIT JAMAIS LE REDEVENIR.
# Terraform écrit la valeur de chaque variable dans son état, EN CLAIR —
# `sensitive = true` ne masque que la sortie de la console. L'état de ce dépôt
# est local (infra/terraform.tfstate, plus son .backup). Une clé d'API en
# variable est donc une clé déposée en clair sur le disque du propriétaire.
#
# Terraform ne connaît ici que le NOM d'un paramètre SSM et le droit de le
# lire. La valeur s'y pose une seule fois, hors de ce dépôt :
#
#   aws ssm put-parameter --name /nota/assistant/anthropic-api-key \
#     --type SecureString --value 'sk-ant-...' --region ca-central-1
#
# Palier standard : gratuit (Secrets Manager coûterait 0,40 $/mois/secret).
# `apps/api/test/assistant-secret.test.mjs` lit CE fichier et refuse le retour
# d'une variable qui porterait la valeur.
variable "assistant_key_param" {
  description = "Nom du paramètre SSM SecureString qui porte la clé API de l'assistant (ADR 0046). Sa VALEUR n'est jamais connue de Terraform. Vide = aucune réponse automatique, chaque question part à l'opérateur."
  type        = string
  default     = "/nota/assistant/anthropic-api-key"
}

variable "assistant_model" {
  description = "Le modèle qui rédige les réponses de la messagerie. Vide = le défaut du port (assistant-port.js)."
  type        = string
  default     = ""
}

variable "assistant_timeout_ms" {
  description = "Délai maximal d'un appel au modèle, en millisecondes. DOIT rester sous le délai de la Lambda : un dépassement doit devenir une escalade propre, jamais un 502."
  type        = number
  default     = 12000
}

# --- SES email identity ------------------------------------------------------
# Created only when a sender address is configured. For production prefer a
# verified DOMAIN identity (better deliverability + DKIM); a single-address
# identity is enough for sandbox testing.
resource "aws_sesv2_email_identity" "sender" {
  count          = var.from_email == "" ? 0 : 1
  email_identity = var.from_email
}

# --- SES send permission (shared policy document) ----------------------------
# SES v2 SendEmail maps to the ses:SendEmail IAM action. There is no convenient
# per-identity resource ARN to scope to, so we constrain by the From address
# instead — least privilege without brittle ARNs.
data "aws_iam_policy_document" "ses_send" {
  statement {
    sid       = "SendEmail"
    effect    = "Allow"
    actions   = ["ses:SendEmail"]
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

# Attach SES send to the EXISTING API Lambda role (defined in lambda.tf): the
# API now emits the offer-published confirmation and subscription lifecycle
# emails inline (fire-and-forget).
resource "aws_iam_role_policy" "api_ses" {
  name   = "${var.project_name}-api-ses"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.ses_send.json
}

# --- Reminder Lambda role + least-privilege policies -------------------------
resource "aws_iam_role" "reminders" {
  name               = "${var.project_name}-reminders-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# The scheduler enumerates open bids via a Query on the sparse GSI1 (no Scan),
# reads the sent/unsub ledgers (GetItem) and writes the sent ledger (PutItem).
# Scoped to this table's ARN AND its index ARNs — Querying a GSI requires the
# "<table>/index/*" resource. dynamodb:Scan is intentionally NOT granted.
data "aws_iam_policy_document" "reminders_dynamodb" {
  statement {
    sid    = "TableReadWrite"
    effect = "Allow"

    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
    ]

    resources = [
      aws_dynamodb_table.main.arn,
      "${aws_dynamodb_table.main.arn}/index/*",
    ]
  }
}

resource "aws_iam_role_policy" "reminders_dynamodb" {
  name   = "${var.project_name}-reminders-dynamodb"
  role   = aws_iam_role.reminders.id
  policy = data.aws_iam_policy_document.reminders_dynamodb.json
}

resource "aws_iam_role_policy" "reminders_ses" {
  name   = "${var.project_name}-reminders-ses"
  role   = aws_iam_role.reminders.id
  policy = data.aws_iam_policy_document.ses_send.json
}

resource "aws_iam_role_policy_attachment" "reminders_logs" {
  role       = aws_iam_role.reminders.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Reminder Lambda ---------------------------------------------------------
# Reuses the SAME zip as the API Lambda (data.archive_file.api in lambda.tf);
# only the handler differs. AWS_REGION is set automatically by Lambda at runtime.
resource "aws_lambda_function" "reminders" {
  function_name = "${var.project_name}-reminders"
  role          = aws_iam_role.reminders.arn

  runtime = "nodejs22.x"
  handler = "reminders.handler"

  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256

  timeout     = 60
  memory_size = 256

  # Use the retention-capped log group (logs.tf) rather than a never-expire one.
  depends_on = [aws_cloudwatch_log_group.reminders]

  environment {
    variables = {
      NOTA_SES_CONFIGURATION_SET = local.ses_domain_enabled ? aws_sesv2_configuration_set.main[0].configuration_set_name : ""
      NOTA_EMAIL_LANGUAGE        = var.email_language
      NOTA_REPLY_TO_EMAIL        = var.reply_to_email
      NOTA_SENDER_ADDRESS        = var.sender_address
      NOTA_ADMIN_URL             = var.admin_domain_name != "" ? "https://${var.admin_domain_name}" : ""
      NODE_ENV                   = "production"
      NOTA_RUNTIME_SECRET_ARN    = var.use_secrets_manager ? aws_secretsmanager_secret.public[0].arn : ""
      NOTA_REQUIRED_SECRETS      = var.stripe_mode == "unconfigured" ? "NOTA_NOTARY_SECRET" : "NOTA_NOTARY_SECRET,STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET"
      TABLE_NAME                 = aws_dynamodb_table.main.name
      NOTA_FROM_EMAIL            = var.from_email
      # SMS leg of the reminders (dateApproaching, cautionRefusee) — same opt-in as the API.
      NOTA_SMS_ENABLED    = tostring(var.sms_enabled)
      NOTA_SMS_SENDER_ID  = var.sms_sender_id
      NOTA_OPERATOR_EMAIL = var.operator_email
      NOTA_BASE_URL       = var.base_url

      # ADR 0033 §2.7 — le lien signé qui ouvre L'ACTE du client est le bouton de
      # tous ces courriels. Ce lot le frappe lui-même, donc il lui faut l'origine
      # publique et LE MÊME secret que la Lambda API : un lien signé avec un autre
      # secret ne se vérifierait pas au retour. (apps/api/test/rappels-lien-client
      # tient les deux ensemble.)
      NOTA_SITE_URL      = var.base_url
      NOTA_NOTARY_SECRET = var.use_secrets_manager ? "" : random_password.notary_secret.result

      # ADR 0035 — la caution. Ce lot quotidien pose, hors session, l'autorisation
      # de carte qui doit vivre jusqu'à la signature : sans clé Stripe il ne pose
      # rien et se limite aux rappels. La clé de webhook n'y sert à rien (aucune
      # signature à vérifier ici) ; elle n'est passée que parce que l'adaptateur
      # l'exige à la construction.
      STRIPE_SECRET_KEY     = var.use_secrets_manager ? "" : var.stripe_secret_key
      STRIPE_WEBHOOK_SECRET = var.use_secrets_manager ? "" : var.stripe_webhook_secret
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

# --- EventBridge Scheduler: fire the reminder Lambda daily -------------------
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${var.project_name}-reminders-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

data "aws_iam_policy_document" "scheduler_invoke" {
  statement {
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = [aws_lambda_function.reminders.arn]
  }
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name   = "${var.project_name}-reminders-scheduler-invoke"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_invoke.json
}

# Daily at 13:00 UTC (~09:00 in Québec, EDT). EventBridge Scheduler (not the
# legacy CloudWatch Events rule) invokes the Lambda directly via the role above,
# so no resource-based lambda permission is needed.
resource "aws_scheduler_schedule" "reminders" {
  name = "${var.project_name}-daily-reminders"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression          = "cron(0 13 * * ? *)"
  schedule_expression_timezone = "UTC"

  target {
    arn      = aws_lambda_function.reminders.arn
    role_arn = aws_iam_role.scheduler.arn
  }
}
