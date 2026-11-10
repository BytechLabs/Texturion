/**
 * Production row counts per state, read on 2026-11-10 with one read-only
 * SELECT per column inside a rolled-back transaction (docs/STATE-MACHINES.md,
 * "Production check"). Only counts and state names are recorded.
 *
 * The test asserts every observed state is a state its machine defines. A
 * state defined but never observed is fine (most machines are young or small
 * on production); an observed state the machine forbids is the failure that
 * would block a guard from landing in phase 2.
 *
 * `NULL` is a row whose column holds no value. It is accepted only where the
 * machine says so (calls.state before v3, messages.status on notes, the
 * porting mirror on a number that was never ported).
 *
 * This is a dated snapshot, not a live check: it documents what was true on
 * the day phase 1 landed. Phase 2 re-runs the same queries before each guard.
 */

export const PROD_SNAPSHOT_DATE = "2026-11-10";

/** machine id -> column (or derived label) -> state -> row count. */
export const PROD_COUNTS: Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, number>>>>>
> = {
  call: {
    "calls.state": { ended_answered: 51, ended_missed: 98, ended_voicemail: 9, NULL: 7 },
  },
  call_leg: {
    "call_member_legs.state": { ringing: 125, answered: 7, failed: 51 },
  },
  scheduled_message: {
    "scheduled_messages.status": { canceled: 1, sent: 1 },
  },
  calendar_connection: {
    "calendar_connections.status": { active: 2, revoked: 1 },
  },
  calendar_outbox: {
    "calendar_outbox.state": { cancelled: 1, completed: 10 },
  },
  calendar_reminder_replan: {
    "calendar_reminder_replans.state": {},
  },
  calendar_link: {
    "task_calendar_links.link_state": { unlinked: 3 },
  },
  calendar_push_subscription: {
    "webhook_subscriptions.status": { active: 2, revoked: 1 },
  },
  webhook_delivery: {
    "webhook_deliveries.status": {},
  },
  subscription: {
    "companies.subscription_status": { active: 1, incomplete: 5 },
  },
  conversation: {
    "conversations.status": { closed: 3, new: 5, open: 1, waiting: 2 },
  },
  conversation_visibility: {
    "derived(is_spam, deleted_at)": { live: 10, trashed: 1 },
  },
  message: {
    "messages.status": { delivered: 31, failed: 3, received: 28, NULL: 17 },
  },
  registration: {
    "messaging_registrations.status": { draft: 4 },
  },
  number_health: {
    "number_health.state": { healthy: 1 },
  },
  payment_request: {
    "payment_requests.status": {},
  },
  phone_number: {
    "phone_numbers.status": { active: 1 },
  },
  port: {
    "port_requests.status": {},
    "phone_numbers.porting_status": { NULL: 1 },
  },
  port_messaging: {
    "port_requests.messaging_port_status": {},
  },
  quote: {
    "quotes.status": { draft: 1 },
  },
  text_enablement: {
    "text_enablement_orders.status": {},
  },
  data_export: {
    "data_exports.status": { ready: 3 },
  },
  consent: {
    "contact_consent_events.state": { express: 5, implied: 6, revoked: 1 },
  },
  geocode: {
    "contacts.geocode_status": { ok: 2, pending: 11 },
    "tasks.geocode_status": { no_address: 17 },
  },
  billing_dispute: {
    "billing_disputes.status": {},
  },
  task: {
    "derived(task_done_at, deleted_at)": { open: 4, done: 2, trashed: 11 },
  },
  invite: {
    "derived(accepted_at, revoked_at, expires_at)": { accepted: 3, revoked: 3 },
  },
  workspace: {
    "derived(paused_at, deleted_at, purged_at)": { active: 6 },
  },
};

/**
 * Rows that break an invariant the machine implies, found by the same queries.
 * None of these is a state the definition forbids, which is why the test above
 * passes; they are recorded so phase 2 fixes or backfills them before it adds
 * a guard that would refuse the same write today.
 */
export const PROD_INVARIANT_VIOLATIONS: readonly {
  machine: string;
  rows: number;
  what: string;
}[] = [
  {
    machine: "call",
    rows: 8,
    what: "terminal state (ended_answered 3, ended_missed 5) with ended_at NULL",
  },
  {
    machine: "call",
    rows: 1,
    what: "state ended_voicemail but outcome missed (the state-to-outcome mirror disagrees)",
  },
  {
    machine: "call",
    rows: 7,
    what: "state NULL (legacy rows from before calls v3 wrote state); outcome answered 5, missed 2",
  },
  {
    machine: "call_leg",
    rows: 125,
    what: "leg still ringing on a call that has ended (ended_answered 52, ended_missed 65, ended_voicemail 8); the v3 ledger is audit-only and never advances legs",
  },
];
