# Full local release — 2026-09-08

The owner explicitly requested deployment of all local project changes, extending
the earlier introduction-only release at `3da82c3`. This includes payment recovery,
calendar subscriptions and Outlook authorization foundations, referral UX, tests,
and the existing audit reports. Earlier reports describing exclusions are historical.

## Pre-deployment verification

- Domain: 364 tests passed; API: 1,532; web: 785; admin: 221.
- API contracts: 25 passed.
- BDD: 186 scenarios and 1,069 steps passed.
- Chromium: all 51 journeys passed with fresh isolated test servers.
- Public and admin builds passed; Terraform format/validation and diff checks passed.
- Live introduction checks: English notary film has five scenes without overflow
  at 320×568, 768×1024 and 1440×900; headings measure 32, 41 and 72 px respectively.
  French client body text measures 18 px at 320×568; pause freezes animated icons.

## Known production boundary

Before this release, `/api/coverage?prefixe=G1R&deplacement=client_10` still returned
503. The repository already contains the `NotaryCoverageIndex` IAM correction in
`infra/lambda.tf`, but application delivery workflows do not apply Terraform.
Local AWS credentials are expired/invalid and the `aws-prod` SSO session is absent;
the owner was asked to reconnect while application delivery proceeds through OIDC.

Outlook authorization is disabled unless its Microsoft application and encryption
configuration are supplied. It is a connection foundation, not a two-way event
synchronization worker. Existing calendar subscriptions remain read-only ICS feeds.
No live financial transaction or new external calendar account authorization is
performed by this release verification. Automated provider tests use fixtures.

Public and admin release workflows must both succeed for the resulting commit;
post-deployment checks must compare the built assets with the served bytes and
verify public health, calendar links, admin authentication and the coverage endpoint.
