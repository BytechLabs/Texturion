"use client";

import { useEffect, useState } from "react";

import { publicEnv } from "@/env";

/**
 * #312 — the unsubscribe landing page.
 *
 * IT UNSUBSCRIBES ON ARRIVAL. No button, no "are you sure", no login. Every one
 * of those is a step at which somebody who asked to stop hearing from us instead
 * gives up and marks the message as spam, which is worse for them and worse for
 * our sending domain. The token in the link is the whole credential, and this is
 * the one place a destructive-looking action should be immediate: the entire
 * point is that it costs the person nothing.
 *
 * It is also why this runs on arrival rather than behind a click — a mail client
 * that pre-fetches the link should complete the unsubscribe, not warm up a page
 * that still needs a human.
 *
 * IDEMPOTENT, so a pre-fetch followed by a real visit is fine, and an unknown
 * token reports success. Somebody clicking an old link cannot fix a token, and
 * "that link is invalid" reads as "you are still subscribed" — the opposite of
 * what they need to hear.
 */
type State = "working" | "done" | "failed";

export function UnsubscribeClient({ token }: { token: string | null }) {
  const [state, setState] = useState<State>(token === null ? "failed" : "working");

  useEffect(() => {
    if (token === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(
          `${publicEnv.NEXT_PUBLIC_API_URL}/marketing/unsubscribe`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          },
        );
        if (cancelled) return;
        setState(response.ok ? "done" : "failed");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="fr-h1 text-[color:var(--fr-ink)]">
        {state === "done" ? "Done. You are unsubscribed." : "Unsubscribing you"}
      </h1>
      <p
        className="fr-body mt-4 text-[color:var(--fr-ink-70)]"
        role="status"
        aria-live="polite"
      >
        {state === "working" &&
          "One moment. You do not need to do anything else."}
        {state === "done" &&
          "We will not email you about the product again. Anything to do with an account you hold with us, like a receipt or a security notice, is separate and keeps working."}
        {state === "failed" &&
          "We could not complete that automatically. Reply to any email from us and a person will take you off the list."}
      </p>
    </div>
  );
}
