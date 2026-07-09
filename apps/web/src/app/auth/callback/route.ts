import { NextResponse, type NextRequest } from "next/server";

import { resolveCallbackRedirect } from "@/lib/auth/callback-routing";
import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * OAuth callback Route Handler (D18 / APP-FEATURES-V2 §1.3) — the single,
 * one-and-only OAuth server touchpoint. The "Continue with Google"
 * button sends the provider here with `?code=…&next=…`; this handler runs the
 * PKCE `exchangeCodeForSession(code)` against a request-bound Supabase client
 * (so the session cookie is written on the response), then redirects.
 *
 * This is a Next.js SSR cookie-handling route on apps/web, NOT a Worker/API
 * auth route — it does not violate D8's "no Worker auth route": the Worker still
 * never brokers login. The membership fork (existing company → /inbox; no
 * company → onboarding) is NOT done here — after the cookie lands, the app's
 * CompanyProvider routes a zero-membership user to /onboarding. We never
 * auto-create a company from an OAuth login (D18).
 *
 * No `export const runtime = 'edge'` — the OpenNext adapter runs the Node
 * runtime (D1), and route handlers must not opt into edge.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const providerError =
    searchParams.get("error") ?? searchParams.get("error_description");

  let exchangeOk = false;
  if (code && !providerError) {
    // createServerClient bound to the (writable, in a Route Handler) cookie
    // store — exchangeCodeForSession sets the Supabase session cookies via the
    // `setAll` adapter in lib/supabase/server.ts.
    const supabase = await getSupabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    exchangeOk = !error;
  }

  const redirectPath = resolveCallbackRedirect({
    code,
    next,
    providerError,
    exchangeOk,
  });

  // `redirectPath` is a same-origin relative path (safeNextPath / the fixed
  // error path), so resolving it against `origin` can never leave the site.
  return NextResponse.redirect(new URL(redirectPath, origin));
}
