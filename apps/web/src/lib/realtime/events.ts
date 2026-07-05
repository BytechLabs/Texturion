import type {
  Message,
  MessageDirection,
  MessageStatus,
  NumberStatus,
  RegistrationStatus,
} from "@/lib/api/types";

/**
 * SPEC §8 Broadcast events — ID-only payloads published by the database
 * triggers into the private topic `company:{id}`; clients refetch the
 * referenced resources through the API so authorization stays in one place.
 */

export interface MessageCreatedEvent {
  conversation_id: string;
  message_id: string;
  direction: MessageDirection;
}

export interface MessageStatusEvent {
  message_id: string;
  /** Null for notes — their delivery status never exists (SPEC §6). */
  status: MessageStatus | null;
  /**
   * D14: the trigger includes the done fields on every message.status
   * broadcast (done toggles emit this same event). Optional so payloads from
   * a not-yet-migrated database still patch delivery state correctly.
   */
  done_at?: string | null;
  done_by_user_id?: string | null;
  /**
   * #3: the same trigger includes the pin fields on every message.status
   * broadcast (pin toggles emit this same event). Optional so payloads from a
   * not-yet-migrated database still patch delivery/done state correctly.
   */
  pinned_at?: string | null;
  pinned_by_user_id?: string | null;
}

/**
 * The cache patch a message.status broadcast carries (pure — unit-tested):
 * always the delivery status; the D14 done fields and #3 pin fields only when
 * the payload has them, so an older payload can never wipe local done/pin state.
 */
export function messageStatusPatch(event: MessageStatusEvent): Partial<Message> {
  const patch: Partial<Message> = { status: event.status ?? null };
  if ("done_at" in event) patch.done_at = event.done_at ?? null;
  if ("done_by_user_id" in event) {
    patch.done_by_user_id = event.done_by_user_id ?? null;
  }
  if ("pinned_at" in event) patch.pinned_at = event.pinned_at ?? null;
  if ("pinned_by_user_id" in event) {
    patch.pinned_by_user_id = event.pinned_by_user_id ?? null;
  }
  return patch;
}

export interface ConversationUpdatedEvent {
  conversation_id: string;
}

/**
 * TASKS.md T1.3 — the ID-only `task.changed` broadcast fired by the DB
 * `tasks_broadcast` trigger on task create / metadata update / soft-delete
 * (NOT done — done rides `message.status`). Payload carries ONLY the source
 * `conversation_id` (D9 minimal), so the client refetches the affected
 * conversation's checklist + the /tasks lists through the API. This is the
 * cross-client signal: a task another crew member creates / assigns /
 * reschedules / deletes lands live on every viewer's checklist and task views.
 */
export interface TaskChangedEvent {
  conversation_id: string;
}

export interface NumberUpdatedEvent {
  number_id: string;
  status: NumberStatus;
}

export interface RegistrationUpdatedEvent {
  kind: "brand" | "campaign";
  status: RegistrationStatus;
}

export const REALTIME_EVENTS = [
  "message.created",
  "message.status",
  "conversation.updated",
  "task.changed",
  "number.updated",
  "registration.updated",
] as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];
