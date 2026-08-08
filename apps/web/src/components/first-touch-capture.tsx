"use client";

import { useEffect } from "react";

import { captureFirstTouch } from "@/lib/marketing/first-touch";
import { redactTokenPaths } from "@/lib/observability/scrub";

/**
 * #296 — remembers which page a visitor FIRST landed on.
 *
 * Mounted in the root layout beside `ReferralCapture`, for the same reason it
 * is: the landing can be any page. Six trade pages and three comparison pages
 * were built without any way to tell whether they produce customers, and
 * capturing only on the homepage would answer the question for the one page
 * nobody was unsure about.
 *
 * # Why not useSearchParams
 *
 * Same reason as the referral capture: `useSearchParams()` opts the whole tree
 * out of static rendering unless wrapped in Suspense, and this sits in the ROOT
 * layout — it would make every marketing page dynamic to read a parameter that
 * is usually absent. `window.location` inside an effect is already client-only
 * and costs the static output nothing.
 *
 * # Why the campaign parameters are NOT stripped from the URL afterwards
 *
 * `ReferralCapture` deletes `?ref=` once stored, because leaving it invites the
 * visitor to copy that URL onward and credit the wrong person for an
 * introduction. Campaign parameters have no such payout attached, and other
 * analytics on the page read them too — removing them would quietly break
 * something else to tidy an address bar.
 */
export function FirstTouchCapture() {
  useEffect(() => {
    // #558: never write a secret path into storage. A shared photo link's token
    // IS its path, and this keeps a landing path for 30 days — so a homeowner
    // who opened a link would carry the live token in their browser long after
    // the crew revoked it. It is their own token in their own browser, and the
    // host split means it never reached our database, so this is the mild half
    // of #558 — but it is the same one-line class of mistake, and a landing page
    // that is a secret is not attribution data in the first place.
    const path = window.location.pathname;
    if (path !== redactTokenPaths(path)) return;
    captureFirstTouch(path, window.location.search, document.referrer);
  }, []);

  return null;
}
