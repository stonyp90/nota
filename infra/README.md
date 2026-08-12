# Nota — Infrastructure (Terraform)

Terraform stack for the **Nota** monorepo: a private S3-backed SPA and a Node 20
Lambda API, both served **same-origin** through a single CloudFront distribution
(so the browser needs no CORS), backed by a single DynamoDB table.

## Architecture

```
                       ┌─────────────────────────────┐
   viewer ───────────► │      CloudFront (CDN)        │
                       │  default  ──► S3 (SPA, OAC)  │
                       │  /api/*   ──► Lambda URL     │
                       └──────────────┬──────────────┘
                                      │
                              Lambda (nodejs20.x)
                                      │
                              DynamoDB (PK/SK)
```

- **S3** — private bucket (all public access blocked, versioned, AES256). Read
  only by CloudFront via Origin Access Control (OAC).
- **Lambda** — `apps/api` zipped and deployed. Fronted by an **API Gateway HTTP
  API** (`apigateway.tf`); the account SCP blocks Lambda function URLs
  (`lambda:InvokeFunctionUrl`), so CloudFront proxies `/api/*` to the public HTTP
  API instead, which invokes the Lambda via `lambda:InvokeFunction`. See
  `docs/decisions/0004`.
- **DynamoDB** — single table, `PK`/`SK` string keys, PAY_PER_REQUEST, PITR on.
- **CloudFront** — two origins (S3 for the SPA, API Gateway for `/api/*`);
  `403`/`404` from S3 are rewritten to `/index.html` (200) for SPA routing.

## Two-provider ACM caveat

`providers.tf` declares **two** AWS providers:

- **default** → `var.region` (`ca-central-1`) for every regional resource.
- **`aws.us_east_1`** → `us-east-1`, used **only** for the ACM certificate.

CloudFront can attach ACM certificates **only from us-east-1**, regardless of
where the rest of the stack runs. That single constraint is the entire reason
the aliased provider exists. Everything else stays in `ca-central-1` for data
residency (Quebec **Law 25**).

## Apply order

Terraform resolves ordering from the dependency graph, so a single
`terraform apply` is enough. Notes:

1. Without a custom domain (`domain_name = ""`, the default), no ACM/Route53
   resources are created and CloudFront uses the default `*.cloudfront.net`
   certificate.
2. With a custom domain set, the ACM certificate + Route53 validation records
   are created first, `aws_acm_certificate_validation` blocks until the cert is
   issued, and only then does CloudFront attach it. DNS propagation can make the
   first apply take several minutes.
3. This stack provisions infrastructure only — it does **not** upload the SPA
   build. After apply, sync `apps/web/dist/` into the bucket and invalidate the
   CloudFront cache as a separate deploy step.

```bash
terraform init
terraform apply
# then, separately:
# aws s3 sync ../apps/web/dist s3://<web_bucket_name> --delete
# aws cloudfront create-invalidation --distribution-id <id> --paths '/*'
```

### Lambda packaging caveat

The Lambda code is zipped straight from `apps/api` by the `archive_file` data
source. If `apps/api/node_modules` is present it is included as-is. For a real
build, run `npm ci --omit=dev` inside `apps/api` (and vendor the workspace-linked
`@nota/domain` package) **before** `terraform apply` so only production
dependencies are packaged.

## Validation

```bash
terraform init -backend=false && terraform validate
terraform fmt -recursive
```

## Future additions (not built yet)

- **SES** for transactional email (continue-prompt #5).
- **Presigned-URL S3 upload bucket(s)** for user uploads (#2).
