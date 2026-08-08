/**
 * conversation_events helpers (SPEC §6): the audit timeline for
 * status/assign/tag/opt-out/consent changes. Contact-level events
 * (opted_out, opt_out_revoked, consent_attested) attach to the most recent
 * conversation for the (company, contact) pair when one exists, and carry
 * conversation_id NULL otherwise — the schema CHECK permits null only for
 * those types.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { unwrap } from "./http";

export type ConversationEventType =
  | "status_changed"
  | "assigned"
  | "tag_added"
  | "tag_removed"
  | "opted_out"
  | "opt_out_revoked"
  | "consent_attested"
  | "quiet_hours_confirmed"
  | "spam_marked"
  | "spam_unmarked"
  // D22 / TASKS.md T8 — done-audit + task lifecycle. `message_done` /
  // `message_undone` are written by the D14 PATCH /v1/messages/:id handler on
  // real done↔undone transitions; the `task_*` types by the D17 tasks routes.
  // The canonical enum-literal list lives in TASKS.md T8; the schema-track
  // migration ADDs these values to conversation_event_type. Every one always
  // carries a non-null conversation_id (a message/task belongs to a thread),
  // so the shipped conversation_events_conv_required CHECK is satisfied as-is.
  | "message_done"
  | "message_undone"
  | "task_created"
  | "task_assigned"
  | "task_due_set"
  | "task_deleted"
  // D19/D22 — attachment lifecycle, written by the storage track
  // (routes/attachments.ts) on the owner note/task's conversation. Both always
  // carry a non-null conversation_id, so the shipped conv-required CHECK holds.
  | "note_attachment_added"
  | "note_attachment_removed"
  | "task_attachment_added"
  | "task_attachment_removed"
  // #317 — an inbound attachment we declined to store, written by
  // messaging/inbound.ts. There is no attachment row to carry a status, because
  // the whole point is that we did not create one; this is the record. Always
  // carries `reason` (a MediaRefusalReason) so the clients can say WHICH way it
  // failed, and never a null conversation_id (a refused file belongs to a
  // threaded message), so the conv-required CHECK holds as-is.
  | "media_refused"
  // #554 — the five below were in the SQL enum and MISSING FROM THIS UNION, and
  // that gap is why #554 happened rather than a detail beside it.
  //
  // A value this type cannot express is a value whose writer has to bypass
  // `insertConversationEvents` and hand an untyped object literal to PostgREST.
  // Both writers of the two NEW values did exactly that, so tsc had nothing to
  // check and the missing enum value only ever surfaced as a caught-and-logged
  // runtime error. Every one of these is now here, and
  // `scripts/check-conversation-events.mjs` fails the build if this list and the
  // migrations ever disagree again — in EITHER direction, because both are bugs:
  // a value here but not in SQL is an insert that will throw, and a value in SQL
  // but not here is the next writer being pushed off the typed path.
  | "auto_reply_sent"
  | "review_requested"
  | "missed_call"
  | "call_completed"
  | "emergency_flagged"
  // #554 — and the two the enum was actually missing. A customer's rating now
  // reaches the thread; before this it was recorded and never mentioned.
  | "appointment_confirmed"
  | "job_rated";

export interface ConversationEventRow {
  company_id: string;
  conversation_id: string | null;
  actor_user_id: string | null;
  type: ConversationEventType;
  payload: Record<string, unknown>;
}

/** Insert timeline rows (one per changed field — SPEC §7). No-op on []. */
export async function insertConversationEvents(
  db: SupabaseClient,
  rows: ConversationEventRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("conversation_events").insert(rows);
  if (error) {
    throw new Error(`conversation_events insert failed: ${error.message}`);
  }
}

/**
 * Most recent conversation for a contact (by last_message_at), or null when
 * the contact has none — the SPEC §6 attachment rule for contact-level events.
 */
export async function latestConversationId(
  db: SupabaseClient,
  companyId: string,
  contactId: string,
): Promise<string | null> {
  const rows = unwrap<{ id: string }[]>(
    await db
      .from("conversations")
      .select("id")
      .eq("company_id", companyId)
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1),
    "latest conversation lookup",
  );
  return rows[0]?.id ?? null;
}
