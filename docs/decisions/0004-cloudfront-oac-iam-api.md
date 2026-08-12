# 4. Front the IAM-authed Lambda function URL with CloudFront OAC

- Status: Accepted
- Date: 2026-08-12

## Context

The Nota API is a single Lambda exposed through a **Lambda function URL**. The
SPA and the API are served **same-origin** through one CloudFront distribution
(default behavior → S3 SPA, `/api/*` → the Lambda), so the browser needs no
CORS.

A Lambda function URL can use `authorization_type = "NONE"` (public) or
`"AWS_IAM"` (callers must sign requests with SigV4). A public URL is simpler —
CloudFront can forward to it with no signing — but it means the function is
reachable by anyone who discovers the `*.lambda-url.<region>.on.aws` hostname,
bypassing CloudFront entirely (and any WAF, logging, or caching attached there).
It is also commonly **blocked by organization SCPs** that forbid public function
URLs outright.

## Decision

Keep the function URL **`AuthType = AWS_IAM`** and put **CloudFront Origin Access
Control (OAC)** in front of it. The OAC signs every CloudFront→Lambda origin
request with **SigV4** (`origin_access_control_origin_type = "lambda"`,
`signing_behavior = "always"`, `signing_protocol = "sigv4"`), and a scoped
`aws_lambda_permission` (`lambda:InvokeFunctionUrl`, principal
`cloudfront.amazonaws.com`, `source_arn` = this distribution,
`function_url_auth_type = "AWS_IAM"`) allows **only this distribution** to invoke
it.

The `/api/*` behavior uses the managed **AllViewerExceptHostHeader** origin
request policy, because Lambda function URLs reject a mismatched `Host` header.

## Consequences

- **Positive:** the raw function URL is not usable by anyone but CloudFront —
  the API is reachable only through the distribution, so WAF, logging and TLS
  policy all apply on the real path; the design is compatible with SCPs that ban
  public function URLs; access control is delegated cleanly to IAM/OAC rather
  than reimplemented in application code.
- **Negative / trade-offs:** slightly more configuration than a public URL (an
  OAC resource, an IAM-scoped invoke permission, and the Host-header origin
  policy); calling the API directly for debugging requires SigV4-signed requests
  (`terraform output lambda_function_url` exposes it, but it will 403 unsigned);
  the OAC-for-Lambda feature must be supported by the AWS provider version in use.
- **Related:** the SPA side uses the same OAC pattern for the private S3 bucket,
  where a missing key returns `403` (not `404`) and is rewritten to
  `/index.html` for client-side routing.
