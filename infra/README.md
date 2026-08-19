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

## Cost notes

This stack is serverless and pay-per-use by design — on-demand DynamoDB,
on-demand Lambda, `PriceClass_100` CloudFront, S3 noncurrent-version expiry, and
DynamoDB TTL all keep idle cost near zero. Two cost levers worth knowing:

- **Lambda log retention (`logs.tf`).** Lambda auto-creates its
  `/aws/lambda/<fn>` log group with retention *Never expire*, so logs pile up
  forever. `logs.tf` declares each Lambda's log group explicitly with
  `retention_in_days = var.log_retention_days` (14 by default), capping log
  storage. If the stack is already deployed, `terraform import` the existing
  groups once before the next apply (import commands are in `logs.tf`).
- **Daily reminder enumeration — sparse GSI1, no Scan.** The reminder scheduler
  used to `Scan` the whole `nota-main` table daily to find open bids (billing a
  read for *every* item each run, growing with table size). It now Queries a
  **sparse GSI1** instead: open (not-retained) bids carry `GSI1PK = "OPENBID"`
  (see `apps/api/src/keys.js`); a retained bid omits the attribute and drops out
  of the index. Daily read cost is now proportional to the number of *open*
  bids, not the whole table. The reminder Lambda role no longer holds
  `dynamodb:Scan`.

  **Rollout (order matters — do NOT deploy the code before the index exists):**

  1. `terraform apply` — adds GSI1 to the live table (an online index build; the
     table stays available while it backfills its own structure).
  2. Deploy the new API/reminders Lambda code (normal `deploy.yml` on merge to
     `main`). From here every bid write stamps the GSI1 attributes.
  3. Backfill the pre-existing open bids **once** so the daily Query sees the
     backlog, not just newly-written bids (run with an operator/deploy
     credential — the reminder role has no `Scan`):

     ```bash
     # dry run first (writes nothing):
     DRY_RUN=1 TABLE_NAME=nota-main AWS_REGION=ca-central-1 \
       node apps/api/scripts/backfill-open-bid-gsi.js
     # then for real:
     TABLE_NAME=nota-main AWS_REGION=ca-central-1 \
       node apps/api/scripts/backfill-open-bid-gsi.js
     ```

  Reminders are best-effort and idempotent (a `SENT#` ledger prevents duplicates),
  so a brief gap before the backfill only risks a delayed nudge, never a double
  send. If volume ever approaches a single GSI partition's write ceiling, shard
  `OPENBID` by month and fan the daily read across the shards (noted in `keys.js`).

## Future additions (not built yet)

- **SES** for transactional email (continue-prompt #5).
- **Presigned-URL S3 upload bucket(s)** for user uploads (#2).
