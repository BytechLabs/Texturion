"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * A quiet "Sign out" control for the onboarding chrome. The wizard runs
 * OUTSIDE the (app) shell (no MemberMenu, no sidebar), so a signed-in user who
 * lands on a wrong account — or gets stuck on the post-payment setting-up
 * screen waiting on a number — otherwise has no way out. Mirrors the shell's
 * MemberMenu sign-out exactly: Supabase signOut → clear the query cache →
 * /login. Kept calm and secondary (muted, small) so it never competes with the
 * one question on screen (G7).
 */
export function OnboardingSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await getSupabaseBrowser().auth.signOut();
      queryClient.clear();
      router.push("/login");
    } catch {
      // Sign-out is best-effort from the client; if the network blips, the
      // button re-enables so the user can try again.
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
    >
      <LogOut className="size-3.5" strokeWidth={1.75} aria-hidden />
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
