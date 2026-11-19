import { Hono } from "hono";

import { effectiveQuoteStatus, isQuoteDecided, resolveLocale } from '@loonext/shared';
import type { QuoteState } from '@loonext/shared';

import type { AppEnv } from "../context";
import { getDb } from "../db";
import { getEnv } from "../env";
import { errorResponse } from "../http/errors";
import { notifyQuoteAccepted } from "../notifications/payment";
import { reportHandledFailure, workerEnv } from "../observability/capture";
import {
  callerCountry,
  publicLinkGuard,
  publicLinkNotAvailable,
} from "../public-links/guard";
import {
  mintPublicLink,
  resolvePublicLink,
} from "../public-links/tokens";
import { insertConversationEvents } from "./core/events";
import { unwrap } from "./core/http";
import { afterTaskCreated } from "../tasks/follow-ups";

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

/*
 * The accept path reads one more column than the customer is ever shown:
 * `conversation_id`, to tell the crew's thread that their quote was accepted.
 *
 * A separate constant rather than widening PUBLIC_COLUMNS, because that list
 * means "safe to put in front of a homeowner" and this id is not part of that
 * promise — it is ours, used on our side, and never in the response.
 */
const ACCEPT_COLUMNS = `${PUBLIC_COLUMNS},conversation_id,message_id,created_by`;

interface PublicQuoteRow extends QuoteState {
  /** Only populated on the accept path; see ACCEPT_COLUMNS. */
  conversation_id?: string;
  /** The text that carried this quote. Null for rows sent before #287's fix. */
  message_id?: string | null;
  /** The crew member who wrote it, and the actor a resulting job belongs to. */
  created_by?: string | null;
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

  const [row] = unwrap<unknown>(
    await db
      .from("quotes")
      .select(`${PUBLIC_COLUMNS},conversations!inner(),companies!inner(),contact:contacts!contact_id(locale)`)
      .eq("company_id", resolved.company_id)
      .eq("id", resolved.subject_id)
      .is("conversations.deleted_at", null)
      .is("conversations.purged_at", null)
      .is("companies.deleted_at", null)
      .limit(1),
    "public quote lookup",
  ) as (PublicQuoteRow & { contact: { locale: string | null } | null })[];
  // A token that resolves to a row that is gone is the same answer as a token
  // that never existed. Saying otherwise confirms the id was once real.
  if (!row) return publicLinkNotAvailable(c);

  const [company] = unwrap<{ name: string; locale: string | null }[]>(
    await db
      .from("companies")
      .select("name,locale")
      .eq("id", resolved.company_id)
      .is("deleted_at", null)
      .limit(1),
    "public quote company",
  );
  if (!company) return publicLinkNotAvailable(c);

  const now = new Date();
  const status = effectiveQuoteStatus(row, now);
  const canAccept = status === "sent" || status === "viewed";

  /*
   * Minted BEFORE the view stamp below, which moves `sent` to `viewed` —
   * both are acceptable states, so the order does not change the answer, but
   * reading the status once and using it twice is what keeps that true.
   *
   * Expiry rides the quote's own deadline: this credential must not outlive
   * the offer it accepts. `maxUses: 1` because accepting twice is not a thing
   * a customer does, and a credential that survives its use is one that can be
   * replayed out of a browser history or a shared screenshot.
   */
  const acceptToken = canAccept
    ? (
        await mintPublicLink(db, {
          companyId: resolved.company_id,
          purpose: "quote_accept",
          subjectType: "quote",
          subjectId: row.id,
          expiresAt: new Date(row.expires_at),
          maxUses: 1,
          actorUserId: null,
        })
      ).token
    : null;

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
    locale: resolveLocale(row.contact?.locale, company.locale),
    business_name: company.name,
    amount_cents: row.amount_cents,
    currency: row.currency,
    description: row.description,
    status,
    expires_at: row.expires_at,
    /** Whether pressing accept would do anything, decided here not on a client. */
    can_accept: canAccept,
    accept_token: acceptToken,
  });
});

/** Accept using a single-use credential issued by the public quote page. */
publicQuoteRoutes.post("/q/:token/accept", publicLinkGuard(), async (c) => {
  const body = await c.req.json<{ name?: unknown }>().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (name.length === 0 || name.length > 120) {
    return errorResponse(c, "validation_failed", "Enter your name to accept this quote.", {
      key: "quotes.acceptNameRequired",
    });
  }

  const env = getEnv(c.env);
  const db = getDb(env);
  const country = callerCountry(c);
  const resolved = await resolvePublicLink(
    db,
    c.req.param("token"),
    "quote_accept",
    country,
  );
  if (!resolved.ok || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }

  const [row] = unwrap<PublicQuoteRow[]>(
    await db
      .from("quotes")
      .select(`${ACCEPT_COLUMNS},conversations!inner(),companies!inner()`)
      .eq("company_id", resolved.company_id)
      .eq("id", resolved.subject_id)
      .is("conversations.deleted_at", null)
      .is("conversations.purged_at", null)
      .is("companies.deleted_at", null)
      .limit(1),
    "public quote accept lookup",
  );
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
        decided_by_name: name,
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

  try {
    const { error } = await db.from("public_links")
      .update({ revoked_at: now.toISOString(), revoke_reason: "quote accepted" })
      .eq("company_id", resolved.company_id)
      .eq("subject_type", "quote")
      .eq("subject_id", row.id)
      .eq("purpose", "quote_accept")
      .is("revoked_at", null);
    if (error) throw new Error(error.message);
  } catch (error) {
    void reportHandledFailure(workerEnv(), "quote-link-revocation", error, {
      ids: { quoteId: row.id },
    });
  }

  /*
   * #287 — AND THE CREW IS TOLD.
   *
   * The customer accepts on a page nobody in the workspace is looking at, so
   * without this the only trace is a status on a row. The issue's own words:
   * "Acceptance is verbal. 'Yeah go ahead' in a text thread is what we have
   * instead of a record, which is fine until it isn't." This is the record, and
   * it lands in the one place both sides already look.
   *
   * NO actor_user_id. The customer is not a member, and attributing their
   * decision to whichever crew member happened to send the quote would be a
   * false record of who said yes — on exactly the artefact that exists to
   * settle that question later.
   *
   * Best-effort, and deliberately AFTER the accept has committed. The
   * acceptance is the customer's and is already durable; failing their request
   * because our own timeline write failed would tell them the price was not
   * accepted when it was.
   */
  await insertConversationEvents(db, [
    {
      company_id: resolved.company_id,
      conversation_id: row.conversation_id ?? null,
      actor_user_id: null,
      type: "quote_accepted",
      payload: {
        quote_id: row.id,
        amount_cents: row.amount_cents,
        currency: row.currency,
        description: row.description,
        ip_country: country,
      },
    },
  ]).catch((error: unknown) => {
    void reportHandledFailure(workerEnv(), "quote-accepted-event", error, {
      ids: { quoteId: row.id },
    });
  });

  if (row.conversation_id) {
    await notifyQuoteAccepted(env, {
      companyId: resolved.company_id,
      conversationId: row.conversation_id,
      quoteId: row.id,
    }, db).catch((error: unknown) => {
      void reportHandledFailure(env, "quote-accepted-notification", error, {
        ids: { quoteId: row.id },
      });
    });
  }

  /*
   * #287 — AND THE WORK STARTS.
   *
   * "Accepted quote becomes a job, so acceptance flows into the work rather
   * than stopping at a status." A won job that exists only as a status is one
   * somebody has to notice and re-type into the task list, which is where it
   * gets forgotten between the yes and the van.
   *
   * THE TASK HANGS OFF THE TEXT THAT CARRIED THE QUOTE. Tasks promote a real
   * message by design (T0.1 cut standalone ones, because completion derives
   * from `messages.done_at`), and the message the customer received is the
   * right one: it is the artefact the job was agreed from.
   *
   * THE ACTOR IS THE QUOTE'S AUTHOR, not the customer. A customer is not a
   * member and cannot own a task; the person who wrote the price is the person
   * whose work this became.
   *
   * NO ADDRESS, deliberately. #287 asks for "a task with the address and the
   * agreed scope" and the scope transfers cleanly — it is the description the
   * customer agreed to. The address does not: a contact's is freeform text and
   * a task's is structured fields, and #214's enrichment is the thing that
   * turns one into the other under review. Guessing the mapping here would put
   * an unreviewed address on a job somebody drives to.
   *
   * Best-effort and last. The acceptance is the customer's and is already
   * durable; failing their request because our own bookkeeping failed would
   * tell them the price was not accepted when it was.
   */
  if (row.message_id && row.created_by) {
    const { data, error } = await db.rpc("create_task", {
      p_company_id: resolved.company_id,
      p_message_id: row.message_id,
      // The scope, in the customer's own agreed words.
      p_title: row.description.slice(0, 200),
      p_description: null,
      p_assigned_user_id: null,
      p_due_at: null,
      p_actor_user_id: row.created_by,
      p_addr_street: null,
      p_addr_unit: null,
      p_addr_city: null,
      p_addr_state: null,
      p_addr_postal_code: null,
      p_addr_country: null,
      p_addr_provenance: null,
    });
    if (error) {
      void reportHandledFailure(workerEnv(), "quote-accepted-job", error, {
        ids: { quoteId: row.id },
      });
    }
    const result = data as { outcome: string; task?: Record<string, unknown> } | null;
    if (!error && result?.outcome === "created" && result.task) {
      await afterTaskCreated(c, {
        companyId: resolved.company_id,
        userId: row.created_by,
        task: result.task,
        assigneeIds: [],
      });
    }
  }

  return c.json({ accepted: true, status: "accepted" });
});

/** Exported for the tests, which assert the decided-quote guard directly. */
export const quoteIsAnswerable = (quote: QuoteState, now: Date): boolean =>
  !isQuoteDecided(effectiveQuoteStatus(quote, now));
