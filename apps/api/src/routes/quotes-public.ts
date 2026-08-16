import { Hono } from "hono";

import { effectiveQuoteStatus, isQuoteDecided, type QuoteState } from "@loonext/shared";

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import {
  callerCountry,
  publicLinkGuard,
  publicLinkNotAvailable,
} from "../public-links/guard";
import { resolvePublicLink, revokeLinksForSubject } from "../public-links/tokens";
import { unwrap } from "./core/http";

/**
 * #287 — the half a homeowner sees. Outside `/v1`, and therefore outside every
 * gate that protects it.
 *
 * # What may be shown, and what may not
 *
 * The same rule the payment page and the photo page follow: the BUSINESS's
 * name, the amount, and what the work is. Never the customer's own name,
 * address or number. They already know those, and this is a URL that lives in
 * SMS logs, browser history, and whatever their phone syncs to.
 *
 * # Every failure looks identical
 *
 * `resolvePublicLink` returns an outcome — expired, revoked, never existed —
 * and none of it reaches the holder. A page that distinguished "expired" from
 * "no such token" would be an oracle for enumerating the others. One response
 * for every failure, and the outcome stays in the access log where it is
 * evidence rather than a hint.
 *
 * # Viewing is recorded, and viewing is not answering
 *
 * A `viewed` quote is the most useful row in the outstanding queue: the
 * customer opened it and still has not replied, which is the difference
 * between chasing and waiting. It is set once, on first view, and never
 * overwrites a decision.
 */

const PUBLIC_COLUMNS =
  "id,amount_cents,currency,description,status,expires_at,viewed_at,decided_at";

interface PublicQuoteRow extends QuoteState {
  id: string;
  amount_cents: number;
  currency: string;
  description: string;
  viewed_at: string | null;
  decided_at: string | null;
}

export const publicQuoteRoutes = new Hono<AppEnv>();

/**
 * What the customer sees when they open the link.
 *
 * The response deliberately carries `effective_status` rather than the stored
 * one: a quote whose expiry has passed must read as expired to the person
 * being asked to accept it, and nothing writes that column.
 */
publicQuoteRoutes.get("/q/:token", publicLinkGuard(), async (c) => {
  const db = getDb(getEnv(c.env));
  const resolved = await resolvePublicLink(
    db,
    c.req.param("token"),
    "quote_view",
    callerCountry(c),
  );
  if (!resolved.ok || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }

  const row = unwrap<PublicQuoteRow[]>(
    await db
      .from("quotes")
      .select(PUBLIC_COLUMNS)
      .eq("company_id", resolved.company_id)
      .eq("id", resolved.subject_id)
      .limit(1),
    "public quote lookup",
  )[0];
  // A token that resolves to a row that is gone is the same answer as a token
  // that never existed. Saying otherwise confirms the id was once real.
  if (!row) return publicLinkNotAvailable(c);

  const company = unwrap<{ name: string; locale: string | null }[]>(
    await db
      .from("companies")
      .select("name,locale")
      .eq("id", resolved.company_id)
      .limit(1),
    "public quote company",
  )[0];
  if (!company) return publicLinkNotAvailable(c);

  const now = new Date();
  const status = effectiveQuoteStatus(row, now);

  /*
   * First view is stamped, best-effort. Deliberately NOT awaited into the
   * response's correctness: a customer looking at a quote must not see an
   * error because a bookkeeping write failed, and the worst case of losing it
   * is an owner who does not know the quote was opened.
   *
   * Only from `sent`, and only once. Re-stamping would lose the fact that
   * matters — when they FIRST looked — and stamping a decided quote would
   * walk backwards over an answer.
   */
  if (row.status === "sent" && row.viewed_at === null) {
    const { error } = await db
      .from("quotes")
      .update({ viewed_at: now.toISOString(), status: "viewed" })
      .eq("company_id", resolved.company_id)
      .eq("id", row.id)
      .eq("status", "sent");
    if (error) console.error(`quote view stamp failed: ${error.message}`);
  }

  return c.json({
    /*
     * The WORKSPACE's language, not the reader's device. Nothing here knows
     * who is holding the phone — there is no session and no profile — so the
     * honest default is the language the business writes in, which is the
     * language they wrote this quote in.
     */
    locale: company.locale ?? "en",
    business_name: company.name,
    amount_cents: row.amount_cents,
    currency: row.currency,
    description: row.description,
    status,
    expires_at: row.expires_at,
    /** Whether pressing accept would do anything, decided here not on a client. */
    can_accept: status === "sent" || status === "viewed",
  });
});

/**
 * Accepting, which is the whole point of the feature.
 *
 * A SEPARATE PURPOSE from viewing, and that is the reason `public_links`
 * stores purpose rather than inferring it: the token in the customer's URL
 * views the quote and cannot accept it. Accepting carries its own token, so a
 * link forwarded to somebody else, or scraped from an SMS log, cannot commit
 * the customer to a price.
 */
publicQuoteRoutes.post("/q/:token/accept", publicLinkGuard(), async (c) => {
  const db = getDb(getEnv(c.env));
  const resolved = await resolvePublicLink(
    db,
    c.req.param("token"),
    "quote_accept",
    callerCountry(c),
  );
  if (!resolved.ok || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }

  const row = unwrap<PublicQuoteRow[]>(
    await db
      .from("quotes")
      .select(PUBLIC_COLUMNS)
      .eq("company_id", resolved.company_id)
      .eq("id", resolved.subject_id)
      .limit(1),
    "public quote accept lookup",
  )[0];
  if (!row) return publicLinkNotAvailable(c);

  const now = new Date();
  const status = effectiveQuoteStatus(row, now);

  /*
   * Expiry is checked HERE, against the derived status, not against the
   * stored column. Nothing writes `expired`, so a quote that lapsed an hour
   * ago still says `sent` in the database — accepting it would bind the
   * business to a price it had already withdrawn.
   */
  if (status !== "sent" && status !== "viewed") {
    // Already decided, or lapsed. Not an error the customer caused, so it
    // reads as a state rather than a failure.
    return c.json({ accepted: false, status }, 409);
  }

  /*
   * The guard against a double accept is in the WHERE clause, not in the read
   * above. Two taps on a slow connection are two requests, and a check-then-
   * write would let both through — the second one overwriting the first
   * acceptance's timestamp with a later one, which is a quiet corruption of
   * the record the whole feature exists to keep.
   */
  const accepted = unwrap<{ id: string }[]>(
    await db
      .from("quotes")
      .update({
        status: "accepted",
        decided_at: now.toISOString(),
      })
      .eq("company_id", resolved.company_id)
      .eq("id", row.id)
      .in("status", ["sent", "viewed"])
      .select("id"),
    "public quote accept",
  );
  if (accepted.length === 0) {
    // Somebody else won the race. The quote IS accepted, so this is not a
    // failure from the customer's side.
    return c.json({ accepted: true, status: "accepted" });
  }

  /*
   * Both tokens die with the decision. A quote that has been answered has no
   * further use for a link, and leaving a live one is an accept route standing
   * open on a settled price.
   */
  await revokeLinksForSubject(
    db,
    // #571 put the company id first and made it required: without it this
    // revoked ANY workspace's live customer link from a subject uuid alone,
    // and a subject uuid is something the app shows people.
    resolved.company_id,
    "quote",
    row.id,
    "quote accepted",
  ).catch((cause: unknown) => {
    console.error(`quote link revoke failed: ${String(cause)}`);
  });

  return c.json({ accepted: true, status: "accepted" });
});

/** Exported for the tests, which assert the decided-quote guard directly. */
export const quoteIsAnswerable = (quote: QuoteState, now: Date): boolean =>
  !isQuoteDecided(effectiveQuoteStatus(quote, now));
