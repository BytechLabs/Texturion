/**
 * "Sam, does this look familiar?" — the alert for a teammate named on an
 * internal note.
 *
 * Assigning a thread is the coarse tool: it moves the whole conversation onto
 * one person. A mention is the fine one, and it is the only crew alert in the
 * product aimed at named individuals rather than a derived audience.
 *
 * PUSH-ONLY, deliberately (the missed-call posture, D45). `notification_prefs`
 * has one email switch and it means "a customer texted us"; spending it on
 * mentions would mail people who never asked for this.
 *
 * ACCESS is re-checked HERE, not trusted from the route. The route validated
 * the ids before writing them, but membership and number access can change
 * between a note being written and this running, and a note body quotes
 * customer text. The check is the same one the route used, so a member who
 * lost access in that window is simply not told.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { listConversationViewers } from "../auth/conversation-audience";
import { getDb } from "../db";
import type { Env } from "../env";

import { deliverPush } from "./deliver";
import { notificationSnippet } from "./inbound";

export interface NoteMentionNotificationInput {
  companyId: string;
  conversationId: string;
  /** The note itself: the collapse key and the deep link both point at it. */
  messageId: string;
  authorUserId: string;
  mentionedUserIds: string[];
  /** The note body, trimmed into the alert's snippet. */
  body: string;
}

interface ConversationView {
  id: string;
  phone_number_id: string | null;
}

interface PrefsRow {
  user_id: string;
  push_enabled: boolean;
}

function unwrapRows<T>(
  result: { data: unknown; error: { message: string } | null },
  what: string,
): T[] {
  if (result.error) throw new Error(`${what} failed: ${result.error.message}`);
  return (result.data ?? []) as T[];
}

export async function notifyNoteMention(
  env: Env,
  input: NoteMentionNotificationInput,
  db: SupabaseClient = getDb(env),
): Promise<void> {
  if (input.mentionedUserIds.length === 0) return;

  const conversations = unwrapRows<ConversationView>(
    await db
      .from("conversations")
      .select("id,phone_number_id")
      .eq("company_id", input.companyId)
      .eq("id", input.conversationId)
      .limit(1),
    "conversation lookup",
  );
  const conversation = conversations[0];
  if (!conversation) {
    throw new Error(
      `note mention alert: conversation ${input.conversationId} vanished`,
    );
  }

  const viewers = await listConversationViewers(db, {
    companyId: input.companyId,
    phoneNumberId: conversation.phone_number_id,
  });
  const canSee = new Set(viewers.map((row) => row.user_id));
  // Naming yourself is not an alert.
  const audience = [...new Set(input.mentionedUserIds)].filter(
    (userId) => userId !== input.authorUserId && canSee.has(userId),
  );
  if (audience.length === 0) return;

  const prefRows = unwrapRows<PrefsRow>(
    await db
      .from("notification_prefs")
      .select("user_id,push_enabled")
      .eq("company_id", input.companyId)
      .in("user_id", audience),
    "notification prefs lookup",
  );
  const prefs = new Map(prefRows.map((row) => [row.user_id, row]));
  const pushUsers = audience.filter(
    (userId) => prefs.get(userId)?.push_enabled ?? true,
  );
  if (pushUsers.length === 0) return;

  const authors = unwrapRows<{ user_id: string; display_name: string | null }>(
    await db
      .from("profiles")
      .select("user_id,display_name")
      .eq("user_id", input.authorUserId)
      .limit(1),
    "note author lookup",
  );
  const authorName = authors[0]?.display_name?.trim() || "A teammate";

  const failures: unknown[] = [];
  await deliverPush(env, db, {
    category: "mentions",
    companyId: input.companyId,
    userIds: pushUsers,
    // #430: a note is written by a colleague, not a customer — but it is
    // written ABOUT a customer and routinely quotes the address or the
    // situation, so it is a person's words either way. The title survives:
    // knowing who wants you is the whole point of a mention.
    content: {
      written: "people",
      companyId: input.companyId,
      withheld: { body: "Mentioned you in a note" },
    },
    web: {
      title: `${authorName} mentioned you`,
      body: notificationSnippet(input.body, 0),
      url: `${env.APP_ORIGIN}/inbox/${input.conversationId}`,
    },
    // Per NOTE, not per conversation: two mentions in one thread are two
    // separate asks and must not replace each other.
    collapseKey: `mention:${input.messageId}`,
    failures,
  });

  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `note mention alert: ${failures.length} delivery step(s) failed for note ${input.messageId}`,
    );
  }
}
