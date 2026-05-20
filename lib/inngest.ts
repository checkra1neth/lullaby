/**
 * Inngest client + registered functions.
 *
 * Design §3.1 (Generator_Service) and §6 (Trigger choice — Inngest) make
 * Inngest the single async runtime for the lullaby pipeline. This module
 * exposes the shared `Inngest` client (`id: "lullaby"`) and the array of
 * functions handed to the `serve()` adapter in `app/api/inngest/route.ts`.
 *
 * The client constructor itself doesn't require env vars at module load:
 * Inngest reads `INNGEST_EVENT_KEY` from `process.env` automatically when a
 * call to `inngest.send(...)` happens, and the dev server runs without keys.
 * That keeps `next build` and `tsc --noEmit` green even before env is set.
 *
 * Functions are registered by appending to `inngestFunctions` so later tasks
 * (e.g. task 7's stub `generateLullaby`) can wire themselves in without
 * reaching back into the route handler.
 */
import { Inngest, type InngestFunction } from "inngest";

export const inngest = new Inngest({
  id: "lullaby",
});

/**
 * Functions registered with the Inngest serve handler. Initially empty;
 * downstream tasks push their `inngest.createFunction(...)` results here.
 */
export const inngestFunctions: InngestFunction.Like[] = [];
