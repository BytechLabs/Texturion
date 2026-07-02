import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Env } from "./env";

/**
 * One client per isolate: `getEnv` memoizes the validated Env per bindings
 * object, so keying on it gives exactly one client per Worker isolate.
 */
const clients = new WeakMap<Env, SupabaseClient>();

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
      fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
    },
  });
  clients.set(env, client);
  return client;
}
