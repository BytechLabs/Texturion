import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  decideAuthRedirect,
  hasSupabaseSessionCookie,
  isTransientAuthBlip,
} from "@/lib/auth/redirects";
import { decideBlogRoute, decideHostRedirect } from "@/lib/hosts";
import { SUPABASE_COOKIE_OPTIONS } from "@/lib/supabase/cookie-options";

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
  // Blog subdomain FIRST (#130): blog.loonext.com serves blog content at its
  // root via an internal rewrite (the URL stays on the subdomain) and bounces
  // every non-blog path — the marketing chrome's root-relative links — to the
  // canonical site. Only active when NEXT_PUBLIC_BLOG_ORIGIN is set.
  const blogRoute = decideBlogRoute({
    host: request.headers.get("host"),
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    blogOrigin: process.env.NEXT_PUBLIC_BLOG_ORIGIN || undefined,
  });
  if (blogRoute?.kind === "rewrite") {
    const url = request.nextUrl.clone();
    url.pathname = blogRoute.pathname;
    return NextResponse.rewrite(url);
  }
  if (blogRoute?.kind === "redirect") {
    return NextResponse.redirect(blogRoute.url, 308);
  }

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
      // The THIRD writer of this cookie, and the one that writes it most often:
      // `getUser()` below is normally the first thing to notice an expired access
      // token, so this rewrites the session about once an hour. `Secure` is not
      // part of a cookie's identity, so omitting it here REPLACED the secure
      // cookie the browser and server clients set — which made securing those two
      // alone no fix at all, just a flag that was absent for most of the cookie's
      // life. The value is the serialized session, refresh token included.
      cookieOptions: SUPABASE_COOKIE_OPTIONS,
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
  // It can fail TRANSIENTLY at the edge (a network/Supabase hiccup or cold
  // isolate) — returning an error, or throwing — which must NOT be read as
  // "signed out".
  let user: Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"] =
    null;
  let getUserErrored = false;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    getUserErrored = result.error !== null;
  } catch {
    getUserErrored = true;
  }

  const redirect = decideAuthRedirect(request.nextUrl.pathname, user !== null);
  if (redirect) {
    // Suppress an intermittent protected-path → /login bounce when getUser()
    // only blipped while a session cookie is present: honoring it hard-reloads
    // the client-side navigation (the "Loading your workspace…" full refresh)
    // and then bounces back. Real auth is enforced downstream, so this fails
    // OPEN safely; a genuinely missing session still redirects.
    const cookieNames = request.cookies.getAll().map((c) => c.name);
    const blip = isTransientAuthBlip(
      redirect,
      getUserErrored,
      hasSupabaseSessionCookie(cookieNames),
    );
    if (!blip) {
      const url = request.nextUrl.clone();
      url.pathname = redirect.pathname;
      url.search = redirect.search;
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Skip static assets and files; run everywhere a session decision matters.
  // /rss.xml is the one dotted path that NEEDS middleware: the blog host
  // rewrites it to /blog/rss.xml (#130) — the dotted-file exclusion above
  // would otherwise skip it and 404 the feed on blog.loonext.com.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)", "/rss.xml"],
};
