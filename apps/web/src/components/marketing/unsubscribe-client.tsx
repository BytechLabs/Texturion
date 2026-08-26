"use client";

import { useEffect, useState } from "react";

import { publicEnv } from "@/env";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { unsubscribeCopy } from "@/i18n/marketing/unsubscribe";

type State = "working" | "done" | "failed";

export function UnsubscribeClient({
  token,
  locale = "en",
}: {
  token: string | null;
  locale?: MarketingLocale;
}) {
  const [state, setState] = useState<State>(token === null ? "failed" : "working");
  const copy = unsubscribeCopy(locale);

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
        if (!cancelled) setState(response.ok ? "done" : "failed");
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
        {state === "done" ? copy.doneTitle : copy.workingTitle}
      </h1>
      <p
        className="fr-body mt-4 text-[color:var(--fr-ink-70)]"
        role="status"
        aria-live="polite"
      >
        {state === "working" ? copy.working : null}
        {state === "done" ? copy.done : null}
        {state === "failed" ? copy.failed : null}
      </p>
    </div>
  );
}
