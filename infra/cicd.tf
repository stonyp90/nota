###############################################################################
# CI/CD — GitHub Actions deploy access via OpenID Connect (OIDC).
#
# GitHub Actions authenticates to AWS with a SHORT-LIVED, per-run OIDC token
# instead of a long-lived IAM access key stored as a GitHub secret. The flow:
#
#   1. The workflow requests an OIDC token from GitHub (permissions.id-token).
#   2. It calls sts:AssumeRoleWithWebIdentity against the role below, presenting
#      that token.
#   3. AWS validates the token against the OIDC provider and the role's trust
#      conditions (audience + repo/branch), then returns temporary credentials
#      scoped to the least-privilege policy attached here.
#
# Nothing sensitive is ever stored in GitHub: the role ARN is a public
# identifier and is published as a GitHub Actions *variable* (see
# .github/workflows/deploy.yml).
###############################################################################

# ---------------------------------------------------------------------------
# OIDC identity provider for GitHub Actions
# ---------------------------------------------------------------------------

# Registers token.actions.githubusercontent.com as a trusted OIDC IdP. There
# can only be ONE provider per URL per account; if the account already has one
# (shared across repos), import it instead of creating a duplicate:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::436136277668:oidc-provider/token.actions.githubusercontent.com
# This AWS account already has a GitHub Actions OIDC provider (shared across the
# owner's other projects — only one per URL per account is allowed). Reference the
# existing one as a data source instead of creating a duplicate.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# ---------------------------------------------------------------------------
# Trust policy — who may assume the deploy role, and under what conditions
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "github_deploy_assume" {
  statement {
    sid     = "GitHubActionsOIDC"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # The token's audience must be sts.amazonaws.com (set by aws-actions/
    # configure-aws-credentials). Blocks tokens minted for any other audience.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Scope trust to THIS repo, and only workflows running on the main branch —
    # so a fork, a PR from another branch, or a different repo cannot deploy.
    #
    # To widen later (pick the ones you need, they are OR'd together):
    #   - GitHub Environments:  "repo:stonyp90/nota:environment:production"
    #   - Tags (releases):      "repo:stonyp90/nota:ref:refs/tags/*"
    #   - Any branch:           "repo:stonyp90/nota:ref:refs/heads/*"
    #   - Pull requests:        "repo:stonyp90/nota:pull_request"
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:stonyp90/nota:ref:refs/heads/main"]
    }
  }
}

# ---------------------------------------------------------------------------
# Deploy role + least-privilege inline policy
# ---------------------------------------------------------------------------

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project_name}-github-deploy"
  description        = "Assumed by GitHub Actions (OIDC) to deploy the Nota web + API from main."
  assume_role_policy = data.aws_iam_policy_document.github_deploy_assume.json
}

# Only the exact actions the deploy workflow performs, each scoped to the
# specific resource ARNs (referenced by terraform address, never hardcoded).
data "aws_iam_policy_document" "github_deploy" {
  # S3: upload/replace/remove the built SPA assets in the web bucket.
  statement {
    sid    = "WebBucketObjects"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObject",
    ]
    resources = ["${aws_s3_bucket.web.arn}/*"]
  }

  # ListBucket is required for `aws s3 sync --delete` to diff the bucket.
  statement {
    sid       = "WebBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.web.arn]
  }

  # CloudFront: bust the edge cache after publishing new assets.
  statement {
    sid    = "CloudFrontInvalidation"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
    ]
    resources = [aws_cloudfront_distribution.web.arn]
  }

  # Lambda: push new code for the API and the reminders worker. Scoped to those
  # two function ARNs only — no wildcard, no permission to change config/IAM.
  statement {
    sid    = "LambdaUpdateCode"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:GetFunction",
    ]
    resources = [
      aws_lambda_function.api.arn,
      aws_lambda_function.reminders.arn,
    ]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "${var.project_name}-github-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}

# ---------------------------------------------------------------------------
# Output — publish this as the GitHub Actions variable AWS_DEPLOY_ROLE_ARN.
# ---------------------------------------------------------------------------

output "github_deploy_role_arn" {
  description = "ARN of the OIDC deploy role; set as GitHub variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.github_deploy.arn
}
