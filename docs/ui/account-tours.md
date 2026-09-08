# Account welcome tours

The account tutorial complements the existing public introduction. It uses one dependency-free renderer in `apps/web/public/app.js` and role-specific `ACCOUNT_TOURS` definitions.

## Plan and implementation

- Customer: offers, contact details, notifications, required documents, conversation with the retained notary.
- Notary: practice profile, calendar, open requests, retained files, payment setup.
- Launch after customer signup/account recovery or successful notary authentication and data loading. Unapproved notaries keep the existing pending-registration screen.
- Keep each step short and contextual. Scroll to and outline its actual section. A native dialog provides focus containment, Back/Next, Skip, Escape, and completion.
- Preserve form data and restore any collapsed section temporarily opened by the tour. Never accept requests, send messages, upload documents or change payment settings during a tour.
- Remember completion/skip per role and account on the current browser using existing storage fallback helpers. This is not server-synced onboarding state.
- Provide a replay button in each account. Use subtle transitions, disabled under reduced-motion preferences.

## Updating the tutorial

Change the selector, French title and description in `ACCOUNT_TOURS`. Add matching English entries in `i18n.js`. Keep stable section IDs and test the first-signup trigger, all role destinations, previous/next, skip, Escape, completion and replay in `auth-onboarding.test.mjs`.
