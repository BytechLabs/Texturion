/**
 * API resource shapes, derived by reading apps/api/src/routes/*.ts (never
 * guessed — SPEC §7 is the contract, the route files are the truth).
 */

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled";
export type MemberRole = "owner" | "admin" | "member";
export type PlanId = "starter" | "pro";
export type Country = "US" | "CA";
export type ConversationStatus = "new" | "open" | "waiting" | "closed";
export type MessageDirection = "inbound" | "outbound" | "note";
export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "failed";
export type NumberStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "released"
  | "provision_failed";

/** Coarse, customer-safe reason a number provision failed (mirrors the API). */
export type ProvisionFailureReason =
  | "no_inventory"
  | "carrier"
  | "unknown"
  | "timeout";
/**
 * Where a `phone_numbers` row came from (`number_source` enum): a bought
 * number, a full port-in, or a keep-your-number text-enablement (hosted SMS —
 * voice stays with the owner's existing carrier).
 */
export type NumberSource = "provisioned" | "ported" | "hosted";
export type RegistrationStatus =
  | "draft"
  | "submitted"
  | "pending"
  | "approved"
  | "rejected";
export type ConsentSource = "inbound_sms" | "attested";
export type OptOutSource = "stop_keyword" | "manual" | "import";
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
  // D22 / APP-LAYOUT-V2 §4.2 — done audit. Written by the D14 PATCH
  // /v1/messages/:id handler on a REAL done↔undone transition (the idempotent
  // no-op writes none). payload is `{ message_id }` only; the timeline joins
  // the live message body at render time (§4.3 — never a stored excerpt).
  | "message_done"
  | "message_undone"
  // D17 / TASKS.md T8 — task metadata lifecycle, written on the source
  // conversation by the task-mutation RPCs (create_task/assign_task/
  // update_task/delete_task). Each carries `payload.task_id`; the thread renders
  // them as quiet interwoven system lines (system-line.tsx eventSentence) that
  // link to open the task drawer.
  //   task_created   payload: { task_id, message_id }
  //   task_assigned  payload: { task_id, from_user_id, to_user_id }
  //   task_due_set   payload: { task_id, due_at }        (due_at null = cleared)
  //   task_deleted   payload: { task_id }
  | "task_created"
  | "task_assigned"
  | "task_due_set"
  | "task_deleted"
  // D19 / TASKS.md T8 — generic-attachment audit for note + task owners.
  | "note_attachment_added"
  | "note_attachment_removed"
  | "task_attachment_added"
  | "task_attachment_removed"
  // FEATURE-GAPS voice wave — logged on the caller's conversation when a call
  // is COMPUTED missed and the text-back fired. Actor is NULL (system);
  // payload: { call_id, message_id, caller }.
  | "missed_call"
  // #129/D38 Calls feature — one line per finished call threaded into this
  // conversation (api_thread_call; actor NULL). payload:
  // { call_session_id, outcome: 'answered'|'voicemail'|'missed',
  //   forward_seconds, caller, direction: 'inbound'|'outbound' }.
  | "call_completed";

/** SPEC §7 list envelope — cursor-based only, opaque cursor. */
export interface Page<T> {
  data: T[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// me / company
// ---------------------------------------------------------------------------

export interface Membership {
  company_id: string;
  name: string;
  role: MemberRole;
  subscription_status: SubscriptionStatus;
}

/** GET /v1/me — optionally hydrated with `company` when X-Company-Id is sent. */
export interface Me {
  user_id: string;
  display_name: string;
  memberships: Membership[];
  company?: CompanyView;
}

/** Numbers summary embedded in company views (routes/core/company-view.ts). */
export interface PhoneNumberSummary {
  id: string;
  status: NumberStatus;
  country: Country;
  number_e164: string | null;
  requested_area_code: string | null;
  created_at: string;
  /**
   * FEATURE-GAPS voice wave: hosted-vs-purchased. Returned by BOTH read
   * surfaces (GET /v1/numbers and the company-view embed) but kept optional so
   * cached pre-wave shapes stay assignable — readers treat a missing value as
   * "provisioned".
   */
  source?: NumberSource;
  /** Voice on Telnyx — false for hosted rows (calls stay on the old carrier). */
  voice_enabled?: boolean;
  /** Present on GET /v1/numbers rows; absent from the company-view embed. */
  suspended_at?: string | null;
  released_at?: string | null;
  /**
   * Honest-status fields — present on BOTH read surfaces for a provision_failed
   * number (optional so cached pre-fix shapes stay assignable). `failure_reason`
   * is the coarse, customer-safe cause (never the raw vendor error);
   * `provision_attempts` + `retrying` distinguish "still trying" from "stuck,
   * choose a number".
   */
  failure_reason?: ProvisionFailureReason | null;
  provision_attempts?: number;
  /** GET /v1/numbers only: still auto-retrying under the cron budget. */
  retrying?: boolean;
}

/** A pickable available number from GET /v1/available-numbers (choose-your-number). */
export interface AvailableNumber {
  /** E.164. */
  phone_number: string;
  region: string | null;
  features: string[];
}

/** GET /v1/available-numbers response — the picker feed. */
export interface AvailableNumbersResult {
  data: AvailableNumber[];
  /** True when the exact filters matched nothing — the UI prompts to widen the search. */
  best_effort_exhausted: boolean;
  /**
   * True when Telnyx returned numbers but masked their digits (Canada) so none
   * is individually orderable — the picker offers area-code choice instead.
   */
  masked: boolean;
}

/** Registration snapshot embedded in company views (no id / wizard data). */
export interface RegistrationSummary {
  kind: "brand" | "campaign";
  status: RegistrationStatus;
  sole_proprietor: boolean;
  rejection_reason: string | null;
  submission_count: number;
  submitted_at: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  deactivated_at: string | null;
}

/** GET /v1/company and the GET /v1/me `company` hydration. */
export interface CompanyView {
  id: string;
  name: string;
  country: Country;
  us_texting_enabled: boolean;
  requested_area_code: string;
  /** Choose-your-number: the staged onboarding pick shown in the plan-step review; null = auto-assign. */
  chosen_number_e164?: string | null;
  /** D15: workspace IANA timezone (business-facing daily framing). */
  timezone: string;
  plan: PlanId | null;
  subscription_status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  overage_cap_multiplier: number | string | null;
  registration_fee_paid_at: string | null;
  canceled_at: string | null;
  /** SPEC §9: Stripe's pending period-end cancellation, mirrored by webhook. */
  cancel_at_period_end: boolean;
  /** FEATURE-GAPS Step 1 — after-hours away reply (company-local clock). */
  business_hours: BusinessHours;
  away_enabled: boolean;
  away_message: string | null;
  /** FEATURE-GAPS voice wave — missed-call text-back settings. */
  mctb_enabled: boolean;
  mctb_message: string | null;
  /** #192: the template the server will actually send — the owner's
   *  non-blank text, else the product default. */
  mctb_effective_message: string;
  /** #192: true when the owner's own text is in effect. */
  mctb_message_is_custom: boolean;
  /** D43 Calls v2 — voicemail greeting (null = the spoken default), the
   *  carrier-screening routing choice, and the CNAM pair (outbound display
   *  name <=15 alphanumeric+space; inbound name-dip toggle). */
  voicemail_greeting: string | null;
  call_screening: "off" | "flag" | "divert";
  cnam_display_name: string | null;
  caller_id_lookup: boolean;
  /** #193: the outbound caller ID actually in effect — the explicit override
   *  when set, else the company name in the carrier alphabet. */
  caller_id_effective: string | null;
  /** #193: 'company_name' = the platform default; 'custom' = owner-set. */
  caller_id_source: "custom" | "company_name";
  /** #193: when the listing last went to the carrier side (CNAM propagation
   *  takes days and reports no completion, so the timestamp IS the state). */
  cnam_submitted_at: string | null;
  created_at: string;
  updated_at: string;
  numbers: PhoneNumberSummary[];
  /** #133: live module ids — the MEMBER-visible on/off state (read this,
   *  never the admin-only GET /v1/billing/modules: a member reading that got
   *  403, which made every member render as module-off — the tel:
   *  personal-cell leak). #134/D42: 'voice' no longer appears here — calling
   *  is included on every plan, so no surface gates on it anymore. The field
   *  remains for 'regions_ca' and whatever modules come later. */
  enabled_modules: string[];
  registration: {
    brand: RegistrationSummary | null;
    campaign: RegistrationSummary | null;
  };
}

/** A weekday open/close window in 24h "HH:MM" company-local time. */
export interface DayHours {
  open: string;
  close: string;
}

/** weekday (mon..sun) -> window; a missing/null weekday = closed all day. */
export type BusinessHours = Partial<
  Record<
    "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
    DayHours | null
  >
>;

// ---------------------------------------------------------------------------
// conversations / messages
// ---------------------------------------------------------------------------

export interface ContactSummary {
  id: string;
  name: string | null;
  phone_e164: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  /** Present on GET /v1/tags rows; absent from embedded tag summaries. */
  created_at?: string;
  updated_at?: string;
}

export interface Conversation {
  id: string;
  company_id: string;
  contact_id: string;
  phone_number_id: string;
  status: ConversationStatus;
  is_spam: boolean;
  assigned_user_id: string | null;
  /** #3 pin state — set/cleared together by PATCH /v1/conversations/:id {pinned}. */
  pinned_at: string | null;
  pinned_by_user_id: string | null;
  last_message_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The G4 snippet source embedded on every GET /v1/conversations row: the
 * newest messages row (notes included), body truncated to 160 chars
 * server-side. Null only for a conversation with no messages yet.
 */
export interface ConversationSnippet {
  id: string;
  direction: MessageDirection;
  body: string;
  created_at: string;
  has_attachments: boolean;
}

/** GET /v1/conversations row (api_list_conversations RPC). */
export interface ConversationListItem extends Conversation {
  contact: ContactSummary;
  tags: Tag[];
  unread: boolean;
  last_message: ConversationSnippet | null;
}

export interface AttachmentSummary {
  id: string;
  content_type: string;
  size_bytes: number | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  body: string;
  status: MessageStatus | null; // null iff direction='note'
  segments: number | null;
  encoding: string | null;
  sent_by_user_id: string | null;
  error_code: string | null;
  error_detail: string | null;
  telnyx_message_id: string | null;
  /** D14 done state — set/cleared together by PATCH /v1/messages/:id. */
  done_at: string | null;
  done_by_user_id: string | null;
  /** #3 pin state — set/cleared together by PATCH /v1/messages/:id {pinned}. */
  pinned_at: string | null;
  pinned_by_user_id: string | null;
  created_at: string;
  /**
   * Present on every message read surface (SPEC §7). POST /v1/conversations
   * returns the bare row — hooks normalize a missing array to [].
   */
  attachments?: AttachmentSummary[];
  /**
   * D17/T5.1: true when a LIVE task rows over this message. The list read
   * surfaces (`GET /conversations/:id` + `.../messages`) set it; the bare
   * POST-compose row and optimistic patches omit it (treated as false), so the
   * thread's stone task indicator only appears once the message re-reads.
   */
  has_task?: boolean;
  /**
   * T5.1: when `has_task`, the task this message was PROMOTED into ({ id,
   * title }) — the target the thread's "Task" chip opens in the drawer. Absent
   * on the bare compose row / optimistic patches (treated as not-yet-promoted).
   */
  promoted_task?: MessageTaskLink | null;
  /**
   * TASKS-V2 (D17 D-D): the task this note is linked to (a `direction='note'`
   * message composed from the task drawer). Null/absent for every non-note or
   * unlinked message. Present on the message read surfaces + the note-create
   * response so the thread renders the "on: <task title>" chip.
   */
  task_id?: string | null;
  task?: MessageTaskLink | null;
}

/** The linked-task chip a task-linked note carries in the thread (D-D). */
export interface MessageTaskLink {
  id: string;
  title: string;
}

/** Contact embed on GET /v1/conversations/:id. */
export interface ConversationDetailContact {
  id: string;
  name: string | null;
  phone_e164: string;
  address: string | null;
  notes: string | null;
  consent_source: ConsentSource | null;
  consent_at: string | null;
  deleted_at: string | null;
}

/** GET /v1/conversations/:id — embeds the first page of messages. */
export interface ConversationDetail extends Conversation {
  contact: ConversationDetailContact;
  tags: Tag[];
  messages: Page<Message>;
  /** #106: the caller's access level on this conversation's number — 'note'
   *  means read + internal notes only (the composer hides its SMS mode). */
  viewer_level: "text" | "note";
}

/** #106: a number's access shape (GET/PUT /v1/numbers/:id/access). */
export type NumberAccess =
  | { access: "everyone" }
  | { access: "role"; role: "admin" | "member"; level: "text" | "note" }
  | { access: "users"; user_ids: string[]; level: "text" | "note" };

/** GET /v1/conversations/:id/events row. */
export interface ConversationEvent {
  id: string;
  conversation_id: string;
  actor_user_id: string | null; // null = system
  type: ConversationEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

/** POST /v1/conversations/:id/read response. */
export interface ReadReceipt {
  conversation_id: string;
  user_id: string;
  last_read_at: string;
}

/** POST /v1/conversations (compose) response. */
export interface ComposeResult {
  conversation: Conversation;
  message: Message;
}

// ---------------------------------------------------------------------------
// tasks (D17 / TASKS.md — a task is metadata over a real message; completion
// is DERIVED from the joined messages.done_at, never a task column)
// ---------------------------------------------------------------------------

/**
 * The derived task status label (TASKS.md T1.1): `open` when the joined
 * `messages.done_at IS NULL`, `done` otherwise. There is NO stored status —
 * the API computes it per row from the source message and returns it alongside
 * the `done` boolean.
 */
export type TaskStatus = "open" | "done";

/**
 * A task row as returned by every /v1/tasks read (routes/tasks.ts TASK_COLUMNS).
 * `done` + `status` are DERIVED server-side from the source message's
 * `done_at` — the task carries no completion column (TASKS.md T2). Toggling a
 * task's done is `PATCH /v1/messages/:id {done}` on `message_id`, never a task
 * route.
 */
export interface Task {
  id: string;
  company_id: string;
  /** The promoted message — completion derives from ITS done_at (NOT NULL). */
  message_id: string;
  conversation_id: string;
  title: string;
  description: string;
  assigned_user_id: string | null;
  due_at: string | null;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
  /** Derived: true when the source message is done (joined done_at set). */
  done: boolean;
  /** Derived label: "done" iff `done`, else "open". */
  status: TaskStatus;
  /**
   * The source conversation's contact with its cached geocode, for the Map view
   * (D25). OPTIONAL and forward-compatible: the frozen /v1/tasks contract
   * (routes/tasks.ts) uses the contact's lat/lng only to FILTER `has_location`
   * and does not currently return coordinates in the body, so this is absent
   * today — the Map reads it defensively (`taskCoords`) and shows a task as
   * "without a location" when it's missing, never fabricating a pin. If a later
   * backend wave projects the located contact onto the row, pins light up with
   * no client change.
   */
  contact?: TaskContactLocation | null;
}

/** The located-contact embed a `has_location=true` task row MAY carry (Map view, D25). */
export interface TaskContactLocation {
  id: string;
  name: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * One row of the conversation checklist (GET /v1/conversations/:id/tasks,
 * TASKS.md T5.2). A `Task` plus `attachment_count` — the size of the D28
 * DERIVED attachments union (source-message MMS + task-linked note files +
 * legacy task rows), computed by the same loader as the detail's
 * `attachments`, so the badge and the drawer can never disagree.
 */
export interface ChecklistTask extends Task {
  attachment_count: number;
}

/** A resolved profile embedded in the task detail (routes/tasks.ts). */
export interface TaskProfile {
  user_id: string;
  display_name: string | null;
}

/** The source message embed on GET /v1/tasks/:id (live body + done_at). */
export interface TaskSourceMessage {
  id: string;
  body: string;
  done_at: string | null;
  done_by_user_id: string | null;
  created_at: string;
  direction: MessageDirection;
}

/**
 * One item in the task drawer's merged activity+discussion timeline
 * (TASKS-V2 D-C + D-D, GET /v1/tasks/:id `activity`). Either a `task_*` audit
 * event (D-C) or a task-linked internal note (D-D), sorted oldest-first.
 */
export type TaskActivityItem =
  | {
      kind: "event";
      id: string;
      type: ConversationEventType;
      payload: Record<string, unknown>;
      actor_user_id: string | null;
      actor: TaskProfile | null;
      created_at: string;
    }
  | {
      kind: "note";
      id: string;
      body: string;
      author_user_id: string | null;
      author: TaskProfile | null;
      created_at: string;
    };

/**
 * One item of a task's DERIVED attachments union (D28 — GET /v1/tasks/:id
 * `attachments`, routes/tasks.ts loadTaskAttachments): the source message's
 * MMS media (`source:'mms'`) + live files on task-linked notes (`'note'`) +
 * legacy pre-D28 task-owned rows (`'task'`), gallery-shaped WITHOUT a
 * pre-signed url — the web mints per-item urls via the existing
 * GET /v1/attachments/:id/url (that route serves all three sources). Sorted
 * (created_at, id) ASC. `file_name` is null for MMS items: carrier media has
 * no filename (D29 records this as correct, not a gap).
 */
export interface TaskAttachmentItem {
  id: string;
  source: GallerySource;
  kind: "image" | "file";
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

/** GET /v1/tasks/:id — the full detail (row + resolved profiles + source). */
export interface TaskDetail extends Task {
  assignee: TaskProfile | null;
  created_by: TaskProfile | null;
  source_message: TaskSourceMessage | null;
  /** The D28 derived union — a read view; tasks never own uploads. */
  attachments: TaskAttachmentItem[];
  /** The merged activity+discussion timeline (D-C events + D-D notes). */
  activity: TaskActivityItem[];
  /**
   * #107: the caller's #106 access to the task's source number. Tasks are
   * global, so the identity always resolves, but conversation-derived content
   * (source_message, attachments, activity) is withheld at 'none' and the
   * text/reply affordance is hidden at 'note'.
   */
  viewer_level: "text" | "note" | "none";
}

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------

export interface Contact {
  id: string;
  phone_e164: string;
  name: string | null;
  address: string | null;
  notes: string | null;
  consent_source: ConsentSource | null;
  consent_at: string | null;
  consent_attested_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * GET /v1/contacts/:id and GET /v1/contacts list rows add the app-side
 * opt-out state (the G6 opted-out badge).
 */
export interface ContactDetail extends Contact {
  opted_out: boolean;
}

/**
 * GET /v1/contacts list row: the detail shape plus `last_activity_at` — the
 * newest conversation's last_message_at for this contact, null when they've
 * never texted (routes/contacts.ts). The G6 "Last activity" column renders
 * THIS, never `updated_at`: record edits and CSV re-imports touch updated_at
 * and would lie under that header (G10 — system states must be precise).
 */
export interface ContactListItem extends ContactDetail {
  last_activity_at: string | null;
}

export interface OptOut {
  id: string;
  phone_e164: string;
  source: OptOutSource;
  created_at: string;
  revoked_at: string | null;
}

/** POST /v1/contacts/import response. */
export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

// ---------------------------------------------------------------------------
// templates / team / usage / search
// ---------------------------------------------------------------------------

export interface Template {
  id: string;
  name: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  user_id: string;
  role: MemberRole;
  deactivated_at: string | null;
  created_at: string;
  display_name: string;
}

export interface Invite {
  id: string;
  company_id: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * POST /v1/invites response — the invite row plus whether the invite email
 * went out. New addresses get the Supabase Auth invite email; an address that
 * already has an account gets a direct email with the in-app accept link
 * (#109). `email_sent` is false only when that send failed — the inviter
 * falls back to Copy link.
 */
export interface CreatedInvite extends Invite {
  email_sent: boolean;
}

/**
 * GET /v1/invites/mine row (#109) — one of the caller's own pending invites
 * (matched server-side on their confirmed email), carrying the inviting
 * company's name for the "you've been invited — Join" banner.
 */
export interface MyInvite extends Invite {
  company_name: string | null;
}

/** POST /v1/invites/accept response (member row + company_id). */
export interface AcceptedInvite {
  id: string;
  user_id: string;
  role: MemberRole;
  deactivated_at: string | null;
  created_at: string;
  company_id: string;
}

/** One G8 history bar: a calendar month of outbound segments. */
export interface UsageMonth {
  month: string; // 'YYYY-MM'
  segments: number;
}

/** D30 storage accounting embedded in GET /v1/usage. */
export interface UsageStorage {
  /** Live note-borne attachments — the arm the plan budget gates on upload. */
  attachments_bytes: number;
  /** Stored inbound MMS media (its own #12 pool). */
  mms_bytes: number;
  /** Effective attachment budget (plan + extra_storage add-on). */
  attachment_budget_bytes: number;
  /** Effective MMS-media budget (plan + extra_storage add-on). */
  mms_budget_bytes: number;
}

/** #12/D36 calling minutes embedded in GET /v1/usage (both directions, D38). */
export interface UsageVoice {
  /** Whole billed-leg minutes this period (forwarded + outbound talk time) —
   *  the fair-use measure the allowance, the overage meter, and the cap
   *  share (D36/D38). */
  used_minutes: number;
  /** Included calling minutes: the plan allowance (0 pre-checkout).
   *  #134/D42: same for every workspace — the grandfathered-module variant
   *  retired with the module. */
  included_minutes: number;
  /** D36: minutes where calling pauses — included × the same spending-cap
   *  multiplier as texts. Null pre-checkout. */
  cap_minutes: number | null;
  /** D36: whole minutes past the allowance so far (billed at 1¢ each,
   *  rated to the second). */
  overage_minutes: number;
  /** D36: overage-so-far in cents (exact overage seconds ÷ 60 × 1¢). */
  projected_overage_cents: number;
  /** #133 introduced this for the grandfathered $8-module cohort (false =
   *  extra minutes never bill). #134/D42 retired grandfathering along with
   *  the module itself, so the API now always sends true; the field stays
   *  so cached pre-D42 payloads keep type-checking and rendering honestly. */
  overage_billed: boolean;
}

/** #85 dynamic overage projection embedded in GET /v1/usage. */
export interface UsageOverageProjection {
  /** True when the tenant is projected to run past what their plan covers — the
   *  only time the app surfaces the overage notice + controls. */
  trending_over: boolean;
  /** Extrapolated end-of-period overage the customer would be billed, in cents. */
  projected_overage_cents: number;
}

/**
 * #178: the fair-use presentation contract, derived by the API so every client
 * renders the same philosophy (marketing promises fair use, not walls).
 *   'quiet'  — projected to stay inside plan economics (the overwhelming
 *              default): no meters, no "X of Y", just the calm fair-use line.
 *   'pacing' — the dynamic projection says this period runs hot: the early
 *              warning with the projected extra charges.
 *   'capped' — the owner-set spending cap is approaching (>=90%) or reached
 *              on either meter: the cap state and the owner control.
 */
export type UsageStatus = "quiet" | "pacing" | "capped";

/** GET /v1/usage — nulls when the company has never checked out. */
export interface Usage {
  /** #178 fair-use presentation contract — gates every usage surface. */
  status: UsageStatus;
  period_start: string | null;
  period_end: string | null;
  included_segments: number;
  used_segments: number;
  /** #12: inbound segments received this period (visibility only, not billed). */
  inbound_segments: number;
  overage_segments: number;
  cap_segments: number | null; // null = no cap
  projected_overage_cents: number;
  /** #85: the dynamic END-OF-PERIOD projection. `trending_over` gates the
   *  conditional overage surface (shown only when the tenant is pacing past what
   *  they pay); `projected_overage_cents` is the extrapolated extra charge. */
  overage_projection: UsageOverageProjection;
  /** Last 6 calendar months, oldest first (empty pre-subscription). */
  history: UsageMonth[];
  /** D30: the company's stored bytes, both arms. */
  storage: UsageStorage;
  /** #12: calling minutes used vs the plan allowance (both directions). */
  voice: UsageVoice;
  // #97/#103: no `mms` meter — pictures count 3 segments each in the message
  // meter, with no separate cap.
}

/**
 * #129 GET /v1/calls row — one finished (or in-flight) call session.
 * `outcome` null = a legacy/in-flight row the UI shows without a verdict;
 * `forward_seconds` is TALK time (0 for misses — never ring time);
 * `conversation_id` null = unthreaded (anonymous caller, or an answered call
 * from a number with no open conversation).
 */
export interface Call {
  id: string;
  /** D43: Telnyx session id — the voicemail playback + live-call key. */
  call_session_id: string;
  caller_e164: string | null;
  contact_id: string | null;
  contact_name: string | null;
  /** D43: CNAM-dipped caller display name (owner-enabled lookup). */
  caller_name: string | null;
  phone_number_id: string | null;
  conversation_id: string | null;
  /** null = the call is IN PROGRESS (D43 creates the row at ring time). */
  outcome: "answered" | "voicemail" | "missed" | null;
  /** D38: 'outbound' = a call the crew placed from the app. */
  direction: "inbound" | "outbound";
  forward_seconds: number;
  /** D43: raw carrier screening verdict + STIR/SHAKEN attestation. */
  screening_result: string | null;
  stir_attestation: string | null;
  voicemail_seconds: number | null;
  answered_by_user_id: string | null;
  started_at: string;
}

/** GET /v1/search conversation hit (api_search_v2 RPC). */
export interface SearchConversationHit {
  id: string;
  status: ConversationStatus;
  is_spam: boolean;
  last_message_at: string;
  contact: ContactSummary;
  matched_message_id: string;
  matched_at: string;
  /** The matched message's direction — a 'note' hit gets a quiet label (D29). */
  direction: MessageDirection;
  snippet: string;
}

/**
 * GET /v1/search task hit (D29). `done` derives from the source message's
 * done_at (D17, same as /v1/tasks); `matched_at` is the task's created_at.
 */
export interface SearchTaskHit {
  id: string;
  title: string;
  conversation_id: string;
  done: boolean;
  matched_at: string;
}

/**
 * GET /v1/search attachment hit (D29) — generic note/task rows only (MMS media
 * has no filename, on purpose). `file_name` is never null on a hit: the arm
 * matches on it. The deep link target is the owning thread (`conversation_id`).
 */
export interface SearchAttachmentHit {
  id: string;
  file_name: string;
  owner_type: AttachmentOwnerType;
  conversation_id: string | null;
  content_type: string | null;
  created_at: string;
}

/** GET /v1/search template hit (D29) — `snippet` is left(body, 160). */
export interface SearchTemplateHit {
  id: string;
  name: string;
  snippet: string;
}

/**
 * GET /v1/search (D29): conversations paginate on the cursor; every other arm
 * rides along on the first page only (empty arrays on cursored pages).
 */
export interface SearchResult {
  conversations: SearchConversationHit[];
  contacts: ContactSummary[];
  tasks: SearchTaskHit[];
  attachments: SearchAttachmentHit[];
  templates: SearchTemplateHit[];
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// billing / numbers / registration / notifications / attachments
// ---------------------------------------------------------------------------

/** POST /v1/billing/checkout and /portal. */
export interface HostedUrl {
  url: string;
}

/** POST /v1/billing/change-plan. */
export type ChangePlanResult =
  | { plan: "pro"; effective: "now" }
  | { plan: "starter"; effective: "period_end"; effective_at: string };

/**
 * #12 plan-builder module ids (mirrors the API company_modules.module).
 * #97/#103: `mms` is RETIRED — pictures are included on every plan (each MMS
 * counts 3 texts from the allowance), so there is no Picture-messages add-on.
 * #121: `extra_storage` is RETIRED — storage is free with no caps or meter;
 * abusive storage use triggers a human conversation, never a block.
 * #134/D42: `voice` is RETIRED — calling is included on every plan; the
 * fair-use minutes and 1¢/min overage stay exactly as D36/D38 shipped them
 * (that's usage, not packaging), with the figures living only in the
 * fair-use policy.
 * Old stashed/URL plan intents carrying retired ids are dropped by the
 * plan-intent whitelist exactly like any unknown value.
 */
export const PLAN_MODULE_IDS = ["regions_ca"] as const;
export type PlanModule = (typeof PLAN_MODULE_IDS)[number];

/**
 * Plan-builder add-on card display shape. The SOURCE OF TRUTH for add-on
 * copy/prices is the API catalog — GET /v1/billing/modules
 * (apps/api/src/billing/modules.ts MODULE_CATALOG) — and settings already
 * renders from it; `planModuleCardFromApi` in lib/settings/module-billing.ts
 * projects an API row into this shape.
 */
export interface PlanModuleCard {
  id: PlanModule;
  label: string;
  blurb: string;
  /** Human monthly price, e.g. "$5". */
  price: string;
  /** Concrete quantity line; omitted where there's no honest number to state. */
  detail?: string;
}

/**
 * #59: hand-kept mirror of the API MODULE_CATALOG
 * (apps/api/src/billing/modules.ts). It is read by every surface that cannot
 * (or does not yet) call GET /v1/billing/modules:
 *   - the onboarding plan builder (app/onboarding/plan/page.tsx) — could
 *     migrate to `useModules` + `planModuleCardFromApi`;
 *   - the marketing /pricing "Build your plan" strip
 *     (components/marketing/plan-addons.tsx) and the night pricing section
 *     (components/marketing/night/pricing.tsx), plus their tests — these are
 *     static, UNAUTHENTICATED pages that can never call the authed API, so
 *     this mirror survives even after onboarding migrates.
 * Only the settings billing card renders from GET /v1/billing/modules today.
 * WHEN RETUNING A PRICE OR QUANTITY you must edit modules.ts/plans.ts AND
 * this list — there is no runtime link. The real fix (#59's recommendation)
 * is moving the catalog to packages/shared and importing it from both apps;
 * until that lands, do NOT delete this constant. Values as of 2026-07-11:
 * regions_ca $5. (#103: mms retired — pictures included. #121: extra_storage
 * retired — storage is free, no caps. #134: voice retired — calling is
 * included on every plan; concrete allowance figures live only in the
 * fair-use policy.)
 */
export const PLAN_MODULE_CARDS: PlanModuleCard[] = [
  // #97/#103: no "Picture messages" card — MMS is included on every plan
  // (each picture counts as three texts from the monthly allowance).
  // #134/D42: no "Calling" card — calling is included on every plan
  // (fair-use minutes both directions; the figures live in the fair-use
  // policy, never sales copy).
  {
    id: "regions_ca",
    label: "Canada numbers",
    blurb: "Get and text Canadian numbers alongside your US number.",
    price: "$5",
  },
];

/**
 * #59-style hand-kept mirror of the plan table (apps/api/src/billing/plans.ts
 * PLAN_LIMITS / PLAN_INCLUDED_SEGMENTS / PLAN_OVERAGE_CENTS_PER_SEGMENT, and
 * SPEC §2 for the monthly prices the Stripe catalog charges). Read by the
 * static, unauthenticated marketing surfaces (the /pricing plan builder and
 * plan cards) that can never call the authed API, exactly like
 * PLAN_MODULE_CARDS above — every rendered plan figure must trace to THIS
 * object, never be retyped at a call site. WHEN RETUNING A PLAN you must edit
 * plans.ts / the Stripe prices AND this mirror; there is no runtime link.
 * Values as of 2026-07-09: Starter $29 / 3 seats / 1 number / 500 segments /
 * 3¢ overage; Pro $79 / 15 seats / 2 numbers / 2,500 segments / 2.5¢ overage.
 * Unlimited seats are only on the contact-sales Enterprise tier (#83), which
 * is not a billable plan and so has no entry here.
 */
export const PLAN_PRICING: Record<
  PlanId,
  {
    /** Flat monthly price in whole USD (SPEC §2). */
    monthlyDollars: number;
    /** Teammates included (PLAN_LIMITS.seats). Both self-serve plans are capped. */
    seats: number;
    /** Business numbers included (PLAN_LIMITS.numbers). */
    numbers: number;
    /** Outgoing texts (segments) included per month (PLAN_INCLUDED_SEGMENTS). */
    includedTexts: number;
    /** Overage price per extra outgoing text, in cents (PLAN_OVERAGE_CENTS_PER_SEGMENT). */
    overageCentsPerText: number;
  }
> = {
  starter: {
    monthlyDollars: 29,
    seats: 3,
    numbers: 1,
    includedTexts: 500,
    overageCentsPerText: 3,
  },
  pro: {
    monthlyDollars: 79,
    seats: 15,
    numbers: 2,
    includedTexts: 2500,
    overageCentsPerText: 2.5,
  },
};

/**
 * The one-time US carrier-registration fee in whole USD (SPEC §4.1: charged
 * at most once per company, ever; Canadian companies that never text US
 * numbers never pay it). Same hand-kept-mirror rules as PLAN_PRICING.
 */
export const US_REGISTRATION_FEE_DOLLARS = 29;

/** GET /v1/registration row — owner/admin additionally receive `data`. */
export interface RegistrationRow extends RegistrationSummary {
  id: string;
  data?: Record<string, unknown>;
}

export interface RegistrationState {
  brand: RegistrationRow | null;
  campaign: RegistrationRow | null;
}

/** POST /v1/registration/submit response. */
export interface RegistrationSubmitResult extends RegistrationState {
  action: string;
}

/** POST /v1/registration/enable-us response. */
export interface EnableUsResult {
  us_texting_enabled: true;
  invoice_id: string | null;
  action: string;
}

// ---------------------------------------------------------------------------
// port-requests (PORTING.md §6/§7 — bring your existing number)
// ---------------------------------------------------------------------------

/**
 * Telnyx porting-order status mirror (PORTING.md §1). The voice/order track;
 * `ported` means calls route to Telnyx (SMS may still lag — see
 * `messaging_port_status`).
 */
export type PortStatus =
  | "draft"
  | "in-process"
  | "submitted"
  | "exception"
  | "foc-date-confirmed"
  | "activation-in-progress"
  | "ported"
  | "cancel-pending"
  | "cancelled";

/** Messaging (SMS) sub-track (PORTING.md §1). `ported` unlocks Loonext texting. */
export type PortMessagingStatus =
  | "not_applicable"
  | "pending"
  | "activating"
  | "ported"
  | "exception";

/**
 * POST /v1/port-requests/check response (portability check, pre-payment
 * allowed). `reason` is present only when `portable` is false.
 */
export interface PortabilityCheck {
  portable: boolean;
  country: Country;
  is_wireless: boolean;
  fast_portable: boolean;
  messaging_capable: boolean;
  reason: string | null;
}

/**
 * A port request, as serialized by routes/porting.ts `sanitizePort`. The PII
 * columns (`pin_passcode`, `account_number`, `ssn_sin_last4`) NEVER leave the
 * server — only the `has_*` on-file booleans and the document booleans do
 * (PORTING.md §2.2 / §7).
 */
export interface PortRequest {
  id: string;
  phone_e164: string;
  country: Country;
  status: PortStatus;
  messaging_port_status: PortMessagingStatus;
  foc_date: string | null;
  foc_datetime_requested: string | null;
  rejection_reason: string | null;
  submission_count: number;
  entity_name: string;
  auth_person_name: string;
  billing_phone_number: string | null;
  service_street: string;
  service_extended: string | null;
  service_locality: string;
  service_admin_area: string;
  service_postal_code: string;
  is_wireless: boolean;
  wants_bridge_number: boolean;
  bridge_number_id: string | null;
  /**
   * PORTING.md D16: the opt-in temporary (bridge) number, present only while
   * it is live (`phone_numbers.status='active'`) — the GET routes resolve it;
   * mutation responses carry null and the card re-reads the list.
   */
  bridge_number_e164: string | null;
  has_pin: boolean;
  has_account_number: boolean;
  has_ssn_sin_last4: boolean;
  has_loa: boolean;
  has_invoice: boolean;
  /**
   * PORTING.md §8.2/§9: the post-port 10DLC campaign assignment FAILED —
   * typically the previous texting provider still holds the number in their
   * carrier campaign. Customer-actionable (ask them to release it); the port
   * card renders the §9 guidance from this flag.
   */
  assignment_blocked: boolean;
  submitted_at: string | null;
  ported_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
}

/** POST /v1/port-requests body (the `port_requests` intake, PORTING.md §6). */
export interface CreatePortRequestInput {
  phone_e164: string;
  entity_name: string;
  auth_person_name: string;
  billing_phone_number?: string;
  account_number: string;
  pin_passcode?: string;
  /** Wireless only — the last 4 of the account holder's SSN/SIN (stored last-4 only). */
  ssn_sin_last4?: string;
  service_street: string;
  service_extended?: string;
  service_locality: string;
  service_admin_area: string;
  service_postal_code: string;
  /** Optional requested cutover (ISO 8601 with offset). */
  foc_datetime_requested?: string;
  wants_bridge_number?: boolean;
}

/** PUT /v1/port-requests/:id body — the editable fix-and-resubmit fields. */
export type UpdatePortRequestInput = Partial<
  Omit<CreatePortRequestInput, "phone_e164" | "wants_bridge_number">
>;

// ---------------------------------------------------------------------------
// text-enablements (FEATURE-GAPS voice wave, path B — keep your number AND
// your carrier: a Telnyx hosted-SMS order adds texting to an existing
// landline; voice never moves)
// ---------------------------------------------------------------------------

/**
 * Hosted-order status mirror (routes/text-enablement.ts). Carrier review takes
 * a few business days; texting is live only at `completed` — the UI surfaces
 * these states plainly, never an invented progress percentage.
 */
export type TextEnablementStatus =
  | "pending"
  | "action-required"
  | "in-progress"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * How the number-ownership verification code is delivered to the number being
 * text-enabled (POST /v1/text-enablements/:id/verification-codes): a text, or
 * an automated call for a landline that can't receive SMS.
 */
export type TextEnablementVerificationMethod = "sms" | "call";

/**
 * A text-enablement order, as serialized by routes/text-enablement.ts
 * `sanitize()`. Vendor ids stay server-side — only the status, the document
 * on-file booleans, and the honest timestamps reach the client. `created_at`
 * is always present on fresh responses; kept nullable so pre-wave cached
 * shapes stay assignable (readers render the started line only when present).
 */
export interface TextEnablement {
  id: string;
  phone_e164: string;
  country: Country;
  status: TextEnablementStatus;
  has_loa: boolean;
  has_bill: boolean;
  last_error: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string | null;
}

export interface NotificationPrefs {
  email_enabled: boolean;
  push_enabled: boolean;
}

// ---------------------------------------------------------------------------
// for-you home (D23) + notifications read-model (D24)
// Shapes read from the api_for_you / api_notifications RPCs
// (supabase/migrations/20260702070000_appv2_for_you_notifications.sql) and the
// route handlers (apps/api/src/routes/{for-you,notifications}.ts) — never
// guessed.
// ---------------------------------------------------------------------------

/** One conversation card in the /for-you "Waiting on you" section. */
export interface ForYouWaiting {
  conversation_id: string;
  status: ConversationStatus;
  contact: ContactSummary | null;
  assigned_user_id: string | null;
  last_message_at: string;
  unread: boolean;
  has_overdue_task: boolean;
  /** 0 overdue-task · 1 waiting · 2 unread · 3 new (lower = more urgent). */
  urgency: number;
}

/** One task card in the /for-you "Your tasks" section. */
export interface ForYouTask {
  task_id: string;
  title: string;
  conversation_id: string;
  message_id: string;
  assigned_user_id: string | null;
  due_at: string | null;
  overdue: boolean;
}

/** One conversation card in the /for-you "Unread" section. */
export interface ForYouUnread {
  conversation_id: string;
  status: ConversationStatus;
  contact: ContactSummary | null;
  assigned_user_id: string | null;
  last_message_at: string;
}

/** One unassigned conversation in the owner/admin "Needs an owner" strip. */
export interface ForYouTriageConversation {
  conversation_id: string;
  status: ConversationStatus;
  contact: ContactSummary | null;
  last_message_at: string;
  unread: boolean;
}

/** One unassigned task in the owner/admin "Needs an owner" strip. */
export interface ForYouTriageTask {
  task_id: string;
  title: string;
  conversation_id: string;
  message_id: string;
  due_at: string | null;
  overdue: boolean;
}

/** The owner/admin-only triage strip; the whole field is null for a member. */
export interface ForYouTriage {
  conversations: ForYouTriageConversation[];
  tasks: ForYouTriageTask[];
}

/** GET /v1/for-you — the four-section focus queue (api_for_you RPC). */
export interface ForYou {
  waiting_on_you: ForYouWaiting[];
  my_tasks: ForYouTask[];
  unread: ForYouUnread[];
  /** null for a plain member (never leaked); the strip for owner/admin. */
  triage: ForYouTriage | null;
}

/** One derived notification (api_notifications RPC row). */
export type NotificationType =
  | "inbound_message"
  | "assigned"
  | "task_assigned"
  | "missed_call";

export interface NotificationItem {
  id: string;
  type: NotificationType;
  conversation_id: string | null;
  message_id: string | null;
  task_id: string | null;
  contact: ContactSummary | null;
  created_at: string;
  unread: boolean;
}

/** GET /v1/notifications/unread-count. */
export interface UnreadCount {
  count: number;
}

/** POST /v1/notifications/mark-read | mark-all-read. */
export interface MarkReadResult {
  last_seen_at: string;
}

/** POST /v1/push-subscriptions response. */
export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  created_at: string;
}

/** GET /v1/attachments/:id/url — signed Storage URL, TTL 1 hour. */
export interface AttachmentUrl {
  url: string;
  expires_at: string;
}

/**
 * The generic attachment owner discriminator the table CARRIES (D19 /
 * routes/attachments.ts). Read paths accept both; the UPLOAD door is
 * notes-only (D28) — `'task'` survives only on legacy pre-D28 rows.
 */
export type AttachmentOwnerType = "note" | "task";

/**
 * A generic (note/task) attachment row — the shape POST /v1/attachments returns
 * (201) and every GET /v1/attachments row carries (routes/attachments.ts
 * ATTACHMENT_COLUMNS; never `storage_path`). Distinct from the MMS-shaped
 * `AttachmentSummary` embedded on messages: this is the D19 user-upload table
 * (any file type, un-metered), keyed by `owner_type`/`owner_id`.
 */
export interface Attachment {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string;
  conversation_id: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
}

/**
 * Canonical gallery `source` enum (APP-FEATURES-V2 §4.2 / TASKS.md T7.3):
 * where an attachment came from. Mapped to the display tags Message / Note /
 * Task in the UI layer only.
 */
export type GallerySource = "mms" | "note" | "task";

/**
 * One item from GET /v1/conversations/:id/attachments (APP-LAYOUT-V2 §5.2 /
 * conversations-gallery route). The union of the MMS `message_attachments`
 * arm (joined through messages) and the generic D19 `attachments` table
 * (note + task), merged/sorted (created_at, id) DESC in the API. `url` is a
 * freshly-minted short-lived signed URL — the endpoint is the single
 * authorize+sign point, so the gallery never calls /v1/attachments/:id/url.
 * `kind` drives the Images | Files tabs.
 */
export interface GalleryItem {
  id: string;
  source: GallerySource;
  kind: "image" | "file";
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
  url: string;
}
