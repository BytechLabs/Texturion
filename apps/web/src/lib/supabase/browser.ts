import { createBrowserClient, type CookieOptions } from "@supabase/ssr";
import {
  isAuthRetryableFetchError,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { publicEnv } from "@/env";
import { SUPABASE_COOKIE_OPTIONS } from "./cookie-options";

let client: SupabaseClient | undefined;


/**
 * Browser Supabase client (@supabase/ssr cookie sessions — SPEC §10). One
 * instance per tab: auth state, realtime socket, and token refresh share it.
 */
export function getSupabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { cookieOptions: SUPABASE_COOKIE_OPTIONS },
  );
  return client;
}

/**
 * Current Supabase access token, or null when signed out.
 *
 * Throws getSession()'s error when a token refresh was lost to the network or
 * a 5xx: auth-js keeps the session in storage then, so the caller should retry
 * rather than treat the person as signed out.
 */
export async function getAccessToken(): Promise<string | null> {
  const { data, error } = await getSupabaseBrowser().auth.getSession();
  if (!data.session && error && isAuthRetryableFetchError(error)) throw error;
  return data.session?.access_token ?? null;
}
