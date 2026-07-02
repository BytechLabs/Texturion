import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { publicEnv } from "@/env";

let client: SupabaseClient | undefined;

/**
 * Browser Supabase client (@supabase/ssr cookie sessions — SPEC §10). One
 * instance per tab: auth state, realtime socket, and token refresh share it.
 */
export function getSupabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  return client;
}

/** Current Supabase access token, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await getSupabaseBrowser().auth.getSession();
  return data.session?.access_token ?? null;
}
