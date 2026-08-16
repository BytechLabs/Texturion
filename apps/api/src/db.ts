import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "./env";

/**
 * One client per isolate: `getEnv` memoizes the validated Env per bindings
 * object, so keying on it gives exactly one client per Worker isolate.
 */
const clients = new WeakMap<Env, SupabaseClient>();

/**
 * How long a single database call may take before it is abandoned.
 *
 * Not a latency budget — see the note at the call site. The other outbound
 * calls in this API use the same 10 s.
 */
export const DB_TIMEOUT_MS = 10_000;

/**
 * The signal a database request runs under: our deadline, plus whatever the
 * caller already had.
 *
 * Extracted so it can be tested with a millisecond deadline instead of a
 * ten-second one. `AbortSignal.timeout` is native and vitest's fake timers do
 * not drive it, so the alternative was a test that waited ten seconds or an
 * assertion that never fired.
 *
 * The caller's signal is KEPT rather than replaced. Supabase passes one for
 * `.abortSignal()`, and writing `signal:` over the init object would silently
 * un-cancel a request the caller had already given up on.
 */
export function dbRequestSignal(
  existing: AbortSignal | null | undefined,
  timeoutMs: number = DB_TIMEOUT_MS,
): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return existing ? AbortSignal.any([existing, deadline]) : deadline;
}

/**
 * Supabase client for the Worker (SPEC §3, §10): talks to Supabase over HTTP
 * (PostgREST) with the `sb_secret_` key — zero Postgres connections consumed.
 * No session persistence or token refresh (there is no user session on the
 * server; the secret key is the credential), and `fetch` is resolved from the
 * runtime at call time, which is the Workers-safe transport (no Node sockets).
 */
export function getDb(env: Env): SupabaseClient {
  const cached = clients.get(env);
  if (cached) return cached;

  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => {
        /*
         * #251 — a DEADLINE, so a stalled pooler fails instead of hanging.
         *
         * Every outbound call this API makes is bounded by an
         * `AbortSignal.timeout` — Telnyx, Stripe's webhooks, PostHog,
         * Nominatim, the probes. The database was the exception, and it is the
         * one dependency on the hot path of every single request: without a
         * deadline of its own, a request that reaches a pooler which stalls
         * rather than refusing waits until something further out gives up.
         *
         * #251's third acceptance criterion is that crossing a ceiling
         * "produces a truthful failure rather than a hang". That is a property
         * of this line, not of a load test, which is why it can be fixed
         * before the ceiling itself is ever measured.
         *
         * TEN SECONDS, and the size is the argument. `docs/CAPACITY.md` §1
         * measured the hot queries on a seeded 50,000-conversation workspace:
         * 0.9 ms for the inbox list, under 1 ms for a thread, 39 ms for
         * `api_for_you`, 159 ms for the whole of `api_search`, and 282 ms for
         * the worst end-to-end figure before the index work landed. Ten
         * seconds is roughly thirty-five times the worst legitimate case, so
         * this cannot fire on a slow query — which is the failure that would
         * matter, because turning a working page into an error to prevent a
         * hang nobody has hit is the worse trade. It is a hang-breaker, not a
         * latency budget, and it matches the 10 s the other vendor calls use.
         *
         * The caller's own signal is PRESERVED rather than replaced. Supabase
         * passes one for `.abortSignal()`, and clobbering it would silently
         * un-cancel a request the caller had already given up on.
         */
        return globalThis.fetch(input, {
          ...init,
          signal: dbRequestSignal(init?.signal),
        });
      },
    },
  });
  clients.set(env, client);
  return client;
}
