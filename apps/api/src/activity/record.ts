/**
 * #714: the route-side writer of record_activity.
 *
 * Almost every event is written by a database trigger (a text, a call, a
 * contact edit, a task change, an assignment, an opt-out, a block), because the
 * trigger fires for every writer, including crons, webhooks and the importer.
 * What a trigger cannot see is the few writes that carry no actor column: tagging
 * a contact, lifting a block, naming a teammate in a comment. Those routes call
 * this, and `record-activity-guard.test.ts` fails when a mutating route of a
 * contact, task, conversation or call neither calls it nor is covered by a
 * named trigger.
 *
 * An event that fails to record is logged and never fails the request: the
 * change it describes has already been saved.
 */
import type { getDb } from "../db";

type Db = ReturnType<typeof getDb>;

export type ActivityRecordType = "contact" | "task" | "conversation" | "call";

export type ActivityKind =
  | "text_in"
  | "text_out"
  | "scheduled_queued"
  | "scheduled_sent"
  | "scheduled_cancelled"
  | "call"
  | "voicemail"
  | "created"
  | "edited"
  | "tagged"
  | "untagged"
  | "merged"
  | "unmerged"
  | "deleted"
  | "restored"
  | "assigned"
  | "unassigned"
  | "mentioned"
  | "referenced"
  | "opted_out"
  | "opted_in"
  | "blocked"
  | "unblocked"
  | "task_created"
  | "task_completed"
  | "completed"
  | "reopened";

export interface ActivityWrite {
  companyId: string;
  recordType: ActivityRecordType;
  recordId: string | null | undefined;
  kind: ActivityKind;
  /** The member who acted. Null for the customer, an automation or the system. */
  actorUserId?: string | null;
  actorType?: "customer" | "automation" | "system";
  payload?: Record<string, unknown>;
  sourceType?:
    | "message"
    | "call"
    | "task"
    | "task_comment"
    | "conversation_event"
    | "scheduled_message"
    | "contact"
    | "conversation";
  sourceId?: string | null;
  conversationId?: string | null;
  phoneNumberId?: string | null;
  dedupe?: string | null;
}

export async function recordActivity(db: Db, write: ActivityWrite): Promise<void> {
  if (!write.recordId) return;
  try {
    const { error } = await db.rpc("record_activity_add", {
      p_company_id: write.companyId,
      p_record_type: write.recordType,
      p_record_id: write.recordId,
      p_kind: write.kind,
      p_actor_user_id: write.actorUserId ?? null,
      p_actor_type: write.actorType ?? "system",
      p_payload: write.payload ?? {},
      p_source_type: write.sourceType ?? null,
      p_source_id: write.sourceId ?? null,
      p_conversation_id: write.conversationId ?? null,
      p_phone_number_id: write.phoneNumberId ?? null,
      p_at: null,
      p_dedupe: write.dedupe ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    console.error(
      `record_activity_add failed (${write.recordType} ${write.kind}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** The same event on every live contact that has this phone number. */
export async function recordActivityForPhone(
  db: Db,
  phoneE164: string,
  write: Omit<ActivityWrite, "recordType" | "recordId">,
): Promise<void> {
  try {
    const { data, error } = await db.rpc("record_activity_contacts_of_phone", {
      p_company_id: write.companyId,
      p_phone: phoneE164,
    });
    if (error) throw new Error(error.message);
    for (const contactId of (data ?? []) as string[]) {
      await recordActivity(db, { ...write, recordType: "contact", recordId: contactId });
    }
  } catch (error) {
    console.error(
      `record_activity_contacts_of_phone failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
