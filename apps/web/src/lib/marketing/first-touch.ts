"use client";

import {
  attributionParams,
  isMeaningfulTouch,
  referrerHost,
  sanitizeLandingPath,
  type FirstTouch,
} from "@loonext/shared";

/**
 * #296 — remembering which page started it, all the way to the workspace.
 *
 * # Why anything is stored at all
 *
 * The visitor lands on marketing, walks to /signup, confirms an email, comes
 * back through a full page load, and only then reaches a screen that creates a
 * workspace. Nothing about the landing survives that on its own, which is the
 * same gap `lib/referral/capture.ts` exists to close for `?ref=`.
 *
 * # FIRST touch, and it is deliberately the opposite of the referral capture
 *
 * Referral takes LAST touch, correctly: a reward should follow the link
 * somebody actually arrived through most recently.
 *
 * This takes FIRST and never overwrites. A visitor reads /compare/heymarket,
 * thinks for a week, returns to /pricing and signs up — under last touch that
 * is a point for /pricing, which EVERY signup passes through, so /pricing
 * would win every time and the six trade pages would look worthless whatever
 * they did. The page that started it is the one whose value is in question.
 *
 * # It expires
 *
 * Thirty days, matching the referral window. An attribution window that never
 * closes eventually credits a page somebody read last spring for a signup it
 * had nothing to do with.
 */

const STORAGE_KEY = "loonext:first-touch";

/** How long a first touch stays attributable. Matches the referral window. */
const FIRST_TOUCH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredTouch extends FirstTouch {
  /** Epoch ms, so expiry is a comparison rather than a date parse. */
  stored_at: number;
}

function read(): StoredTouch | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as StoredTouch;
    if (typeof parsed?.stored_at !== "number") return null;
    if (Date.now() - parsed.stored_at > FIRST_TOUCH_TTL_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    // Storage blocked, or a value somebody else wrote. Either way there is no
    // touch, and a measurement must never break a signup.
    return null;
  }
}

/**
 * Record this landing, if nothing is recorded yet.
 *
 * Idempotent by design: the FIRST call inside the window wins and every later
 * one is a no-op, which is what makes it first-touch rather than last.
 */
export function captureFirstTouch(
  pathname: string,
  search: string,
  referrer: string,
): void {
  if (typeof window === "undefined") return;
  if (read() !== null) return;

  const landing = sanitizeLandingPath(pathname);
  if (landing === null) return;

  const touch: FirstTouch = {
    landing_path: landing,
    referrer_host: referrerHost(referrer),
    params: attributionParams(search),
    at: new Date().toISOString(),
  };
  // A bare landing on "/" with no referrer and no campaign says nothing, and
  // storing it would make "direct" the best-performing page we have.
  if (!isMeaningfulTouch(touch)) return;

  try {
    const stored: StoredTouch = { ...touch, stored_at: Date.now() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked. The signup still works; it is simply unattributed.
  }
}

/**
 * The touch to spread into a create-company body, or nothing.
 *
 * Spread-shaped like `referralCodeForCreate()` so an unattributed signup adds
 * no key at all rather than an explicit undefined — the API schema is strict.
 *
 * The values are re-sanitised server-side regardless: the browser is not
 * trusted with what reaches a column, because these arrived as query
 * parameters on a public page.
 */
export function firstTouchForCreate(): {
  first_touch?: {
    landing_path: string;
    referrer_host?: string;
    params: Record<string, string>;
  };
} {
  const stored = read();
  if (stored === null) return {};
  return {
    first_touch: {
      landing_path: stored.landing_path,
      ...(stored.referrer_host !== null
        ? { referrer_host: stored.referrer_host }
        : {}),
      params: stored.params as Record<string, string>,
    },
  };
}

/** Forget it once a workspace exists, so a second one is not miscredited. */
export function clearFirstTouch(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do; an unremovable key expires on its own.
  }
}
