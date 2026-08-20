/**
 * Local dev entry for the admin console. Serves public/ with SPA fallback and
 * proxies /api/* same-origin to the local admin API (admin-local-server.js in
 * apps/api, port 8790 by default — override with NOTA_ADMIN_API). Run both and
 * the full magic-link flow works end-to-end with no AWS and no mailbox:
 *
 *   npm run admin:local   # the admin API  (:8790, devEcho magic links)
 *   npm run dev:admin     # this server    (:4174)
 */
import { createDevServer } from './dev-server.mjs';

const PORT = Number(process.env.PORT || 4174);
const API_ORIGIN = process.env.NOTA_ADMIN_API || 'http://localhost:8790';

createDevServer({ apiOrigin: API_ORIGIN }).listen(PORT, () => {
  console.log(`Nota admin on http://localhost:${PORT}  (API proxy -> ${API_ORIGIN})`);
});
