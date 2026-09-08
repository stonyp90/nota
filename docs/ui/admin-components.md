# Admin UI components

The console is dependency-free vanilla JavaScript. Components are private functions in `apps/admin/public/admin.js`, styled in `apps/admin/public/admin.css` with shared tokens from `tokens.css`.

## Adding or updating a section

1. Add one entry to `ADMIN_SECTIONS`: key, French label, icon factory, render function, and optional permission predicate. The router, searchable navigation, and active state use this registry. Keep authorization in the API as well.
2. Build the heading with `buildPageHeader(eyebrow, title, description)`. Append optional controls to the returned element. Mount through `mountAuthed` and call `focusTitle`.
3. Use `buildLoadingGrid(count)` during loads, `buildErrorBanner(retry)` for recoverable failures, and `buildDenied(permissionLabel)` for restricted content. Never turn missing data into zero values.
4. Reuse `field`, `input`, `btn`, `tpl-actions`, and `chart-card` for editors. Preserve the existing endpoint-specific validation and confirmation flows. Saving must retain entered values on failure and show the server result on success.
5. Add French and English dictionary entries and interaction tests for the affected behavior. Run `npm run test:admin` and `npm run build:admin`.

The public application remains separately deployed; these components currently serve the admin console. Do not load admin code into the public application or introduce a runtime dependency to share visual styles.
