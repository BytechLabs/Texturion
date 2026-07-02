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
  | "spam_unmarked";

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

export interface NotificationPrefs {
  email_enabled: boolean;
  push_enabled: boolean;
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
