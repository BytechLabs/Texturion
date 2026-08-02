/**
 * Server-side canonical merge-field application for the send path
 * (FEATURE-GAPS Step 0a). Applied at SEND time to composed messages, saved
 * replies pasted into the composer, and the away-reply — all of them — so the
 * tokens resolve from the SAME canonical substituter the clients preview with
 * (@loonext/shared).
 *
 * It reuses the contact + company already loaded on the send path (no extra
 * query per send): callers pass the fields they already hold. Unknown/empty
 * tokens degrade gracefully (the token is dropped cleanly — never a literal
 * `{first_name}` on the wire) — that logic lives in @loonext/shared.
 *
 * # #274: the three tokens that cost a read
 *
 * `{my_name}`, `{job_day}` and `{job_time}` cannot be answered from what the
 * send path already holds. Resolving them eagerly would put two reads on EVERY
 * send for a feature a minority of messages use, so `resolveSendMergeFields`
 * asks `mergeFieldsNeeded` what the text actually wants and fetches only that.
 * A message with no tokens — the overwhelming majority — does no work at all.
 */
import { applyMergeFields, mergeFieldsNeeded } from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "../routes/core/http";

/** The already-loaded contact + company slice a merge needs. */
export interface MergeContext {
  contactName?: string | null;
  businessName?: string | null;
  /** #274: the contact's service address, when the caller already has it. */
  contactAddress?: string | null;
  /** #274: the workspace number to reply to, already formatted for reading. */
  ourNumber?: string | null;
  /** #274: the sending member's display name. */
  senderName?: string | null;
  /** #274: the next scheduled visit, split the way a sentence uses it. */
  jobDay?: string | null;
  jobTime?: string | null;
}

/**
 * Substitute merge fields in `body` using data already on the send path. Pure;
 * no I/O. Returns `body` unchanged when it carries no tokens.
 */
export function applySendMergeFields(body: string, ctx: MergeContext): string {
  return applyMergeFields(body, {
    contactName: ctx.contactName ?? null,
    businessName: ctx.businessName ?? null,
    contactAddress: ctx.contactAddress ?? null,
    ourNumber: ctx.ourNumber ?? null,
    senderName: ctx.senderName ?? null,
    jobDay: ctx.jobDay ?? null,
    jobTime: ctx.jobTime ?? null,
  });
}

/**
 * #274 — fill in the parts of a merge context that need a read, and only when
 * the text asks for them.
 *
 * Returns a context to spread over what the caller already holds. Every lookup
 * is best-effort: a merge field that cannot be resolved drops cleanly by
 * design, so a failed read costs a token, never a send.
 */
export async function resolveSendMergeFields(
  db: SupabaseClient,
  body: string,
  input: {
    companyId: string;
    conversationId?: string | null;
    /** The member sending it, for {my_name}. */
    userId?: string | null;
    /** The contact's timezone, so {job_day}/{job_time} read in THEIR day. */
    timeZone?: string | null;
  },
): Promise<MergeContext> {
  const needed = mergeFieldsNeeded(body);
  if (needed.size === 0) return {};

  const ctx: MergeContext = {};

  if (needed.has("my_name") && input.userId) {
    // The member's own name. One read, and only for a message that signs off.
    try {
      const rows = unwrap<{ display_name: string | null }[]>(
        await db
          .from("company_members")
          .select("display_name")
          .eq("company_id", input.companyId)
          .eq("user_id", input.userId)
          .limit(1),
        "merge sender name",
      );
      ctx.senderName = rows[0]?.display_name ?? null;
    } catch {
      // Best effort: the token drops, the message still goes.
    }
  }

  if ((needed.has("job_day") || needed.has("job_time")) && input.conversationId) {
    /**
     * The next scheduled visit IS the next open task with a due date on this
     * conversation. That is not a stand-in for an appointment model we have not
     * built — in this product a due-dated task is exactly what a crew books,
     * and inventing a second scheduled thing beside it would leave two answers
     * to "when are you coming".
     */
    try {
      // Completion DERIVES from the source message (D17), so "open" is a
      // filter on the joined message rather than a column on the task —
      // `tasks.done_at` does not exist, and asking for it 400s at PostgREST.
      const rows = unwrap<{ due_at: string | null }[]>(
        await db
          .from("tasks")
          .select("due_at,messages!message_id!inner(id,done_at)")
          .eq("company_id", input.companyId)
          .eq("conversation_id", input.conversationId)
          .is("messages.done_at", null)
          .not("due_at", "is", null)
          .order("due_at", { ascending: true })
          .limit(1),
        "merge next visit",
      );
      const dueAt = rows[0]?.due_at ?? null;
      if (dueAt !== null) {
        // In the CONTACT'S zone, not the workspace's. "Tuesday at 2" has to be
        // the customer's Tuesday — the whole message is a promise to them.
        const zone = input.timeZone ?? "UTC";
        const when = new Date(dueAt);
        ctx.jobDay = new Intl.DateTimeFormat("en-CA", {
          weekday: "long",
          timeZone: zone,
        }).format(when);
        ctx.jobTime = new Intl.DateTimeFormat("en-CA", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: zone,
        }).format(when);
      }
    } catch {
      // Best effort, as above.
    }
  }

  return ctx;
}
