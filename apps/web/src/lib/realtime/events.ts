import type {
  ConversationEventType,
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

/**
 * #358: somebody's own read state moved, possibly on another device.
 *
 * ID-only like every other event, and it carries the `user_id` because it
 * rides the COMPANY topic: a client must ignore a colleague's reading. Doing
 * otherwise would have every member refetch their counts whenever anybody
 * opened a thread, which is both wasteful and slightly creepy.
 */
export interface ReadStateEvent {
  user_id: string;
  /** Present only on `read.conversation`. */
  conversation_id?: string;
}

/**
 * #607 — the three `conversation_event_type` labels the database broadcasts a
 * `payment.updated` for, VERBATIM.
 *
 * The full enum labels and not a trimmed 'paid'/'refunded'/'disputed', because
 * the trimmed form would be a third vocabulary: the SQL enum and
 * `ConversationEventType` in the API already hold these exact strings equal in
 * both directions (`scripts/check-conversation-events.mjs`), and every timeline
 * row on every client is already keyed on them.
 *
 * `payment_requested` and `payment_cancelled` are deliberately not broadcast —
 * the first rides `message.created` (the request IS an outbound text) and the
 * second is somebody in this app doing it on purpose. The database asserts that
 * exact set in both directions (supabase/tests/payment_requests.test.sql PR-10),
 * so a fourth type cannot land here quietly.
 *
 * Not the same set as `NARRATED_PAYMENT_EVENT_TYPES` in
 * `components/thread/payment-line.ts`, which is the FIVE the timeline reads.
 * Broadcasting is about what arrives without a fetch; narrating is about what
 * the transcript says once it has been fetched.
 *
 * ## This list is checked, in both directions, against two other lists
 *
 * It used to be checked against neither, and a list with no consumer is a list
 * that drifts (#607 A6): `handlePaymentUpdated` ignores `event.type`, so
 * deleting a label here left both this file and its test green.
 *
 * `satisfies` is the first half — every label must be one the server can write,
 * and `ConversationEventType` is itself held to the SQL enum in both directions
 * by `scripts/check-conversation-events.mjs`. A typo fails tsc.
 *
 * The half that catches a DELETION is `events.test.ts`, which reads the trigger's
 * own `when (...)` clause out of the migration and asserts set equality. A
 * shorter list still satisfies a type; only the database can say the set is
 * wrong.
 */
export const PAYMENT_EVENT_TYPES = [
  "payment_paid",
  "payment_refunded",
  "payment_disputed",
] as const satisfies readonly ConversationEventType[];

export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/**
 * #607 — money moved on a payment request in this thread.
 *
 * ID-only like the rest of §8: two ids and a discriminator, never an amount or
 * a customer. The topic is the per-number one (`company:{id}:number:{n}`), the
 * same boundary `message.created` inherits — a payment names a thread, a thread
 * belongs to a number, and a member denied that line must not learn money
 * arrived on it.
 */
export interface PaymentUpdatedEvent {
  /** The thread to refetch. Always present — a request belongs to its thread. */
  conversation_id: string;
  /**
   * The row that moved, read out of the event's jsonb payload. Null when the
   * writer omitted it, which is why nothing here is keyed on it.
   */
  payment_request_id: string | null;
  type: PaymentEventType;
}

/**
 * Every broadcast event this client subscribes to.
 *
 * Load-bearing, not documentation: `provider-lifecycle.test.tsx` asserts this
 * list and the set of bindings the provider actually registers are EQUAL IN
 * BOTH DIRECTIONS. It was documentation once and had drifted — `call.updated`
 * and `access.changed` were both received and neither was listed — which is the
 * state a list with no consumer always ends up in.
 */
export const REALTIME_EVENTS = [
  "message.created",
  "message.status",
  "conversation.updated",
  "task.changed",
  // #133: the calls read model moved (a new session, an outcome merge).
  "call.updated",
  // #607: a deposit cleared, was refunded, or was disputed.
  "payment.updated",
  "number.updated",
  "registration.updated",
  // #358: read state, so clearing the bell on a phone clears it on the laptop.
  "read.conversation",
  "read.notifications",
  // #480: somebody's number access moved, so the topic set must be re-derived.
  "access.changed",
] as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];
