import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "../audit/log";

import { scoreContent } from "./spam-signals";

/**
 * [#250] The database half of inbound spam handling.
 *
 * Two mechanisms with deliberately different powers:
 *
 * - A **block** is a decision a person made, so it acts: the thread is marked
 *   spam and closed on arrival.
 * - A **suspicion** is the machine's guess, so it only badges. It writes
 *   `spam_suspected_at`, never `is_spam`, and the single behavioural
 *   consequence is that we do not wake somebody's phone.
 *
 * Everything here is best-effort. The inbound message is already durable by
 * the time these run, and a classifier failure must never wedge it in a retry
 * loop — the same rule `looksLikeOptOut` follows in inbound.ts.
 */

/** What the inbound path needs to know after classification. */
export interface SpamOutcome {
  /** A person blocked this sender: the thread was marked spam and closed. */
  blocked: boolean;
  /** The classifier scored above the threshold: badge it, do not push. */
  suspected: boolean;
}

const NOT_SPAM: SpamOutcome = { blocked: false, suspected: false };

/**
 * Has this workspace ever texted this thread, and does the contact carry a
 * name somebody typed?
 *
 * Both are evidence of a RELATIONSHIP, which outranks every content signal.
 * The distinction matters because the threading RPC creates a contact row for
 * any sender — so "a contact exists" means nothing, while "a contact has a
 * name" means a human saved them.
 */
async function relationship(
  db: SupabaseClient,
  companyId: string,
  conversationId: string,
): Promise<{ knownContact: boolean; hasPriorOutbound: boolean }> {
  const [outbound, conversation] = await Promise.all([
    db
      .from("messages")
      .select("id")
      .eq("company_id", companyId)
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .limit(1),
    db
      .from("conversations")
      .select("contacts(name)")
      .eq("company_id", companyId)
      .eq("id", conversationId)
      .maybeSingle(),
  ]);

  const contact = conversation.data?.contacts as { name?: string | null } | null;
  const name = contact?.name?.trim() ?? "";
  return {
    knownContact: name !== "",
    hasPriorOutbound: (outbound.data?.length ?? 0) > 0,
  };
}

/**
 * Classify one inbound message and record the outcome.
 *
 * Returns what happened so the caller can skip the notification fan-out
 * without re-reading the row it just wrote.
 */
export async function classifyInbound(
  db: SupabaseClient,
  args: {
    companyId: string;
    conversationId: string;
    fromE164: string;
    body: string | null | undefined;
  },
): Promise<SpamOutcome> {
  try {
    // A block is checked first and short-circuits: if a person already said
    // "never again", there is nothing for a classifier to weigh.
    const { data: blocked } = await db
      .from("blocked_senders")
      .select("id")
      .eq("company_id", args.companyId)
      .eq("phone_e164", args.fromE164)
      .maybeSingle();

    if (blocked) {
      await db
        .from("conversations")
        .update({
          is_spam: true,
          status: "closed",
          closed_at: new Date().toISOString(),
        })
        .eq("id", args.conversationId)
        .eq("company_id", args.companyId);
      // The actor is the CONTACT arriving, not a member — nobody pressed
      // anything today. The block itself was audited when it was created.
      await recordAudit(db, {
        companyId: args.companyId,
        actorUserId: null,
        action: "spam.blocked_sender_arrived",
        targetType: "conversation",
        targetId: args.conversationId,
        after: { from: args.fromE164 },
      });
      return { blocked: true, suspected: false };
    }

    // Content first, because it needs no database. An ordinary customer text
    // produces no signals at all, so the overwhelming majority of inbound —
    // the real ones — leaves here having asked Postgres nothing beyond the
    // block check above. The relationship lookup is only worth its two
    // queries once the body already looks wrong.
    const verdict = scoreContent(args.fromE164, args.body);
    if (!verdict.suspected) return NOT_SPAM;

    // It reads like a robotext. Now the expensive question: do we actually
    // know this person? A relationship outranks every content signal, and a
    // regular customer forwarding a marketing text is not a spammer.
    const { knownContact, hasPriorOutbound } = await relationship(
      db,
      args.companyId,
      args.conversationId,
    );
    if (knownContact || hasPriorOutbound) return NOT_SPAM;

    await db
      .from("conversations")
      .update({
        spam_suspected_at: new Date().toISOString(),
        spam_signals: verdict.signals,
      })
      .eq("id", args.conversationId)
      .eq("company_id", args.companyId);

    await recordAudit(db, {
      companyId: args.companyId,
      actorUserId: null,
      action: "spam.suspected",
      targetType: "conversation",
      targetId: args.conversationId,
      after: {
        from: args.fromE164,
        score: verdict.score,
        signals: verdict.signals.map((signal) => signal.key),
      },
    });

    return { blocked: false, suspected: true };
  } catch (cause) {
    // Never wedge a durable inbound message over a badge.
    console.error(
      `spam classification for conversation ${args.conversationId} failed:`,
      cause instanceof Error ? cause.message : String(cause),
    );
    return NOT_SPAM;
  }
}
