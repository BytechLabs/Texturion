import { isReferralCode, normalizeReferralCode } from "@loonext/shared";

/**
 * #501 — carrying `?ref=CODE` from the link somebody was sent to the moment a
 * workspace is created.
 *
 * # Why anything is needed here at all
 *
 * #399 built both ends and no middle. The server hands the owner
 * `${SITE_ORIGIN}/?ref=CODE`, `POST /v1/companies` accepts `referral_code`, and
 * nothing on the web ever read the parameter or sent the field. Every link
 * copied out of that card attributed nothing, forever — which is worse than
 * having no programme, because the owner sent the link and then watched it do
 * nothing.
 *
 * The gap is a real one rather than an oversight of a single line: the visitor
 * lands on marketing, walks to /signup, confirms an email, comes back through a
 * full page load, and only then reaches a screen that creates a workspace. The
 * code has to survive all of it, so it has to be stored.
 *
 * # Last touch wins, inside a window
 *
 * If two people send links, the reward follows the one whose link the visitor
 * actually arrived through most recently, and the clock restarts on each touch.
 * First-touch is the arguable alternative and is worse here: a code clicked once
 * weeks ago would outrank the introduction that actually produced the signup.
 *
 * The window closes at thirty days because an attribution window that never
 * closes eventually credits somebody for a signup that had nothing to do with
 * them, and #399's reward is real money.
 *
 * # Only well-shaped codes are ever stored
 *
 * `?ref=` is attacker-controlled: it is a query parameter on a public marketing
 * page. Checking the shape here means the value that reaches storage and the API
 * is always eight characters of our own alphabet, never a payload. A malformed
 * one is dropped in silence — a visitor who mistyped a code is a customer we
 * still want, and there is nothing useful to tell them about somebody else's
 * referral link.
 */

const STORAGE_KEY = "loonext:referral";

/** How long an unused referral stays attributable. */
const REFERRAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredReferral {
  code: string;
  savedAt: number;
}

/**
 * Pull a referral code out of a query string.
 *
 * Pure, and separated from storage so the parsing rules are testable without a
 * DOM. Returns null for anything that is not one of our codes — including an
 * absent parameter, a mistyped one, and a hostile one.
 */
export function referralCodeFromSearch(search: string): string | null {
  let raw: string | null;
  try {
    raw = new URLSearchParams(search).get("ref");
  } catch {
    return null;
  }
  if (raw === null) return null;
  // Bounded before normalising: a megabyte of query string should not be
  // upper-cased and regex-scanned just to be rejected.
  if (raw.length > 64) return null;
  const code = normalizeReferralCode(raw);
  return isReferralCode(code) ? code : null;
}

/** Parse stored JSON, tolerating anything (never throws). */
function parseStored(raw: string | null, now: number): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { code, savedAt } = value as Partial<StoredReferral>;
    if (typeof code !== "string" || !isReferralCode(code)) return null;
    // No timestamp is treated as expired rather than as fresh: the only way to
    // get one is a hand-written or pre-release entry, and neither should hold
    // an attribution open indefinitely.
    if (typeof savedAt !== "number") return null;
    return now - savedAt > REFERRAL_TTL_MS ? null : code;
  } catch {
    return null;
  }
}

/**
 * Record a referral code seen in the URL, if there is one.
 *
 * Returns the code that is now stored, or null when the URL carried none. Safe
 * to call on every navigation: a page without `?ref=` leaves an existing
 * attribution alone rather than clearing it, because the visitor walking from
 * the landing page to /signup is exactly the journey being tracked.
 */
export function captureReferralCode(
  search: string,
  now: number = Date.now(),
): string | null {
  const code = referralCodeFromSearch(search);
  if (code === null) return null;
  if (typeof window === "undefined") return code;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ code, savedAt: now } satisfies StoredReferral),
    );
  } catch {
    // Storage blocked (private mode). The signup still works; this particular
    // referral will not be attributed, which beats failing the page load.
  }
  return code;
}

/** The stored code, or null when there is none or it has expired. */
export function readReferralCode(now: number = Date.now()): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const code = parseStored(raw, now);
    // Expired entries are DELETED rather than merely ignored, so a stale
    // attribution stops existing at the moment it stops counting.
    if (code === null && raw !== null) window.localStorage.removeItem(STORAGE_KEY);
    return code;
  } catch {
    return null;
  }
}

/**
 * Spread into a `POST /v1/companies` body.
 *
 * A helper rather than an inline read because three different screens create
 * workspaces — the number step (CA-no-US), the business step, and the port
 * sub-wizard — and a referral that works on two of the three is a bug that only
 * shows up for one kind of signup.
 */
export function referralCodeForCreate(): { referral_code?: string } {
  const code = readReferralCode();
  return code === null ? {} : { referral_code: code };
}

/**
 * Forget the stored code, once a workspace has been created with it.
 *
 * Without this the same owner's SECOND workspace would carry the same
 * attribution. The server's one-referral-per-referee rule is per workspace, so
 * it would happily record it — and paying twice for one introduction is the
 * cheapest referral fraud there is.
 */
export function clearReferralCode(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up.
  }
}
