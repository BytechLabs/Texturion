import { Hono } from "hono";
import type { Context } from "hono";
import { z } from "zod";

import { billingCurrencyOf, effectiveQuoteStatus, estimateSegments, isQuoteOutstanding, QUOTE_STATUSES, quoteSms, resolveLocale, stateMachines } from '@loonext/shared';
import type { MemberRole, QuoteState } from '@loonext/shared';

import { getDb } from "../db";
import { getEnv } from "../env";
import { reportHandledFailure } from "../observability/capture";
import type { AppEnv } from "../context";
import { requireCapability } from "../auth/company";
import {
  requireConversationAccess,
  resolveNumberAccess,
} from "../auth/number-access";
import { ApiError, errorResponse } from "../http/errors";
import { mintPublicLink } from "../public-links/tokens";
import { dispatchOutbound, gateOutboundSend, runPreSendGates } from "../messaging/send";
import { insertConversationEvents } from "./core/events";
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
  "status,expires_at,sent_at,viewed_at,decided_at,decided_by_name,decline_reason,created_by,created_at,updated_at," +
  "sending_at,message_id";

const SEND_LEASE_MS = 2 * 60_000;

/** A quote row as the wire carries it, plus the status a reader should see. */
interface QuoteRow extends QuoteState {
  id: string;
  /*
   * #287: the four the SEND actually reads, named rather than left to the index
   * signature below. They were `unknown` while nothing composed a text; the
   * moment something did, an index signature is how a money amount reaches a
   * customer's SMS as `[object Object]`.
   */
  conversation_id: string;
  amount_cents: number;
  currency: string;
  description: string;
  updated_at: string;
  sending_at: string | null;
  message_id: string | null;
  [key: string]: unknown;
}

/** What the send needs about the thread: who it goes to, and from where. */
interface SendView {
  id: string;
  contact_phone_e164: string;
  /** #228: the customer's own language, when they have one. */
  contacts: { locale: string | null } | null;
  phone_numbers: { number_e164: string | null; status: string };
  companies: { name: string; locale: string | null };
}

/**
 * The stored row PLUS `effective_status`, which is what a client renders.
 *
 * Both, not one. `status` is what a person did and is what a transition is
 * checked against; `effective_status` folds in an expiry that nothing wrote.
 * A response that carried only the stored one would make every client derive
 * expiry itself, which is three implementations of a rule that has one home.
 */
function withEffectiveStatus(
  { sending_at, message_id, ...row }: QuoteRow,
  now: Date,
  role: MemberRole,
): Record<string, unknown> {
  const status = effectiveQuoteStatus(row, now);
  const actions = stateMachines.allowedActions(stateMachines.quoteMachine, status, role);
  const draftLocked = status === "draft" && (sending_at !== null || message_id !== null);
  const offerExpired = Date.parse(row.expires_at) <= now.getTime();
  return {
    ...row,
    effective_status: status,
    allowed_actions: actions.filter((action) =>
      !(draftLocked && (action === "edit" || action === "delete")) &&
      !(offerExpired && (action === "send" || action === "undo_acceptance"))
    ),
  };
}

const createSchema = z.object({
  conversation_id: z.uuid(),
  /*
   * NOT ACCEPTED from the client. A conversation threads by
   * contact-relationship (D7), so it already knows whose number this is —
   * reading it here is one less thing a caller can get wrong, and one less
   * prop to thread through a composer to satisfy a field the server can see.
   *
   * It is still stored on the quote rather than joined at read time: the row
   * records who the number belonged to WHEN THE MONEY WAS NAMED, and a
   * conversation can outlive a contact edit.
   */
  // Cents, and positive. A zero quote is not a quote and a negative one is a
  // refund, which is not this feature.
  amount_cents: z.number().int().positive().max(100_000_000),
  /*
   * OPTIONAL, and resolved from the workspace when absent. A crew member
   * naming a price should not be asked which currency they bill in — they bill
   * in one, it is on their invoices, and offering the choice invites a quote
   * denominated in a currency the business cannot take payment in. The
   * payment-request route already works this way.
   */
  currency: z.enum(["usd", "cad"]).optional(),
  description: z.string().trim().min(1).max(2000),
  /** ISO 8601. Required: a quote with no expiry binds the business forever. */
  expires_at: z.iso.datetime(),
});

const editDraftSchema = createSchema.omit({ conversation_id: true }).partial().strict();
const declineSchema = z.object({ reason: z.string().trim().min(1).max(500) });

/**
 * Release a send's claim after a send that did not happen. The quote stays a
 * draft throughout, so there is nothing to undo but the lease.
 *
 * Best-effort and deliberately quiet: the caller is already throwing the real
 * reason, and a failure to tidy up must not replace it with a worse message.
 * Losing this only delays a retry until the lease runs out.
 */
async function releaseSend(db: ReturnType<typeof getDb>, companyId: string, id: string) {
  const { error } = await db
    .from("quotes")
    .update({ sending_at: null })
    .eq("company_id", companyId)
    .eq("id", id)
    .eq("status", "draft");
  if (error) console.error(`quote send release failed: ${error.message}`);
}

export const quotesRoutes = new Hono<AppEnv>();

async function requireQuoteTextAccess(c: Context<AppEnv>) {
  const id = pathUuid(c, "id");
  const companyId = c.get("companyId");
  const db = getDb(getEnv(c.env));
  const [quote] = unwrap<{ conversation_id: string }[]>(
    await db.from("quotes").select("conversation_id")
      .eq("company_id", companyId).eq("id", id).limit(1),
    "quote lookup",
  );
  if (!quote) {
    throw new ApiError("not_found", "No such quote.", { key: "apiRefusals.quoteNotFound" });
  }
  await requireConversationAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    conversationId: quote.conversation_id,
    need: "text",
  });
  return { db, companyId, id };
}

quotesRoutes.patch("/quotes/:id", requireCapability("conversations.send"), async (c) => {
  const { db, companyId, id } = await requireQuoteTextAccess(c);
  const changes = await parseJsonBody(c, editDraftSchema);
  const now = new Date();
  if (changes.expires_at && Date.parse(changes.expires_at) <= now.getTime()) {
    return errorResponse(c, "validation_failed", "Choose a future expiry for this quote.", {
      key: "apiRefusals.quoteExpiryFuture",
    });
  }

  const [updated] = unwrap<QuoteRow[]>(
    await db.from("quotes").update({ ...changes, updated_at: now.toISOString() })
      .eq("company_id", companyId).eq("id", id).eq("status", "draft")
      .is("sending_at", null).is("message_id", null).select(QUOTE_COLUMNS),
    "quote draft update",
  );
  if (!updated) {
    return errorResponse(c, "conflict", "This quote draft can no longer be changed.", {
      key: "apiRefusals.quoteDraftLocked",
    });
  }
  return c.json(withEffectiveStatus(updated, now, c.get("role")));
});

quotesRoutes.delete("/quotes/:id", requireCapability("conversations.send"), async (c) => {
  const { db, companyId, id } = await requireQuoteTextAccess(c);
  const [deleted] = unwrap<{ id: string }[]>(
    await db.from("quotes").delete()
      .eq("company_id", companyId).eq("id", id).eq("status", "draft")
      .is("sending_at", null).is("message_id", null).select("id"),
    "quote draft delete",
  );
  if (!deleted) {
    return errorResponse(c, "conflict", "This quote draft can no longer be changed.", {
      key: "apiRefusals.quoteDraftLocked",
    });
  }
  return c.json({ deleted: true });
});

quotesRoutes.post("/quotes/:id/withdraw", requireCapability("conversations.send"), async (c) => {
  const { db, companyId, id } = await requireQuoteTextAccess(c);
  const withdrawn = unwrap<boolean>(await db.rpc("api_withdraw_quote", {
    p_company_id: companyId,
    p_quote_id: id,
    p_actor: c.get("userId"),
  }), "quote withdrawal");
  if (!withdrawn) {
    return errorResponse(c, "conflict", "This quote can no longer be withdrawn.", {
      key: "apiRefusals.quoteWithdrawalUnavailable",
    });
  }
  return c.json({ withdrawn: true });
});

quotesRoutes.post("/quotes/:id/decline", requireCapability("conversations.send"), async (c) => {
  const { db, companyId, id } = await requireQuoteTextAccess(c);
  const { reason } = await parseJsonBody(c, declineSchema);
  const declined = unwrap<boolean>(await db.rpc("api_record_quote_decision", {
    p_company_id: companyId,
    p_quote_id: id,
    p_decision: "declined",
    p_actor: c.get("userId"),
    p_link_id: null,
    p_name: null,
    p_reason: reason,
    p_country: null,
  }), "quote decline");
  if (!declined) {
    return errorResponse(c, "conflict", "This quote can no longer be declined.", {
      key: "apiRefusals.quoteDeclineUnavailable",
    });
  }
  return c.json({ declined: true });
});

quotesRoutes.post("/quotes/:id/undo-acceptance", requireCapability("settings.manage"), async (c) => {
  const { db, companyId, id } = await requireQuoteTextAccess(c);
  const reopened = unwrap<boolean>(await db.rpc("api_undo_quote_acceptance", {
    p_company_id: companyId,
    p_quote_id: id,
    p_actor: c.get("userId"),
  }), "reopen accepted quote");
  if (!reopened) {
    return errorResponse(c, "conflict", "This quote can no longer be reopened.", {
      key: "apiRefusals.quoteUndoUnavailable",
    });
  }
  return c.json({ reopened: true });
});

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

  /*
   * Scoped to one thread when asked. Found while building the composer
   * strip: without this the client would fetch the workspace's quotes and
   * filter locally, which breaks against the 500-row cap the moment a busy
   * workspace has more quotes than one thread's worth.
   */
  const conversationId = c.req.query("conversation_id");

  /*
   * #106 — a member denied a phone line must not read the quotes on it.
   *
   * A quote carries the amount, the free-text scope and the conversation id of
   * work on a line this member's inbox already refuses to show them. Without
   * this the list handed over the whole workspace's prices, and — worse — the
   * conversation ids needed to then send a quote FROM the denied line.
   *
   * Filtered through `conversations`, because a quote has no phone_number_id
   * of its own; the thread it belongs to has one. The #368 roster only knows
   * about RPCs taking `p_hidden_number_ids`, which is why a plain `.from()`
   * read like this one was invisible to it.
   */
  const access = await resolveNumberAccess(db, {
    companyId: c.get("companyId"),
    userId: c.get("userId"),
    role: c.get("role"),
  });

  let query = db
    .from("quotes")
    .select(`${QUOTE_COLUMNS},conversations!inner(phone_number_id)`)
    .eq("company_id", c.get("companyId"))
    .is("conversations.deleted_at", null)
    .is("conversations.purged_at", null);
  if (conversationId) query = query.eq("conversation_id", conversationId);
  if (access.hiddenNumberIds !== null && access.hiddenNumberIds.length > 0) {
    // A thread with no number is not on a denied one, so it stays visible —
    // the same rule `levelFor` applies, kept in step by construction.
    query = query.or(
      `phone_number_id.is.null,phone_number_id.not.in.(${access.hiddenNumberIds.join(",")})`,
      { referencedTable: "conversations" },
    );
  }

  const rows = unwrap<QuoteRow[]>(
    await query
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
    data: filtered.map((row: QuoteRow) => withEffectiveStatus(row, now, c.get("role"))),
    next_cursor: null,
  });
});

quotesRoutes.get("/quotes/:id", requireCapability("conversations.read"), async (c) => {
  const id = pathUuid(c, "id");
  const db = getDb(getEnv(c.env));
  const rows = unwrap<unknown>(
    await db
      .from("quotes")
      .select(QUOTE_COLUMNS)
      .eq("company_id", c.get("companyId"))
      .eq("id", id)
      .limit(1),
    "quote read",
  ) as QuoteRow[];
  /*
   * #106 — checked AFTER the row is found, because the check needs the
   * conversation the quote hangs off. Both failures answer "No such
   * conversation", so a denied member cannot tell a quote they may not see
   * from one that does not exist.
   */
  if (rows[0]) {
    await requireConversationAccess(db, {
      companyId: c.get("companyId"),
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId: rows[0].conversation_id,
      need: "read",
    });
  }
  const [row] = rows;
  if (!row) return errorResponse(c, "not_found", "no such quote");
  return c.json(withEffectiveStatus(row, new Date(), c.get("role")));
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
  const conversations = unwrap<{ id: string; contact_id: string | null }[]>(
    await db
      .from("conversations")
      .select("id,contact_id")
      .eq("company_id", companyId)
      .eq("id", body.conversation_id)
      .limit(1),
    "quote conversation check",
  );
  const [conversation] = conversations;
  if (!conversation) {
    return errorResponse(c, "not_found", "no such conversation");
  }
  /*
   * #106 — a quote is a draft of a text, so drafting one on a thread this
   * member cannot see is the first half of sending from a line they are
   * denied. 'read' rather than 'text': the draft itself reaches nobody, and
   * the send below asks for the level that does.
   */
  await requireConversationAccess(db, {
    companyId,
    userId: c.get("userId"),
    role: c.get("role"),
    conversationId: conversation.id,
    need: "read",
  });
  if (!conversation.contact_id) {
    // A thread with no contact has nobody to quote. Rare, and refused here
    // rather than written as a row with a dangling reference.
    return errorResponse(
      c,
      "conflict",
      "this conversation has no contact to quote",
    );
  }

  // The workspace's own billing currency, read once and used below.
  const [company] = unwrap<{ billing_currency: string | null }[]>(
    await db
      .from("companies")
      .select("billing_currency")
      .eq("id", companyId)
      .limit(1),
    "quote currency lookup",
  );

  const rows = unwrap<QuoteRow[]>(
    await db
      .from("quotes")
      .insert({
        company_id: companyId,
        conversation_id: body.conversation_id,
        contact_id: conversation.contact_id,
        amount_cents: body.amount_cents,
        currency: body.currency ?? billingCurrencyOf(company?.billing_currency),
        description: body.description,
        status: "draft",
        expires_at: body.expires_at,
        created_by: c.get("userId"),
      })
      .select(QUOTE_COLUMNS),
    "quote create",
  );

  return c.json(withEffectiveStatus(rows[0], new Date(), c.get("role")), 201);
});

/**
 * Send it: the moment a draft becomes an offer.
 *
 * Only carrier dispatch receives the live view URL. The customer page uses it
 * to get separate, single-use accept and decline credentials. All share the
 * quote's expiry.
 */
quotesRoutes.post(
  "/quotes/:id/send",
  requireCapability("conversations.send"),
  async (c) => {
    const id = pathUuid(c, "id");
    const companyId = c.get("companyId");
    const env = getEnv(c.env);
    const db = getDb(env);

    const [row] = unwrap<unknown>(
      await db
        .from("quotes")
        .select(QUOTE_COLUMNS)
        .eq("company_id", companyId)
        .eq("id", id)
        .limit(1),
      "quote send lookup",
    ) as QuoteRow[];
    if (!row) return errorResponse(c, "not_found", "no such quote");
    /*
     * #106 — this puts a text on the carrier from the conversation's number,
     * so it needs the same 'text' level any other send does. payments.ts:363
     * has asked for it on the identical act since it shipped; entering one rung
     * lower at gateOutboundSend meant this path skipped it entirely, and a
     * note-only member — the preset documented as 'no outbound texts' — could
     * send from a line they hold no text right on.
     */
    await requireConversationAccess(db, {
      companyId,
      userId: c.get("userId"),
      role: c.get("role"),
      conversationId: row.conversation_id,
      need: "text",
    });

    // The transition is ASKED, not assumed. Sending an accepted quote would
    // reopen a settled price; sending an expired one would offer a price the
    // business has already withdrawn. Checked against the EFFECTIVE status,
    // because nothing writes the expired one.
    const current = effectiveQuoteStatus(row, new Date());
    // #722: the shared machine says which states a quote may be sent from.
    if (!stateMachines.allowedActions(stateMachines.quoteMachine, current, c.get("role")).includes("send")) {
      return errorResponse(c, "conflict", `a quote that is ${current} cannot be sent`);
    }

    /*
     * The thread this is going into, and the number it goes out from. Read
     * BEFORE anything is minted: a quote that cannot be sent must not leave a
     * live accept link behind, and the cheapest refusals come first.
     */
    const [view] = unwrap<unknown>(
      await db
        .from("conversations")
        .select(
          "id,contact_phone_e164,phone_numbers(number_e164,status)," +
            // #228: the two rungs of the customer's language — their own
            // setting, then the workspace's. Read here rather than derived
            // later, because the text is composed from this one row.
            "companies(name,locale),contacts(locale)",
        )
        .eq("company_id", companyId)
        .eq("id", row.conversation_id)
        .limit(1),
      "quote send conversation",
    ) as SendView[];
    if (!view) return errorResponse(c, "not_found", "no such conversation");

    const fromNumber = view.phone_numbers.number_e164;
    if (!fromNumber || view.phone_numbers.status !== "active") {
      return errorResponse(
        c,
        "conflict",
        "this conversation's number can't send texts right now",
      );
    }

    /*
     * EVERY OUTBOUND GATE, and this is the line that matters most in the whole
     * handler. `runPreSendGates` is where the opt-out check lives, and an
     * opt-out can only be lifted by the customer — a quote is a text to a
     * customer like any other, and a feature that sends around that rule is the
     * one that gets the number blocked.
     *
     * Before minting, for the reason the payment ask states: an opted-out
     * contact or a suspended workspace must never leave a live link behind.
     */
    const clearance = await runPreSendGates(env, companyId, view.contact_phone_e164);

    // #722: claim the draft with a lease, guarded in the WHERE clause rather
    // than trusting the read above: two people pressing send is two requests,
    // and only one may send. The quote stays a draft until the text has gone,
    // so a failed send has no status to undo.
    const now = new Date();
    if (Date.parse(row.expires_at) <= now.getTime()) {
      return errorResponse(c, "conflict", "Choose a future expiry for this quote.", {
        key: "apiRefusals.quoteExpiryFuture",
      });
    }
    const claimed = unwrap<{ id: string }[]>(
      await db
        .from("quotes")
        .update({ sending_at: now.toISOString() })
        .eq("company_id", companyId)
        .eq("id", id)
        .eq("status", "draft")
        .eq("updated_at", row.updated_at)
        .or(
          `sending_at.is.null,sending_at.lt.${new Date(now.getTime() - SEND_LEASE_MS).toISOString()}`,
        )
        .select("id"),
      "quote send claim",
    );
    if (claimed.length === 0) {
      return errorResponse(c, "conflict", "quote is no longer a draft");
    }

    const viewLink = await mintPublicLink(db, {
      companyId,
      purpose: "quote_view",
      subjectType: "quote",
      subjectId: id,
      expiresAt: new Date(row.expires_at),
      actorUserId: c.get("userId"),
    }).catch(async (error: unknown) => {
      await releaseSend(db, companyId, id);
      throw error;
    });

    // The carrier receives the live link. The app and integrations see a placeholder.
    const url = `${env.APP_ORIGIN.replace(/\/$/, "")}/q/${viewLink.token}`;
    const text = quoteSms({
      // #228: what the CUSTOMER reads, not what the crew does. A quote is the
      // first thing many of these people ever receive from the business, and
      // an English sentence around a French workspace's price is the version
      // of this feature that gets forwarded to a competitor.
      locale: resolveLocale(
        view.contacts?.locale ?? null,
        view.companies.locale ?? null,
      ),
      businessName: view.companies.name,
      amountCents: row.amount_cents,
      currency: billingCurrencyOf(row.currency),
      description: row.description,
      url,
    });

    /*
     * FROM HERE THE DRAFT IS CLAIMED, so every failure below releases it. The
     * claim comes FIRST on purpose: it is what makes two taps send one text,
     * and checking after the send would be a check-then-act with a carrier
     * call inside the race. An opted-out contact once left a quote claiming it
     * had been sent with no text anywhere; a quote now says `sent` only after
     * the text has gone.
     */
    let gated;
    try {
      gated = await gateOutboundSend(db, {
      env,
      companyId,
      conversationId: row.conversation_id,
      senderUserId: c.get("userId"),
      body: text,
      /*
       * THE QUOTE ID IS THE KEY, and it is exactly right rather than
       * convenient: one quote sends one text, ever. The `status = draft` guard
       * in the update above already refuses a second send, so a retry that
       * reaches here is the same intent — and a fresh key on a retry would text
       * the customer the same price twice.
       */
      idempotencyKey: id,
      // The same estimator every other send bills against — a URL makes this
      // reliably multi-segment and it is metered as what it is.
        segmentsEstimate: estimateSegments(text).segments,
      });
    } catch (error) {
      await releaseSend(db, companyId, id);
      throw error;
    }
    const {message} = gated;

    // The receipt: WHICH text carried this quote. #287 opens with "nobody can
    // answer what did we quote", and the answer is the message, not the row.
    await db
      .from("quotes")
      .update({ message_id: message.id, updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("id", id);

    try {
      const dispatched = await dispatchOutbound(env, db, message, {
        from: fromNumber,
        to: view.contact_phone_e164,
        text,
        mediaUrls: [],
        clearance,
      });
      if (!dispatched.telnyx_message_id) {
        await releaseSend(db, companyId, id);
        return errorResponse(c, "conflict", "The quote text failed. Retry it in the conversation.", {
          key: "apiRefusals.quoteTextRetry",
        });
      }
    } catch (error) {
      // The message row survives — the outbox owns retrying a carrier that was
      // briefly unreachable, and deleting it would lose the text. What must not
      // survive is a QUOTE that says it went out when the carrier refused it
      // outright.
      await releaseSend(db, companyId, id);
      throw error;
    }

    const sent = unwrap<QuoteRow[]>(
      await db
        .from("quotes")
        .update({ status: "sent", sent_at: new Date().toISOString(), sending_at: null })
        .eq("company_id", companyId)
        .eq("id", id)
        .eq("status", "draft")
        .select(QUOTE_COLUMNS),
      "quote send",
    );
    if (sent.length === 0) {
      return errorResponse(c, "conflict", "quote is no longer a draft");
    }

    await insertConversationEvents(db, [
      {
        company_id: companyId,
        conversation_id: row.conversation_id,
        actor_user_id: c.get("userId") ?? null,
        type: "quote_sent",
        payload: {
          quote_id: id,
          amount_cents: row.amount_cents,
          currency: row.currency,
          description: row.description,
        },
      },
    ]).catch((error: unknown) => {
      void reportHandledFailure(env, "quote-sent-event", error, {
        ids: { quoteId: row.id },
      });
    });

    return c.json({
      ...withEffectiveStatus(sent[0], new Date(), c.get("role")),
      message_id: message.id,
    });
  },
);
