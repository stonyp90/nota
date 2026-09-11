# E2E tests (Playwright)

Fast browser tests over the critical Nota journeys, meant to gate a push to
live. The whole suite runs in a single headless Chromium in well under a minute.

## Run it

```bash
# once per machine — download the Chromium build Playwright drives
npx playwright install chromium

# run the suite (boots the demo API + web servers automatically)
npm run test:e2e
```

That's it. `npm run test:e2e` (→ `playwright test`) boots **both** demo servers
itself via the config's `webServer`, waits for them, runs the specs, and — on a
fresh boot — shuts them down afterwards. No manual server juggling.

Useful variants:

```bash
npx playwright test e2e/client-booking.spec.js   # one spec
npx playwright test --headed                      # watch it in a browser
npx playwright test --ui                          # the interactive runner
npx playwright show-report                         # open the last HTML report (CI mode)
```

## What it covers

| Spec | Journey |
| --- | --- |
| `home-numbers.spec.js` | Home pricing: refinancement floor **$2,000** / financement **$1,800**, no visible price ≥ $10,000 (the "$18,000" regression), every shown median ≥ its floor. |
| `client-booking.spec.js` | The headline journey — pass the onboarding gate as a client, book the **Financing** act, answer the notary's required questions, publish a valid offer, land on the confirmation. |
| `notary-signin.spec.js` | Passwordless notary sign-in, both ways: the gate form (dev-echoed token redeemed in place) and booting the emailed magic link (`#nauth=<token>`). Asserts the console renders the open agenda. |
| `partner-claim.spec.js` | A referral partner claims a code and gets the shareable `?ref=CODE` link. |
| `language-preferences.spec.js` | Browser language defaults, desktop/mobile menu choice, API language propagation, blocked storage, invalid URL overrides, and authenticated email preference updates. |
| `no-console-errors.spec.js` | Home + booking load with no severe console errors, no uncaught page errors, and no failed / 5xx same-origin requests. |
| `every-surface.spec.js` | **Every surface at every size, on every engine.** One test per surface (31: public doors, booking steps, dialogs, drawer, notary console, support chat, signing room, admin views, pitch deck, business plan, brand guide). Chromium walks 320/390/768/1024/1280/1440/1920; firefox, webkit, iPhone 13, Pixel 7 and iPad measure at their own size. The lens (`layout-lens.js`) reports sideways scroll, blank bands, overlaps, touch targets under 44 px, truncated headings, page errors and headings off the display face — every offending viewport in one message. |
| `menu-accessibility.spec.js` | Header controls reachable at 900/1024/1280; the phone drawer keeps its history buttons aligned, its two preference controls (language, theme) and no orphan dropdown, traps focus, closes on Escape and hands focus back to the burger. |
| `responsive-layout.spec.js` | Shape assertions at seven sizes for the three public doors, the partners pane and the contact dialog. |

## How the servers are wired

The config (`../playwright.config.js`) starts four servers on fixed, overridable
ports:

- **API** — `e2e/servers/api-server.js` on `:8811` (override `E2E_API_PORT`).
  A thin, test-only wrapper around the same in-memory demo stack that
  `apps/api/local-server.js` boots, with the notary-login / partner-claim rate
  limits raised (the whole suite shares one client IP, so the production 5/15min
  throttle would otherwise 429 a legitimate run). It runs with `NODE_ENV=test`
  and `NOTA_DEMO_OPEN=true`, so the API is enumeration-safe **and** echoes the
  magic-link challenge token (`devToken` / `devLink`) — the notary and partner
  link flows complete with no mailbox.
- **Web** — `apps/web/run-local.mjs` on `:4311` (override `E2E_WEB_PORT`), served
  with `NOTA_API_BASE` pointed at the API above. `baseURL` is this server.
- **Admin** — `apps/admin/run-local.mjs` on `:4312` (override `E2E_ADMIN_PORT`),
  pointed at the API above (which routes `/admin/*` to the local admin app).
- **Docs** — `e2e/servers/docs-server.js` on `:4313` (override `E2E_DOCS_PORT`)
  serves `docs/` as the deploy ships it, so the pitch deck and the business plan
  are measured like any other page.

The ports are deliberately off the usual dev ports (8788 / 4173) so a running
`npm run dev` never collides with a test run.

`reuseExistingServer` is `true` locally (instant iteration — an already-running
pair on those ports is reused) and `false` on CI (`CI=1`), which always boots a
clean pair. If a **stale** server is already listening on `:8811` / `:4311`
locally, a local run will reuse it; kill it first (`lsof -ti tcp:8811 | xargs
kill`) if you hit odd, stale-data failures.

## Notes for authors

- Specs pin English via `?lang=en` (the app defaults to French) so text
  assertions read one dictionary; see `helpers.js`.
- Fixtures are randomized per server boot, so specs assert **invariants**
  (floors, ceilings, "median ≥ floor") — never exact medians.
- The demo repo is in-memory and long-lived across a local run, so anything that
  writes uses a **unique** value per run (the partner code is time-based) to stay
  clear of idempotency / 409 paths.
