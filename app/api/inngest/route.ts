/**
 * Inngest serve endpoint.
 *
 * Design §3.1 (Generator_Service) hosts every Inngest function behind a
 * single `/api/inngest` route. The dev CLI (`npx inngest-cli@latest dev -u
 * http://localhost:3000/api/inngest`) discovers this URL and the production
 * Inngest cloud reaches it the same way.
 *
 * The handler verifies signed requests using `INNGEST_SIGNING_KEY` (Req 6.1
 * applies to Stripe; Inngest enforces its own signing key here). We read the
 * key from `process.env` directly rather than `getServerEnv()` so the route
 * compiles and `next build` succeeds before env is wired — Inngest treats an
 * undefined signing key as "dev mode without verification", which is exactly
 * what we want during the hackathon-local loop.
 */
import { serve } from "inngest/next";

import { inngest, inngestFunctions } from "@/lib/inngest";
// Side-effect import: the module pushes its function into `inngestFunctions`
// at load time so this route stays generic. New pipeline functions are added
// the same way as Tasks 13–21 land.
import "@/inngest/functions/generateLullaby";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
