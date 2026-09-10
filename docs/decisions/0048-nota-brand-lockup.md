# Nota Québec brand lockup

Status: accepted for production · 2026-09-09

The supplied reference is the production direction: a deep blue-teal square with a white N, a small blue signal dot, a dark `Nota` wordmark, and a pale `QUÉBEC` badge. The same direction is used in the public carnet, admin console, signing room, email shell, PWA metadata, favicons, Open Graph image, business plan and pitch deck.

## Tokens

- Mark square: `#264961`
- Signal dot: `#407598`
- Primary action blue-teal: `#386888`
- Hover/deep blue: `#274A62`
- Wordmark ink: `#101B26`
- Québec badge: `#EBF1F5` with `#274A62` text

## Alternatives reviewed

1. The selected lockup: strongest Québec signal, legible at favicon size, and closest to the supplied reference.
2. A wordmark-only treatment: cleaner in long-form documents, but loses recognition in browser chrome, email clients and small app surfaces.
3. A rounded green/hunter treatment: distinct, but inconsistent with the requested reference and less aligned with the institutional blue-teal application UI.
4. A text-only `CARNET PUBLIC · QUÉBEC` label: useful as supporting copy, but too long to function as the primary lockup.

The selected direction wins because it preserves the recognizable N at small sizes, gives Québec a compact secondary badge, and keeps action color separate from the mark square. No alternative is used in production; the comparison is retained here for future review.

## Rollout contract

The web and admin token ramps are kept in lockstep. Email uses a flattened copy of the web light tokens and is checked by `emails-brand.test.mjs`. Raster assets are generated from the current SVG sources. The pitch deck and business plan use the same token values. New surfaces must consume the shared tokens or explicitly document an external partner brand; they must not reintroduce the retired green/cobalt palette.
