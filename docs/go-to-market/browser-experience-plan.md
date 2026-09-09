# Browser, device and arrival-source experience

September 9, 2026. Extends the [conversion strategy](behavior-conversion-strategy.md).
Implementation is local; production collection and real-device testing are not
yet verified. The existing weekday 09:00 America/Toronto review includes this plan.

## Signals and their limits

The public app and four static service pages load the same dependency-free
`analytics.js`. It reports a named event and bounded context to `/events`.
The server infers browser, OS and device families from the User-Agent header;
desktop-mode iPads can supply a coarse tablet hint. The domain allowlists every
persisted category. No raw UA, precise version, phone model, full URL, search
query, field value, error text, user/session ID or joined device fingerprint is
stored in these analytics counters. Operational security/rate-limit records
remain separate. The telemetry POST omits credentials and the Referer header.

| Breakdown | Available observations | Interpretation |
| --- | --- | --- |
| Browser | Chrome, Safari, Firefox, Edge, Samsung Internet, Opera, in-app, declared bot, other/unknown | Approximate family from UA; spoofable, not a feature gate |
| OS / device | iOS/iPadOS, Android, Windows, macOS, Linux; phone/tablet/desktop/unknown | Tablet inference is approximate; viewport is recorded separately |
| Viewport | Under 600 CSS px, 600–1023, 1024+ | Window width at the event, not physical screen resolution |
| Language | French, English, other/unknown | Active document language at the event |
| Source | Google, Bing, other search, Facebook, Instagram, LinkedIn, TikTok, AI assistants, email, declared referral, other campaign/site, internal, direct/unknown | Coarse declared campaign or referring-host category; not verified paid attribution |
| Entry | Marketplace, financing page, refinancing page, other | Service-page category carried to the app through a bounded link parameter |
| Capabilities | Native dialog availability; readable browser storage | Helps identify fallback requirements; does not prove every feature works |
| Initial load | Under 2 s, 2–4 s, over 4 s, unmeasured | Navigation Timing `loadEventEnd - startTime`, not LCP, INP or a Core Web Vitals score |

The source is determined from recognized UTM source/medium, a declared referral
code, an allowlisted forwarded category, then the referring host. Unknown UTM
sources become “other campaign”; raw campaign names are discarded. Host matching
uses domain boundaries, so `google.com.attacker.test` is not Google. An absent
referrer is **direct or unknown**, since privacy settings and apps can suppress
it. Google paid and organic traffic currently share one source bucket; do not
infer paid-media ROI. No IP geolocation is added.

Service-page links forward `nota_source` and `nota_entry`, with no storage or
visitor identifier. Language/service links retain context too; only links to the
marketplace count as `page_service_vers_carnet`. The main app attaches the bounded
context to publication and notary-signup requests. The API counts the outcome on
the authoritative route and does not store this context on the customer record.
Leaving for checkout and returning without source parameters does not preserve
first-touch attribution; no cross-session or cross-device attribution is claimed.

Each segment is a separate daily counter family, not a browser × OS × source
profile. Admin shows attributed counts with their API-provided FR/EN labels.
Older events have no new segments; missing coverage must not be silently treated
as direct traffic, zero errors, or an excluded browser. Declared bots are only a
diagnostic category; other bots, staff traffic and automation can remain mixed.
Shared-IP throttling can also omit events, especially behind shared networks;
inspect collector failures and HTTP 429s before interpreting segment differences.

## Events for diagnosis

- `page_service_vue`: each static service-page load.
- `page_service_vers_carnet`: a marketplace-link click; not necessarily a completed navigation.
- `visite`: app boot reached its existing completion point. An early boot failure
  may produce an error without this event, so error events / visits is not always
  a valid error rate.
- `erreur_script` and `promesse_rejetee`: at most one of each per page instance;
  no exception contents are collected. Resource failures without a window error,
  disabled JavaScript and a failed collector can remain invisible.
- `navigation_mesuree`: once after load when Navigation Timing is available.
  Missing timing is not a fast load. Use this event's load buckets for performance
  distributions; earlier form/visit events may have `load=unknown`.
- Existing screen-reach, blocked progress and failed-submission events diagnose
  friction. `publication_echouee` includes local validation and API refusals;
  it is not an HTTP error rate. `publie` remains a server-confirmed publication.

## Compatibility checks

The new Playwright compatibility suite runs alongside the existing Chromium
suite in CI; CI installs Chromium, Firefox and WebKit. It exercises FR/EN
booking, required-question feedback, price/contact progression, publication,
window/dialog overflow and source propagation from a service page.

| Configuration | Automated verification |
| --- | --- |
| Desktop Chromium | Passed |
| Desktop Firefox | Passed |
| Desktop WebKit | Passed |
| iPhone 13 / WebKit emulation | Passed |
| Pixel 7 / Chromium Android emulation | Passed |
| iPad / WebKit emulation | Passed |

September 9 local run: **18/18 passed** with the real local HTTP handler and
in-memory test data. This does not verify production, real payments, mail
delivery or actual mobile hardware. WebKit is not the shipping Safari binary,
and device emulation is not a physical iPhone/Android test. See
[Playwright browsers](https://playwright.dev/docs/browsers) and
[device emulation](https://playwright.dev/docs/emulation).

Before claiming device support, also record physical-device observations when
devices are available: iOS Safari, Android Chrome, Samsung Internet, and embedded
Instagram/Facebook browsers. Include actual OS/browser version, device, date,
revision, tested paths and failures in a technical QA report, without tying those
details to customer identities. Prioritize devices observed in real traffic.

Check the soft keyboard, autofocus and error focus, zoom, rotation, safe areas,
touch targets, reduced motion, slower networks, storage restrictions, stale PWA
cache, file selection/upload, magic-link login, payment redirects and return to
the application. Treat unavailable hardware/provider access as pending evidence.

Use feature detection for runtime fallbacks and responsive CSS for layout;
never block or degrade a customer simply because a UA looks unfamiliar. UA
reduction makes version/model inference unreliable; see
[MDN user-agent reduction](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/User-agent_reduction).

## Recurring prioritization

1. Verify production revision, actual collection and clean-data coverage.
2. Review segments over the same complete business-date windows. Show counts
   beside any descriptive ratio. Do not call independent totals unique users or
   an attribution/cohort model, and do not sum different dimensions as traffic.
3. Reproduce high-impact errors or blocked journeys in the matching engine and
   viewport, then on available physical hardware. Test first-visit and returning
   flows, not only already-onboarded sessions.
4. Fix the smallest demonstrated cause; keep pricing/validation transparent.
   Add a regression check and record evidence, release status and rollback.
5. After rollout, compare the same definitions and quality guardrails. Small
   samples, missing referrers and channel/supply changes can explain differences;
   do not claim causality or uplift from a passing compatibility test.

Initial triage already improved test correctness: mobile booking uses the
visible primary CTA rather than a desktop-only shortcut; source tests use the
marketplace CTA rather than the language switch. The implementation also fixes
the local API override on generated service pages, preserves source through
the header home link, and avoids counting a language switch as a marketplace
conversion.
