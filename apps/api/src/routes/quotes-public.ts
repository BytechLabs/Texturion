import { Hono } from "hono";

import { effectiveQuoteStatus, resolveLocale } from '@loonext/shared';
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
  hashToken,
  issueQuoteDecisionToken,
  resolvePublicLink,
} from "../public-links/tokens";
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
 * evidence rather than a hint. The original view link for a withdrawn quote
 * is allowed to show the withdrawal notice until the link expires.
 *
 * # Viewing is recorded, and viewing is not answering
 *
 * A `viewed` quote is the most useful row in the outstanding queue: the
 * customer opened it and still has not replied, which is the difference
 * between chasing and waiting. It is set once, on first view, and never
 * overwrites a decision.
 */

const PUBLIC_COLUMNS =
  "id,amount_cents,currency,description,status,expires_at,viewed_at,decided_at,decision_version";

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
  decision_version: number;
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
  const viewToken = c.req.param("token");
  const resolved = await resolvePublicLink(
    db,
    viewToken,
    "quote_view",
    callerCountry(c),
  );
  if (resolved.outcome === "revoked") {
    const withdrawal = unwrap<{ contact_locale: string | null; company_locale: string | null } | null>(
      await db.rpc("api_public_quote_withdrawal", { p_token_hash: await hashToken(viewToken) }),
      "public quote withdrawal",
    );
    if (withdrawal) {
      return c.json({
        withdrawn: true,
        status: "withdrawn",
        locale: resolveLocale(withdrawal.contact_locale, withdrawal.company_locale),
      });
    }
  }
  if (!resolved.ok || !resolved.link_id || !resolved.subject_id || !resolved.company_id) {
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
  const [acceptToken, declineToken] = status === "sent" || status === "viewed"
    ? await Promise.all([
      issueQuoteDecisionToken(db, viewToken, resolved.link_id, "quote_accept", row.decision_version),
      issueQuoteDecisionToken(db, viewToken, resolved.link_id, "quote_decline", row.decision_version),
    ])
    : [null, null];

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
    can_accept: acceptToken !== null,
    accept_token: acceptToken,
    decline_token: declineToken,
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
  if (!resolved.ok || !resolved.link_id || !resolved.subject_id || !resolved.company_id) {
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

  const accepted = unwrap<boolean>(await db.rpc("api_record_quote_decision", {
    p_company_id: resolved.company_id,
    p_quote_id: row.id,
    p_decision: "accepted",
    p_actor: null,
    p_link_id: resolved.link_id,
    p_name: name,
    p_reason: null,
    p_country: country,
  }), "quote acceptance");
  if (!accepted) {
    const [current] = unwrap<QuoteState[]>(await db.from("quotes").select("status,expires_at")
      .eq("company_id", resolved.company_id).eq("id", row.id).limit(1), "quote decision lookup");
    if (!current) return publicLinkNotAvailable(c);
    const currentStatus = effectiveQuoteStatus(current, now);
    return c.json({ accepted: currentStatus === "accepted", status: currentStatus }, currentStatus === "accepted" ? 200 : 409);
  }

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

publicQuoteRoutes.post("/q/:token/decline", publicLinkGuard(), async (c) => {
  const db = getDb(getEnv(c.env));
  const country = callerCountry(c);
  const resolved = await resolvePublicLink(db, c.req.param("token"), "quote_decline", country);
  if (!resolved.ok || !resolved.link_id || !resolved.subject_id || !resolved.company_id) {
    return publicLinkNotAvailable(c);
  }
  const declined = unwrap<boolean>(await db.rpc("api_record_quote_decision", {
    p_company_id: resolved.company_id,
    p_quote_id: resolved.subject_id,
    p_decision: "declined",
    p_actor: null,
    p_link_id: resolved.link_id,
    p_name: null,
    p_reason: null,
    p_country: country,
  }), "public quote decline");
  return c.json({ declined }, declined ? 200 : 409);
});
