import { Hono } from "hono";
import { z } from "zod";

import {
  QUOTE_STATUSES,
  effectiveQuoteStatus,
  isQuoteOutstanding,
  type QuoteState,
} from "@loonext/shared";

import { getDb } from "../db";
import { getEnv } from "../env";
import type { AppEnv } from "../context";
import { requireCapability } from "../auth/company";
import { errorResponse } from "../http/errors";
import { parseJsonBody, pathUuid, unwrap } from "./core/http";

/**
 * #287 — quotes: the authenticated half.
 *
 * A quote is the answer to "how much", and until now it has been a paragraph
 * in a thread. These routes give it an object; the public half — the link the
 * customer opens and accepts without an account — lands on `public_links` and
 * is deliberately separate, because the two have completely different readers
 * and completely different authorization.
 *
 * # What is NOT here
 *
 * No line items, no tax, no invoice. The migration's header makes that case at
 * length: this is a doorway to an estimating package we should not build, and
 * the boundary is easier to hold in a schema than in a code review.
 *
 * # Why status is not writable directly
 *
 * There is no `PATCH /quotes/:id { status }`. Every status change is a named
 * action — send, accept, decline — because "what happened to this quote" is a
 * record somebody may later dispute, and a free-form status field lets a
 * client write `accepted` without anything having accepted it. The transitions
 * live in `packages/shared/src/quotes.ts` and the routes ask them.
 */

const QUOTE_COLUMNS =
  "id,conversation_id,contact_id,amount_cents,currency,description," +
  "status,expires_at,sent_at,viewed_at,decided_at,created_by,created_at,updated_at";

/** A quote row as the wire carries it, plus the status a reader should see. */
interface QuoteRow extends QuoteState {
  id: string;
  [key: string]: unknown;
}

/**
 * The stored row PLUS `effective_status`, which is what a client renders.
 *
 * Both, not one. `status` is what a person did and is what a transition is
 * checked against; `effective_status` folds in an expiry that nothing wrote.
 * A response that carried only the stored one would make every client derive
 * expiry itself, which is three implementations of a rule that has one home.
 */
function withEffectiveStatus(row: QuoteRow, now: Date): Record<string, unknown> {
  return { ...row, effective_status: effectiveQuoteStatus(row, now) };
}

const createSchema = z.object({
  conversation_id: z.uuid(),
  contact_id: z.uuid(),
  // Cents, and positive. A zero quote is not a quote and a negative one is a
  // refund, which is not this feature.
  amount_cents: z.number().int().positive().max(100_000_000),
  currency: z.enum(["usd", "cad"]),
  description: z.string().trim().min(1).max(2_000),
  /** ISO 8601. Required: a quote with no expiry binds the business forever. */
  expires_at: z.iso.datetime(),
});

export const quotesRoutes = new Hono<AppEnv>();

/**
 * The outstanding queue, and the rest on request.
 *
 * `?status=outstanding` is the one the owner opens every morning: money asked
 * for and not yet answered. It is computed with the shared rule rather than a
 * SQL `where status in (...)`, because "outstanding" includes an expiry that
 * is derived on read — a query filtering on the stored column would happily
 * return a quote that expired last week.
 */
quotesRoutes.get("/quotes", requireCapability("conversations.read"), async (c) => {
  const db = getDb(getEnv(c.env));
  const status = c.req.query("status");
  if (status !== undefined && status !== "outstanding" && !QUOTE_STATUSES.includes(status as never)) {
    return errorResponse(c, "validation_failed", `unknown status filter: ${status}`);
  }

  const rows = unwrap<QuoteRow[]>(
    await db
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .order("created_at", { ascending: false })
      // Defensive bound, same reasoning as the tag list: unpaginated, so cap
      // it well above any real workspace rather than return the whole table.
      .limit(500),
    "quotes list",
  );

  const now = new Date();
  const filtered = rows.filter((row: QuoteRow) => {
    if (status === undefined) return true;
    if (status === "outstanding") return isQuoteOutstanding(row, now);
    return effectiveQuoteStatus(row, now) === status;
  });

  return c.json({
    data: filtered.map((row: QuoteRow) => withEffectiveStatus(row, now)),
    next_cursor: null,
  });
});

quotesRoutes.get("/quotes/:id", requireCapability("conversations.read"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<QuoteRow[]>(
    await db
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .limit(1),
    "quote read",
  );
  const row = rows[0];
  if (!row) return errorResponse(c, "not_found", "no such quote");
  return c.json(withEffectiveStatus(row, new Date()));
});

/**
 * Write one. `conversations.send` rather than `.note`: naming a price is
 * speaking for the business, which is the same authority as sending a text.
 *
 * Created as a DRAFT always. Sending is its own action, because the moment an
 * offer becomes an offer is a fact worth recording separately from the moment
 * somebody typed it.
 */
quotesRoutes.post("/quotes", requireCapability("conversations.send"), async (c) => {
  const body = await parseJsonBody(c, createSchema);
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));

  // An expiry in the past is a quote that is dead on arrival. Refused here
  // rather than stored, because the alternative is a row that every reader
  // has to explain.
  if (Date.parse(body.expires_at) <= Date.now()) {
    return errorResponse(c, "validation_failed", "expires_at is already in the past");
  }

  /*
   * The conversation and the contact are verified to belong to THIS workspace
   * before anything is written. The columns are foreign keys, so the database
   * would refuse a row pointing at a table that does not hold them — but it
   * would happily accept one pointing at ANOTHER company's conversation,
   * because the constraint knows nothing about tenancy. That is the #347 rule:
   * the API scopes every query, and the database is not a second opinion.
   */
  const conversations = unwrap<{ id: string }[]>(
    await db
      .from("conversations")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", body.conversation_id)
      .limit(1),
    "quote conversation check",
  );
  if (conversations.length === 0) {
    return errorResponse(c, "not_found", "no such conversation");
  }

  const contacts = unwrap<{ id: string }[]>(
    await db
      .from("contacts")
      .select("id")
      .eq("company_id", companyId)
      .eq("id", body.contact_id)
      .limit(1),
    "quote contact check",
  );
  if (contacts.length === 0) {
    return errorResponse(c, "not_found", "no such contact");
  }

  const rows = unwrap<QuoteRow[]>(
    await db
      .from("quotes")
      .insert({
        company_id: companyId,
        conversation_id: body.conversation_id,
        contact_id: body.contact_id,
        amount_cents: body.amount_cents,
        currency: body.currency,
        description: body.description,
        status: "draft",
        expires_at: body.expires_at,
        created_by: c.get("userId"),
      })
      .select(QUOTE_COLUMNS),
    "quote create",
  );

  return c.json(withEffectiveStatus(rows[0] as QuoteRow, new Date()), 201);
});
