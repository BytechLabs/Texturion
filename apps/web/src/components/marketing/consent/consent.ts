/**
 * Consent state for the marketing site's Google Tag Manager (#124).
 *
 * Framework-free (no React, no "use client") so the persistence and dataLayer
 * contracts unit-test against plain fakes in the node test environment (the
 * repo has no jsdom) — the same shape as country-storage.ts. The banner, the
 * /legal/cookies preferences control, and the GTM loader are the only
 * production callers.
 *
 * Model: one first-party cookie holds the visitor's choice ("granted" or
 * "denied"). No cookie means no choice yet — the banner is showing and the
 * Consent Mode v2 default stays denied, so GTM tags with consent checks set
 * nothing. Storing the choice itself is strictly necessary (it is how we
 * remember NOT to track someone), which is why this one cookie needs no
 * consent of its own.
 */

export type ConsentChoice = "granted" | "denied";

/** The single first-party cookie that holds the visitor's consent choice. */
export const CONSENT_COOKIE = "loonext.consent";

/**
 * Re-ask after 180 days. Consent does not live forever (GDPR guidance runs
 * 6-13 months); when the cookie expires the banner simply returns.
 */
export const CONSENT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/**
 * Fired on window whenever a choice is saved, so every mounted consent
 * surface (the site-wide banner, the /legal/cookies preferences control)
 * reflects the new state without a reload.
 */
export const CONSENT_CHANGE_EVENT = "loonext:consent-change";

/** Narrow an unknown value (e.g. a raw cookie value) to a ConsentChoice. */
export function isConsentChoice(value: unknown): value is ConsentChoice {
  return value === "granted" || value === "denied";
}

const COOKIE_PATTERN = new RegExp(
  // The cookie name, at the string start or after a "; " separator, with its
  // metacharacters (the ".") escaped.
  `(?:^|;\\s*)${CONSENT_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`,
);

/**
 * Read the stored choice from a document.cookie string. Returns null when no
 * valid choice is stored (never seen the banner, cookie expired or cleared,
 * or an unparseable value).
 */
export function readStoredConsent(
  cookie: string | null | undefined,
): ConsentChoice | null {
  if (!cookie) return null;
  const value = COOKIE_PATTERN.exec(cookie)?.[1];
  return isConsentChoice(value) ? value : null;
}

/**
 * Serialize the choice for a document.cookie assignment. SameSite=Lax and
 * host-only (no Domain), so the choice never travels cross-site; Secure is
 * caller-controlled so localhost previews over http still persist.
 */
export function consentCookieString(
  choice: ConsentChoice,
  secure: boolean,
): string {
  return (
    `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_SECONDS}; ` +
    `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`
  );
}

/**
 * The Consent Mode v2 signal map for a choice. The four consent-mode-v2
 * signals follow the visitor's choice as one unit (the banner is a single
 * yes/no, not a per-category matrix); security_storage is always granted —
 * fraud-prevention state and the consent cookie itself are exempt essentials.
 */
export function consentSignals(
  choice: ConsentChoice,
): Record<string, ConsentChoice> {
  return {
    ad_storage: choice,
    ad_user_data: choice,
    ad_personalization: choice,
    analytics_storage: choice,
    security_storage: "granted",
  };
}

/**
 * Push a consent update onto a GTM dataLayer. GTM's consent API matches on a
 * genuine Arguments object (the gtag() calling convention); a plain array
 * push is silently ignored, so this cannot be a simple dataLayer.push([...]).
 */
export function pushConsentUpdate(
  dataLayer: unknown[],
  choice: ConsentChoice,
): void {
  const gtag = function () {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  } as unknown as (command: string, action: string, params: object) => void;
  gtag("consent", "update", consentSignals(choice));
}

/**
 * The window surface a consent choice touches, kept minimal so tests can pass
 * a plain fake (the node environment has no window).
 */
export interface ConsentWindow {
  document: { cookie: string };
  location: { protocol: string };
  dataLayer?: unknown[];
  dispatchEvent(event: Event): boolean;
}

/**
 * Persist a choice and make it take effect immediately: write the cookie,
 * push the Consent Mode update onto the dataLayer (created if GTM has not
 * seeded it yet), and notify every mounted consent surface. Best-effort like
 * country-storage: a cookie write that throws never breaks the UI.
 */
export function saveConsentChoice(
  win: ConsentWindow,
  choice: ConsentChoice,
): void {
  try {
    win.document.cookie = consentCookieString(
      choice,
      win.location.protocol === "https:",
    );
  } catch {
    // Persistence is best-effort; the dataLayer update below still applies
    // for the rest of this visit.
  }
  win.dataLayer = win.dataLayer ?? [];
  pushConsentUpdate(win.dataLayer, choice);
  win.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }));
}
