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
import type { Locale } from "@loonext/shared";

import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "../routes/core/http";

const SIX_DAYS_MS = 6 * 86_400_000;
const NONBREAKING_SPACES = /[\u00A0\u202F]/g;

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
    jobTaskId?: string;
    /** The member sending it, for {my_name}. */
    userId?: string | null;
    /** The contact's timezone, so {job_day}/{job_time} read in THEIR day. */
    timeZone?: string | null;
    locale?: Locale;
    now?: Date;
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
          .from("profiles")
          .select("display_name")
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
    try {
      const now = input.now ?? new Date();
      const tasks = db.from("tasks")
        .select("due_at")
        .eq("company_id", input.companyId)
        .eq("conversation_id", input.conversationId)
        .is("deleted_at", null);
      const visit = input.jobTaskId === undefined
        ? tasks.is("task_done_at", null)
          .gte("due_at", now.toISOString())
          .order("due_at", { ascending: true })
        : tasks.eq("id", input.jobTaskId);
      const rows = unwrap<{ due_at: string | null }[]>(
        await visit.limit(1),
        "merge job time",
      );
      const dueAt = rows[0]?.due_at ?? null;
      if (dueAt !== null) {
        const timeZone = input.timeZone ?? "UTC";
        const locale = input.locale === "fr-CA" ? "fr-CA" : "en-CA";
        const when = new Date(dueAt);
        const includeDate = when.getTime() - now.getTime() > SIX_DAYS_MS;
        ctx.jobDay = new Intl.DateTimeFormat(locale, {
          weekday: "long",
          timeZone,
          ...(includeDate ? { month: "numeric", day: "numeric" } : {}),
        }).format(when).replaceAll(NONBREAKING_SPACES, " ");
        const time = new Intl.DateTimeFormat(locale, {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        }).format(when).replaceAll(NONBREAKING_SPACES, " ");
        ctx.jobTime = locale === "fr-CA" ? time.replace(/ h 00$/, " h") : time;
      }
    } catch {
      // Best effort, as above.
    }
  }

  return ctx;
}
