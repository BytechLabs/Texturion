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
  | "message_undone";

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
  /** Present on GET /v1/numbers rows; absent from the company-view embed. */
  suspended_at?: string | null;
  released_at?: string | null;
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
  created_at: string;
  updated_at: string;
  numbers: PhoneNumberSummary[];
  registration: {
    brand: RegistrationSummary | null;
    campaign: RegistrationSummary | null;
  };
}

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
  created_at: string;
  /**
   * Present on every message read surface (SPEC §7). POST /v1/conversations
   * returns the bare row — hooks normalize a missing array to [].
   */
  attachments?: AttachmentSummary[];
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
}

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
 * TASKS.md T5.2). A `Task` plus the generic-attachment count (D19).
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

/** GET /v1/tasks/:id — the full detail (row + resolved profiles + source). */
export interface TaskDetail extends Task {
  assignee: TaskProfile | null;
  created_by: TaskProfile | null;
  source_message: TaskSourceMessage | null;
  attachments: {
    id: string;
    file_name: string | null;
    content_type: string | null;
    size_bytes: number | null;
    created_at: string;
  }[];
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
  first_identification_sent_at: string | null;
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

/** GET /v1/usage — nulls when the company has never checked out. */
export interface Usage {
  period_start: string | null;
  period_end: string | null;
  included_segments: number;
  used_segments: number;
  overage_segments: number;
  cap_segments: number | null; // null = no cap
  projected_overage_cents: number;
  /** Last 6 calendar months, oldest first (empty pre-subscription). */
  history: UsageMonth[];
}

/** GET /v1/search conversation hit (api_search RPC). */
export interface SearchConversationHit {
  id: string;
  status: ConversationStatus;
  is_spam: boolean;
  last_message_at: string;
  contact: ContactSummary;
  matched_message_id: string;
  matched_at: string;
  snippet: string;
}

/** GET /v1/search — contacts ride along on the first page only. */
export interface SearchResult {
  conversations: SearchConversationHit[];
  contacts: ContactSummary[];
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

/** Messaging (SMS) sub-track (PORTING.md §1). `ported` unlocks JobText texting. */
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
  has_pin: boolean;
  has_account_number: boolean;
  has_ssn_sin_last4: boolean;
  has_loa: boolean;
  has_invoice: boolean;
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
export type NotificationType = "inbound_message" | "assigned" | "task_assigned";

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
