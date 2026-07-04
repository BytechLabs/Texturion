import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { decideAuthRedirect } from "@/lib/auth/redirects";
import { decideHostRedirect } from "@/lib/hosts";

/**
 * Session-refreshing auth middleware (SPEC §10, G12): enforces the
 * marketing/app host split first (D27 — app paths live on the app origin,
 * marketing paths on the site origin; active only when NEXT_PUBLIC_APP_ORIGIN
 * is set), then protects the (app) and /onboarding routes, bounces signed-in
 * users off the auth pages, and keeps the Supabase cookie session fresh on
 * every matched request.
 *
 * Default (edge) middleware runtime on purpose — the OpenNext adapter does
 * not support Next 15.2+ Node middleware (SPEC §3).
 */
export async function middleware(request: NextRequest) {
  // Host split BEFORE any auth work: a cross-host hop needs no session read.
  // 308: the mapping is architectural and stable (and safe — these are GET
  // navigations; the app itself never POSTs cross-surface).
  const hostRedirect = decideHostRedirect({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    appOrigin: process.env.NEXT_PUBLIC_APP_ORIGIN || undefined,
  });
  if (hostRedirect) {
    return NextResponse.redirect(hostRedirect, 308);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() validates the JWT against Supabase (and refreshes the session
  // cookie via setAll above) — never trust getSession() alone in middleware.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const redirect = decideAuthRedirect(request.nextUrl.pathname, user !== null);
  if (redirect) {
    const url = request.nextUrl.clone();
    url.pathname = redirect.pathname;
    url.search = redirect.search;
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Skip static assets and files; run everywhere a session decision matters.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
