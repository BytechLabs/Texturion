"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * `pending` — still hydrating; `ready` — a session is in hand; `signed-out` —
 * there is no session and one is not coming.
 */
export type SessionState = "pending" | "ready" | "signed-out";

/**
 * How long to wait before calling a missing session missing.
 *
 * After an OAuth redirect the client hydrates a beat after mount, so a null
 * `getSession()` is normal for a moment. 2.5s covers that beat — the same
 * window the update-password screen already uses for the same question.
 */
const HYDRATION_GRACE_MS = 2_500;

/**
 * Resolves the Supabase browser client's session state.
 *
 * After an OAuth redirect the client hydrates the session a beat after mount,
 * so an authenticated query fired before then goes out tokenless and 401s (the
 * "couldn't load your workspace" / onboarding "check your connection" flash a
 * manual refresh used to clear). Gate those queries on this. Reads the current
 * session with getSession() and stays subscribed so a late SIGNED_IN /
 * INITIAL_SESSION also flips it — belt and suspenders.
 *
 * Crucially it now also settles NEGATIVELY. It used to flip only to true, so a
 * dead or expired session left every caller waiting forever: the workspace gate
 * sat on "Loading your workspace…" indefinitely, with no sign-out and no way
 * back to login, because the middleware fails open and nothing downstream ever
 * enforced. A session that has not arrived within the grace window is reported
 * as `signed-out` so callers can offer a way out; a later SIGNED_IN still wins.
 */
export function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("pending");
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let active = true;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;

    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) {
        setState("ready");
        return;
      }
      graceTimer = setTimeout(() => {
        if (!active) return;
        // Only settle a state that is STILL pending — a SIGNED_IN that landed
        // during the window has already won.
        setState((current) => (current === "pending" ? "signed-out" : current));
      }, HYDRATION_GRACE_MS);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        if (graceTimer) clearTimeout(graceTimer);
        setState("ready");
      }
    });

    return () => {
      active = false;
      if (graceTimer) clearTimeout(graceTimer);
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

/** Boolean flavour for callers that only gate a query on "do we have a token". */
export function useSessionReady(): boolean {
  return useSessionState() === "ready";
}
