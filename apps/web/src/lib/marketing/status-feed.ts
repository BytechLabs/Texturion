/**
 * #242 — the live half of /status, on the far side of the failure boundary.
 *
 * Posting an incident used to mean editing `INCIDENTS` in the page, passing CI,
 * and deploying the marketing app. So the page could not report an outage whose
 * cause was CI, the deploy pipeline, or a bad migration — which is most of them.
 * A status page that shares a failure domain with the product is decorative.
 *
 * WHY CLOUDFLARE KV AND NOT A DATABASE TABLE. The page is served by Cloudflare.
 * Any dependency on Cloudflare is therefore already unavoidable — if Cloudflare
 * is down, nobody is reading this page at all, so KV adds no failure domain that
 * matters. Putting the feed in Postgres instead would ADD one: Supabase could be
 * the thing that is broken, or the thing a bad migration broke, and then the
 * incident feed goes down with the incident. KV is writable from the Cloudflare
 * dashboard on a phone, needs no deploy, no CI, and no API worker.
 *
 * WHY PLAIN TEXT AND NOT JSON, WHICH IS THE WHOLE DESIGN. The person editing
 * this is doing it at 7am while texting is down, on a phone, in a dashboard
 * textarea with no validation. A JSON payload means one missing brace makes the
 * value unparseable — and the only safe thing a parser can then do is fall back
 * to "no incident", which is EXACTLY the silence this issue exists to fix, now
 * with a syntax error as its cause. So the live feed is plain-text keys that
 * cannot fail to parse. There is no schema to get wrong under stress.
 *
 * The division of labour follows the failure boundary rather than the data shape:
 *
 *   LIVE + URGENT + the deploy may be broken  → KV, one sentence, no ceremony.
 *   HISTORICAL + considered + written calmly  → the page's INCIDENTS array, via
 *                                               a normal deploy, with dates and
 *                                               a full write-up.
 *
 * Nothing here renders an operational indicator. A KV banner is still a sentence
 * a person typed, not a probe, so DESIGN-DIRECTION v4 §6 / owner amendment 11
 * (no green dots until a real probe backs them) is untouched — and
 * `status.test.tsx` still fails if one appears.
 */

/** KV keys. Named for what a person types into them, not for a data model. */
export const STATUS_FEED_KEYS = {
  /** One plain sentence about what is broken right now. Empty/absent = nothing. */
  incident: "incident",
  /** Optional human-written French counterpart. Never machine-translated. */
  incidentFr: "incident:fr-CA",
  /** ISO date (YYYY-MM-DD) somebody last actually checked the service. */
  confirmed: "confirmed",
} as const;

/**
 * Hard cap on the live sentence. Generous for the four-sentence first message in
 * `docs/INCIDENT-COMMS.md` §3, and a bound on what a compromised or fat-fingered
 * KV write can push into the page.
 */
export const MAX_INCIDENT_CHARS = 2000;

/**
 * How long a "confirmed" date stays meaningful. Past this the page stops
 * presenting the date as reassurance and says plainly that nobody has looked
 * recently — the #242 complaint about "Last updated 18 days ago" was never about
 * the number, it was about the number being offered as if it answered something.
 */
export const CONFIRMED_STALE_DAYS = 7;

export interface StatusFeed {
  /** The live sentence, trimmed and bounded; null when there is nothing live. */
  incident: string | null;
  /** Optional fr-CA sentence for the same incident. */
  incidentFr: string | null;
  /** ISO date somebody last checked, or null when unknown/unparseable. */
  confirmedIso: string | null;
  /** True when `confirmedIso` is missing or older than CONFIRMED_STALE_DAYS. */
  confirmedIsStale: boolean;
}

/** A feed that claims nothing — the shape every failure path resolves to. */
export const EMPTY_STATUS_FEED: StatusFeed = {
  incident: null,
  incidentFr: null,
  confirmedIso: null,
  confirmedIsStale: true,
};

/**
 * Normalize the live sentence.
 *
 * `\p{C}` is the Unicode "other" category: control characters, format
 * characters, surrogates. Collapsing them (rather than allowing them through)
 * means a value pasted from a phone keyboard, or one carrying a stray newline or
 * a bidi override, becomes an ordinary sentence instead of something that can
 * reshape the page around it. Then whitespace collapses and the cap applies.
 *
 * Returns null for anything that is not a sentence, so "  " and "\n" read as "no
 * incident" rather than rendering an empty banner that looks like a bug.
 */
export function parseIncidentText(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\p{C}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  return cleaned.length > MAX_INCIDENT_CHARS
    ? `${cleaned.slice(0, MAX_INCIDENT_CHARS).trimEnd()}…`
    : cleaned;
}

/**
 * Accept a YYYY-MM-DD confirmed date, and only that.
 *
 * Strict rather than permissive: `new Date()` will happily accept garbage shaped
 * like a date and produce a real-looking timestamp, and a status page that
 * renders a confidently wrong date is worse than one that renders none. A value
 * this rejects becomes "not confirmed recently", which is the safe reading.
 */
export function parseConfirmedIso(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // Round-trip guards against a real-shaped impossible date: "2026-02-31"
  // matches the pattern and Date rolls it forward to March 3.
  if (parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

/** True when the confirmed date is absent or older than the staleness window. */
export function confirmedIsStale(iso: string | null, now: Date): boolean {
  if (!iso) return true;
  const confirmed = new Date(`${iso}T00:00:00Z`).getTime();
  // A future date is not freshness, it is a typo. Treat it as stale rather than
  // as the strongest possible reassurance.
  if (confirmed > now.getTime()) return true;
  return now.getTime() - confirmed > CONFIRMED_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/** The minimal read surface this module needs — a KVNamespace satisfies it. */
export interface StatusFeedStore {
  get(key: string): Promise<string | null>;
}

/**
 * Read the live feed.
 *
 * EVERY failure resolves to a feed that claims nothing: no store bound (local
 * dev, a preview build, the binding not yet added), a KV read that throws, a
 * value that is not a sentence. The page then shows only what is compiled into
 * it, which is the same page as before this existed — degrading to the old
 * behaviour, never to a blank or a crash.
 *
 * What it must NEVER do is fail toward reassurance, and it cannot: a failed read
 * yields `confirmedIsStale: true`, so the page says nobody has checked rather
 * than implying somebody has.
 */
export async function readStatusFeed(
  store: StatusFeedStore | null | undefined,
  now: Date = new Date(),
): Promise<StatusFeed> {
  if (!store) return EMPTY_STATUS_FEED;
  try {
    const [incidentRaw, incidentFrRaw, confirmedRaw] = await Promise.all([
      store.get(STATUS_FEED_KEYS.incident),
      store.get(STATUS_FEED_KEYS.incidentFr),
      store.get(STATUS_FEED_KEYS.confirmed),
    ]);
    const confirmedIso = parseConfirmedIso(confirmedRaw);
    return {
      incident: parseIncidentText(incidentRaw),
      incidentFr: parseIncidentText(incidentFrRaw),
      confirmedIso,
      confirmedIsStale: confirmedIsStale(confirmedIso, now),
    };
  } catch {
    // A KV outage during a product outage is exactly when this must not throw:
    // the page still has to render, carrying its compiled-in content.
    return EMPTY_STATUS_FEED;
  }
}

/**
 * "JULY 7, 2026" from an ISO date, matching the page's existing eyebrow voice.
 * UTC-pinned so the rendered string cannot depend on where the worker ran.
 */
export function formatConfirmedDisplay(
  iso: string,
  locale: "en" | "fr-CA" = "en",
): string {
  return new Intl.DateTimeFormat(locale === "fr-CA" ? "fr-CA" : "en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
    .format(new Date(`${iso}T00:00:00Z`))
    .toUpperCase();
}
