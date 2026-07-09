"use client";

import { useEffect, useState } from "react";

import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Resolves to true once the Supabase browser client has a session in hand.
 *
 * After an OAuth redirect the client hydrates the session a beat after mount,
 * so an authenticated query fired before then goes out tokenless and 401s (the
 * "couldn't load your workspace" / onboarding "check your connection" flash a
 * manual refresh used to clear). Gate those queries on this. Reads the current
 * session with getSession() and stays subscribed so a late SIGNED_IN /
 * INITIAL_SESSION also flips it — belt and suspenders.
 */
export function useSessionReady(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return ready;
}
