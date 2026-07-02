import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { publicEnv } from "@/env";

/**
 * Server Supabase client for Server Components and Route Handlers
 * (@supabase/ssr cookie sessions — SPEC §10). Middleware builds its own
 * client against the NextRequest/NextResponse cookie pair instead.
 */
export async function getSupabaseServer(): Promise<SupabaseClient> {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component: cookies are read-only there.
            // Middleware refreshes the session, so this is safe to swallow.
          }
        },
      },
    },
  );
}
