import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getSupabaseServer } from "@/lib/supabase/server";

const INVITE_PATH = /^\/invite\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { origin, searchParams } = request.nextUrl;
  const type = searchParams.get("type");
  const tokenHash = searchParams.get("token_hash");
  const next = URL.parse(searchParams.get("next") ?? "", origin);
  const destination = new URL("/login?error=verification", origin);

  let target: string | null = null;
  if (type === "signup") {
    target = "/onboarding";
    if (next?.origin === origin && next.pathname === target) target += next.search;
  } else if (
    type === "invite" && next?.origin === origin && INVITE_PATH.test(next.pathname)
  ) {
    target = next.pathname;
  }

  if (target) destination.searchParams.set("next", target);
  if (tokenHash && target && (type === "signup" || type === "invite")) {
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });
    if (!error && data.session) {
      const verified = new URL(target, origin);
      // Supabase gives new invitees a generated password during verification.
      if (type === "invite") verified.searchParams.set("setup", "password");
      destination.href = verified.href;
    }
  }

  return NextResponse.redirect(destination, {
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
