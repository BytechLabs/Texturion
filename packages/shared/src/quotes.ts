/**
 * #287 — what a quote's status means, decided once for three clients.
 *
 * The schema deliberately does NOT hold this vocabulary: `quotes.status` is
 * `text` with a length floor, and the migration says why. Two lists, one
 * authoritative and neither saying so, is the shape that has already cost this
 * repo three rounds. This file is the one home.
 *
 * # The distinction the whole file exists for
 *
 * A quote's status as STORED and a quote's status as READ are not the same
 * thing, and conflating them is the bug waiting here. Nothing writes `expired`
 * at the moment a quote expires — no cron watches the clock, and one that did
 * would be a job that can fall behind and leave a stale row saying `sent`
 * about a price nobody honours any more.
 *
 * So expiry is DERIVED on every read, from `expires_at` against now. The
 * stored status records what a PERSON did; the effective status is what a
 * person should be told. `effectiveQuoteStatus` is the only thing any client
 * should render or count.
 *
 * # The ports are by hand
 *
 * Kotlin and Swift cannot import this, so the same rules exist twice more.
 * That is the arrangement the rest of this repo already uses, and the parity
 * vectors are what keep it from rotting.
 *
 * # The labels are KEYS
 *
 * Not English. Every sentence a client renders comes from its own catalogue —
 * a shared module that returns a finished sentence answers in the crew's
 * language regardless of the reader's, which is the whole of #228. The union
 * below is what lets `tsc` prove the web catalogue answers every one.
 */

/**
 * Every status a quote row may hold.
 *
 * `draft` exists because writing a quote and sending it are different acts: a
 * price typed but not sent is not an offer, and must never be counted as one
 * in a win rate or shown in the outstanding queue.
 */
export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "viewed",
  "accepted",
  "declined",
  "expired",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export function isQuoteStatus(value: string): value is QuoteStatus {
  return (QUOTE_STATUSES as readonly string[]).includes(value);
}

/** The catalogue key naming each status, for whoever is rendering it. */
export type QuoteStatusKey =
  | "quotes.statusDraft"
  | "quotes.statusSent"
  | "quotes.statusViewed"
  | "quotes.statusAccepted"
  | "quotes.statusDeclined"
  | "quotes.statusExpired";

export const QUOTE_STATUS_KEYS: Record<QuoteStatus, QuoteStatusKey> = {
  draft: "quotes.statusDraft",
  sent: "quotes.statusSent",
  viewed: "quotes.statusViewed",
  accepted: "quotes.statusAccepted",
  declined: "quotes.statusDeclined",
  expired: "quotes.statusExpired",
};

/** The minimum a caller has to know about a quote to reason about it. */
export interface QuoteState {
  status: QuoteStatus;
  /** ISO 8601. The migration makes this NOT NULL, so it is never absent. */
  expires_at: string;
}

/**
 * A decision is final. Expiry cannot un-accept a quote somebody accepted, and
 * cannot re-open one they declined — the deadline was for answering, and it
 * has been answered.
 */
export function isQuoteDecided(status: QuoteStatus): boolean {
  return status === "accepted" || status === "declined";
}

/**
 * What to TELL somebody, which is not always what the row says.
 *
 * The only status any client should render or count. A `sent` quote whose
 * `expires_at` has passed reads `expired` here without anything having written
 * that to the database, which is what makes the derivation safe: there is no
 * job to fall behind, and no window where a stale row quotes a price the
 * business no longer honours.
 *
 * `draft` never expires into anything. An unsent price is not an offer, so
 * there is no deadline for a customer to miss — the expiry only starts
 * meaning something once somebody has been given it.
 */
export function effectiveQuoteStatus(
  quote: QuoteState,
  now: Date = new Date(),
): QuoteStatus {
  if (isQuoteDecided(quote.status)) return quote.status;
  if (quote.status === "draft") return "draft";
  if (quote.status === "expired") return "expired";
  const expiry = Date.parse(quote.expires_at);
  // An unparseable date is not an expiry. Reading it as one would silently
  // withdraw a live offer on the strength of a bad string.
  if (Number.isNaN(expiry)) return quote.status;
  return expiry <= now.getTime() ? "expired" : quote.status;
}

/**
 * Money the business has asked for and not yet been answered about.
 *
 * This is the outstanding queue, and it is the highest-value list in the
 * product: an unanswered quote is revenue that has not been chased. Derived
 * rather than stored for the reason above.
 */
export function isQuoteOutstanding(
  quote: QuoteState,
  now: Date = new Date(),
): boolean {
  const status = effectiveQuoteStatus(quote, now);
  return status === "sent" || status === "viewed";
}

/**
 * Which status changes are allowed, as data rather than as scattered `if`s.
 *
 * Written as what may follow what, because that is the question every caller
 * actually asks. Notably absent:
 *
 *   * nothing returns to `draft` — a price that has been sent has been seen by
 *     somebody, and pretending otherwise loses the record of what was offered;
 *   * `accepted` and `declined` lead nowhere, because a decision is final;
 *   * `expired` leads nowhere either. Re-offering is a NEW quote at today's
 *     price, which is the honest thing for a trade whose material costs move.
 */
const ALLOWED_NEXT: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["viewed", "accepted", "declined", "expired"],
  // Viewing is not answering: a customer who opened it can still do either.
  viewed: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return ALLOWED_NEXT[from].includes(to);
}

/**
 * The statuses a win rate is computed from.
 *
 * Deliberately NOT every quote. A draft was never offered, and an expired or
 * unanswered one says nothing about whether the business wins work — counting
 * silence as a loss would make the rate fall every time a crew quotes more,
 * which is the same trap `pipelineWinRate` documents and avoids.
 */
export function isQuoteDecidedForWinRate(
  quote: QuoteState,
  now: Date = new Date(),
): boolean {
  return isQuoteDecided(effectiveQuoteStatus(quote, now));
}
