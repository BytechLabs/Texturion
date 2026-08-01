"use client";

import { useEffect } from "react";

import { captureReferralCode } from "@/lib/referral/capture";

/**
 * #501 — reads `?ref=CODE` off the landing URL and remembers it.
 *
 * Mounted in the root layout because the link points at the marketing home
 * today and there is no reason a future campaign could not point it at a
 * comparison page or a pricing page. Capturing everywhere costs one effect and
 * removes a whole class of "the link worked last month" report.
 *
 * # Why not useSearchParams
 *
 * `useSearchParams()` opts the whole tree out of static rendering unless it sits
 * inside a Suspense boundary, and this sits in the ROOT layout — it would make
 * every marketing page dynamic to read a parameter that is almost never there.
 * `window.location.search` inside an effect is already client-only, so it costs
 * the static output nothing.
 *
 * # Why the parameter is then removed from the URL
 *
 * Once it is stored it has done its job, and leaving it in the address bar
 * invites the visitor to copy that URL and send it on — which would credit the
 * original referrer for an introduction somebody else made. `replaceState` also
 * keeps the Back button honest by not adding a history entry.
 */
export function ReferralCapture() {
  useEffect(() => {
    const captured = captureReferralCode(window.location.search);
    if (captured === null) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch {
      // A URL we cannot rewrite is still a referral we captured.
    }
  }, []);

  return null;
}
