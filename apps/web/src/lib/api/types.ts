import type { BillingCurrency } from "@loonext/shared";
import {
  OVERAGE_CENTS_PER_SEGMENT,
  PLAN_PRICE_CENTS,
  PLAN_SEATS,
  US_REGISTRATION_FEE_CENTS,
} from "@loonext/shared";
import type { PipelineStage } from "@loonext/shared";
import type { DeferralKind } from "@loonext/shared";

/**
 * API resource shapes, derived by reading apps/api/src/routes/*.ts (never
 * guessed — SPEC §7 is the contract, the route files are the truth).
 */
import type {
  HoursException,
  Locale,
  MmsMediaKind,
  NumberAccessExplanation,
  VoicemailIntake,
} from "@loonext/shared";

/**
 * #348: GET /v1/numbers/access/explain/:userId — what one member reaches on
 * every number, and which rule decided it. Owner/admin only.
 */
export interface MemberNumberAccess {
  user_id: string;
  numbers: NumberAccessExplanation[];
}

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "active"
  | "past_due"
  | "unpaid"
  | "canceled";
/**
 * #315: one definition, in @loonext/shared, beside the capability table. The
 * web app used to keep its own copy, which is how it came to disagree with the
 * server about which roles exist the moment a preset was added.
 */
import type { MemberRole } from "@loonext/shared";

export type { MemberRole };
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
  /** #423: the carrier took an approved registration away. Distinct from
   *  `rejected` (review said no before we were live) and from
   *  `deactivated_at` (we stopped paying for it). */
  | "suspended"
  | "rejected";
export type ConsentSource = "inbound_sms" | "attested";
export type OptOutSource = "stop_keyword" | "manual" | "import" | "carrier";
export type ConversationEventType =
  | "status_changed"
  | "assigned"
  | "tag_added"
  | "tag_removed"
  | "opted_out"
  | "opt_out_revoked"
  | "consent_attested"
  | "quiet_hours_confirmed"
  // #237: the customer answered a reminder. Actor is null — they have no
  // user row — which is why its system line carries no name.
  | "appointment_confirmed"
  // #313: the customer answered "how did it go?". Actor is null, same as above.
  | "job_rated"
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
  | "call_completed"
  // #317 — an inbound attachment the server declined to store (actor NULL).
  // There is NO attachment row for it, which is the point: this event is the
  // only record, and without the line the crew sees a text with no picture and
  // assumes the customer forgot to attach one. payload:
  // { reason: 'unsupported_type'|'too_large'|'empty'|'type_mismatch'
  //           |'unsafe_content'|'unreadable'   (#317, with scan_reason)
  //           |'too_many_items',
  //   message_id, index, content_type, size_bytes }. Deliberately carries
  // neither the file name nor the source URL — the name is attacker-controlled
  // text we would render, and the URL is a live handle to bytes we refused.
  | "media_refused";

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
  /**
   * Whether the account has a password at all. The Supabase identities array
   * cannot answer this: setting a password on a Google account creates no
   * 'email' identity, so Settings must read this instead.
   */
  has_password?: boolean;
  /**
   * #386: null when email can reach this person, which is the common case.
   * Present when their address hard-bounced or reported us as spam — the only
   * symptom otherwise is that their notifications stop, which looks exactly
   * like a quiet week.
   */
  email_state?: EmailState | null;
  company?: CompanyView;
  /**
   * #283: the client-side flags for the active workspace.
   *
   * Only `kill:realtime` today, and only because it is the one switch the
   * server cannot enforce — clients hold their own Supabase token and open
   * their own socket, so there is nothing for the Worker to refuse. Optional
   * so a response from a server that predates it still decodes, and absent
   * always reads as "no statement", never as "off".
   */
  flags?: Record<string, boolean>;
}

/** #235: a number a carrier has started filtering or labelling. */
export interface NumberHealth {
  /** Always 'degraded' when present — healthy numbers carry no row. */
  state: string;
  /** 0-1 over the assessment window, or null when there was too little to say. */
  delivery_rate: number | null;
  /** When it first left healthy, so the banner can say how long. */
  degraded_since: string | null;
  /** Plain language: "delivery 54% against a baseline of 97%". */
  detail: string | null;
}

/** #386: why we cannot email this member, and whether they can fix it. */
export interface EmailState {
  email: string;
  /** `hard_bounce` — the address rejected us. `complaint` — they reported us as spam. */
  reason: "hard_bounce" | "complaint";
  since: string;
  /**
   * True only for a hard bounce. A complaint is not ours to undo: pressing a
   * button in our app is not consent to resume mailing somebody who marked us
   * as spam.
   */
  fixable: boolean;
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
  /**
   * #366: how many people an inbound call to this number could ring, and the
   * ceiling on how many it actually will. Optional so a cached pre-#366 shape
   * stays assignable; null when the server could not resolve it, which reads
   * as "nothing to say" rather than as zero.
   */
  ring_targets?: number | null;
  ring_target_limit?: number;
  /**
   * #235: this number's delivery health, present only when it is DEGRADED —
   * a carrier or analytics vendor is filtering or labelling it. `null` or
   * absent means healthy, which is also what an unassessed number reads as.
   *
   * The internal 'watch' state never appears here; the server flattens it.
   */
  health?: NumberHealth | null;
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
  /**
   * #314: when the owner required two-factor, and when it starts to bite.
   * Readable by every member, not just the owner — a deadline you discover
   * as a wall is not a deadline you were given.
   */
  mfa_required_at?: string | null;
  mfa_grace_until?: string | null;
  /** D15: workspace IANA timezone (business-facing daily framing). */
  timezone: string;
  /**
   * #228: the language the automated texts go out in. Never null. Every
   * workspace has one, and it is the answer a contact without a language of
   * their own inherits.
   */
  locale: Locale;
  plan: PlanId | null;
  /**
   * #328: what this workspace is charged in. Absent on a client that predates
   * the column, which `billingCurrencyOf` reads as USD — every workspace that
   * existed before this shipped is on USD anyway.
   */
  billing_currency?: BillingCurrency;
  subscription_status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  overage_cap_multiplier: number | string | null;
  registration_fee_paid_at: string | null;
  canceled_at: string | null;
  /** #481: what a departing owner's customers are told. Null = off. */
  offramp_message?: string | null;
  offramp_opted_in_at?: string | null;
  /** SPEC §9: Stripe's pending period-end cancellation, mirrored by webhook. */
  cancel_at_period_end: boolean;
  /** FEATURE-GAPS Step 1 — after-hours away reply (company-local clock). */
  business_hours: BusinessHours;
  /**
   * #402: dates that override the weekly loop — Christmas is not a working
   * Thursday. Optional so a cached pre-#402 company shape stays assignable.
   */
  business_hours_exceptions?: HoursException[];
  away_enabled: boolean;
  away_message: string | null;
  /** #414 ask 5: the template that will ACTUALLY send — the owner's text if
   *  they wrote one, else the product default. The server resolves it so no
   *  client has to carry its own copy of the default (three did, and nothing
   *  kept them equal). */
  away_effective_message: string;
  /** True when the owner's own away text is in effect. */
  away_message_is_custom: boolean;
  /** #414: whether a customer replying URGENT/EMERGENCY/911/SOS wakes the
   *  whole crew at high priority, exempt from the daily notification limit.
   *  On by default, because the away-message copy that asks for it is. */
  emergency_keyword_enabled: boolean;
  /** #460: the workspace's own emergency words, or null for the product list.
   *  Null means "use the default", never "watch for nothing" — a stored copy of
   *  the defaults would freeze whatever they were on signup day. */
  emergency_keywords: string[] | null;
  /** #460: the workspace's own reply to an emergency word, or null for the
   *  product default. Never what is actually SENT — see below. */
  emergency_message: string | null;
  /** #460: the words the inbound handler will really match on, resolved by the
   *  SERVER. Every screen that warns about an unrecognised reply word must read
   *  THIS, or it warns about a list nothing uses. */
  emergency_effective_keywords: string[];
  /** #460: what actually lands on the customer's phone — the effective body
   *  PLUS the safety sentence no setting removes (#414 ask 4). Composed on the
   *  server for the same reason `away_effective_message` is: three clients
   *  concatenating a safety line by hand is three chances to drop it. */
  emergency_effective_message: string;
  /** True when the owner's own emergency reply is in effect. */
  emergency_message_is_custom: boolean;
  /** True when the owner set their own words rather than using the defaults. */
  emergency_keywords_are_custom: boolean;
  /**
   * #392: the seat allowance, served rather than recomputed. A pricing lever
   * that needed a client release to pull was not a lever, and a client copy
   * higher than the API's tells an owner they have room and then 409s them.
   */
  seat_limit?: number;
  /** #388: chase a new lead nobody has answered. On by default — it re-alerts
   *  only the people who were already told once. */
  lead_chase_enabled: boolean;
  /** #388: widen an unanswered ASSIGNED lead to the whole crew at five
   *  minutes. Off by default — this is the rung that tells people who were
   *  not told before, and the one that can become a klaxon. */
  lead_chase_crew_enabled: boolean;
  /** #430: whether a push may carry words a person typed. Workspace-wide. */
  push_include_content: boolean;
  /** FEATURE-GAPS voice wave — missed-call text-back settings. */
  mctb_enabled: boolean;
  mctb_message: string | null;
  /** #192: the template the server will actually send — the owner's
   *  non-blank text, else the product default. */
  mctb_effective_message: string;
  /** #192: true when the owner's own text is in effect. */
  mctb_message_is_custom: boolean;
  /** #393: whether a first outbound message to a contact is signed with the
   *  business name. Default false — D4's 2026-07 reversal stands. */
  first_message_identification: boolean;
  /**
   * #225: whether STARTING a conversation into a destination inside its
   * 8pm-8am local window asks for a confirmation. Governs that prompt only —
   * automated sends are held to the window regardless.
   */
  quiet_hours_confirm_enabled: boolean;
  /**
   * #298: whether members may INVENT tags, or only use the set that already
   * exists. Default false and meant to stay that way for most shops — a crew
   * that has BUILT a vocabulary and wants it held still is the case this is
   * for. Attaching an existing tag is never restricted.
   */
  tags_locked: boolean;
  /** #393: the EXACT suffix such a message will carry, or null when the setting
   *  is off (or the company name is blank). Render and METER this string —
   *  never compose it here, or the count can drift from what is billed. */
  first_message_identification_suffix: string | null;
  /** D43 Calls v2 — voicemail greeting (null = the spoken default), the
   *  carrier-screening routing choice, and the CNAM pair (outbound display
   *  name <=15 alphanumeric+space; inbound name-dip toggle). */
  voicemail_greeting: string | null;
  /** #309: the workspace's default RECORDING, or null for the written words. */
  voicemail_greeting_id: string | null;
  /** #278: what an inbound call does outside business hours. `ring_everyone`
   *  is the default and is the product exactly as it behaved before #278. */
  after_hours_calls: "ring_everyone" | "on_call_only" | "voicemail";
  /** #278: the recording played after hours; null falls back to the ordinary
   *  greeting, never to silence. */
  after_hours_greeting_id: string | null;
  /** #278: every phone at once, or joining the ring one at a time. */
  ring_strategy: "all" | "in_turn";
  /** #278: how long they ring before the caller gets the greeting. Capped at
   *  45 — the call legs themselves end there. */
  ring_seconds: number;
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
  /**
   * #298: what this tag MEANS, in the crew's own words. Null when nobody has
   * said — which is most of them, and must stay comfortable: a required
   * description would be answered with "warranty" for a tag named Warranty by
   * everybody in a hurry, and that looks like an answer without being one.
   */
  description?: string | null;
  /**
   * #354: which marketed pipeline stage this tag IS, independent of what the
   * crew renamed it to. Null for tags a crew invented, absent on the embedded
   * summaries. Everything that reads the pipeline reads this — matching on the
   * NAME is the coupling the stage key exists to remove.
   */
  pipeline_stage?: PipelineStage | null;
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
  /** #414: when this thread last carried an emergency reply (URGENT/EMERGENCY/
   *  911/SOS). The inbox badges it while the thread is open. */
  emergency_at: string | null;
  /**
   * #396: when an inbound message on this thread last READ as a plain-English
   * opt-out ("stop texting me", "take me off your list").
   *
   * A WARNING for whoever replies next, never an opt-out. Only the contact can
   * opt out and only they can lift it, so the product refuses to guess on their
   * behalf — a wrong guess would silence a real lead permanently.
   */
  opt_out_hint_at?: string | null;
  /**
   * #301: where this customer came from, and how we came to believe it.
   *
   * The ORIGIN travels with the id and is not optional in the sense that
   * matters: a source shown without it is exactly the "inferred source
   * presented as a fact" the issue forbids. "The truck rang" and "a tech says
   * a neighbour sent them" are different kinds of claim.
   */
  lead_source_id?: string | null;
  lead_source_origin?: "number" | "manual" | null;
  /**
   * #250: when the inbound classifier last scored this thread above the
   * threshold. Never set by a person, and never a reason to hide the
   * thread — it suppressed the notification and nothing else.
   */
  spam_suspected_at?: string | null;
  /** #250: the reasons behind it, so the badge can say WHY. */
  spam_signals?: SpamSignal[] | null;
  /**
   * #388 lead clock: when the first inbound of a new or reopened thread landed,
   * cleared by a human outbound. Non-null therefore means "nobody has answered
   * this yet" — the predicate behind #508's Unanswered filter and the live twin
   * of the response-time card's unanswered count.
   *
   * Optional because a payload assembled before this was read (an older cached
   * page) simply does not carry it; readers must treat missing as UNKNOWN, not
   * as answered.
   */
  awaiting_reply_since?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * #250: one reason the classifier scored a thread.
 *
 * Hand-copied across the wire boundary from
 * apps/api/src/messaging/spam-signals.ts — it is not in @loonext/shared,
 * because the scoring itself never runs on a client.
 */
export interface SpamSignal {
  key: string;
  weight: number;
  /** A full sentence, rendered verbatim. */
  why: string;
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
  /** How many attachments ride the last message (0 when none). */
  attachment_count: number;
  /** The kind they all share, 'file' for a mixed set, null when there are none.
   * The inbox labels from THIS instead of guessing (migration 20260724080000). */
  attachment_kind: MmsMediaKind | null;
}

/** GET /v1/conversations row (api_list_conversations RPC). */
/**
 * #293: when THIS member's deferral brings the thread back, and why they
 * deferred it. Null for everyone else — the snooze is mine, the conversation is
 * the crew's — and null once the return time has passed, because the server
 * computes "currently deferred" rather than sweeping rows on a timer.
 *
 * Optional because the PATCH response and the realtime payloads carry the bare
 * conversation row; readers treat a missing field as "not deferred", which is
 * what every surface written before #293 already assumed.
 */
export interface SnoozeState {
  snoozed_until?: string | null;
  snooze_note?: string | null;
  /**
   * #293: how it comes back — 'snooze' quietly, 'follow_up' as something to
   * chase. Carried on the DETAIL only: the list cannot tell "back Thursday"
   * from "chase them Thursday", and in the thread that is the difference
   * between a reminder and a nap.
   */
  snooze_kind?: DeferralKind | null;
}

export interface ConversationListItem extends Conversation, SnoozeState {
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
  /**
   * #241: why the send failed, in OUR taxonomy rather than the carrier's.
   * Optional — absent on rows written before the column existed, so readers
   * use `failureReasonOf(error_reason, error_code)`, which falls back to
   * classifying the code.
   */
  error_reason?: string | null;
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
  /** #291: for quotes and receipts. Null on nearly every contact today. */
  email?: string | null;
  /** #291: who they work for, when that is the relationship. */
  business_name?: string | null;
  notes: string | null;
  consent_source: ConsentSource | null;
  consent_at: string | null;
  deleted_at: string | null;
}

/**
 * #225 / D49 — what time it is where the customer is, and which rung of the
 * ladder answered. Resolved server-side by the same module the send gate uses,
 * so a hint and a gate can never disagree.
 */
export interface DestinationClock {
  timezone: string;
  source: "contact" | "area_code" | "company";
  local_hour: number;
  /** Inside their quiet window, accounting for state rules (Texas Sundays). */
  quiet: boolean;
}

/** GET /v1/conversations/:id — embeds the first page of messages. */
export interface ConversationDetail extends Conversation, SnoozeState {
  contact: ConversationDetailContact;
  tags: Tag[];
  messages: Page<Message>;
  /** Null only when a conversation somehow has no contact. */
  destination_clock: DestinationClock | null;
  /** #106: the caller's access level on this conversation's number — 'note'
   *  means read + internal notes only (the composer hides its SMS mode). */
  viewer_level: "text" | "note";
  /**
   * #244: an after-hours page on this thread that nobody has claimed. Null on
   * nearly every thread — and null once somebody takes it, because an
   * acknowledged alert is history the timeline already records.
   */
  open_alert: {
    id: string;
    kind: string;
    on_call_user_id: string | null;
    /** Resolved server-side (#482), null when the profile row is missing. */
    on_call_name: string | null;
    created_at: string;
  } | null;
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
/** #214 where a task's address came from — drives the provenance badge. */
export type AddressProvenance = "message" | "contact" | "company" | "manual";

/** #214 a structured task/job address (create/update body + enrichment result). */
export interface TaskAddress {
  street: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

/**
 * #214 the POST /v1/tasks/enrich result — a pure SUGGESTION the user reviews
 * before saving. Any field may be null (toggle off, nothing found, degraded).
 */
export interface TaskEnrichment {
  address: TaskAddress | null;
  /** The model's provenance; never "manual" (that's a user edit, client-side). */
  address_provenance: Exclude<AddressProvenance, "manual"> | null;
  due_at: string | null;
  /** True when the endpoint short-circuited because every toggle is off. */
  enrichment_disabled?: boolean;
}

/** #214 per-company enrichment opt-in (Settings → AI). */
export interface CompanyAiSettings {
  enrich_task_address: boolean;
  enrich_task_due: boolean;
  /** Offer AI-drafted replies in the composer. Drafts are never sent for you. */
  suggest_replies: boolean;
  /**
   * One sentence about what the business does, used to ground Lou's drafts.
   * Null means Lou has been told nothing and may not describe the business.
   */
  business_description: string | null;
  /**
   * Transcribe new voicemails. Off leaves the recording exactly as it was:
   * this only decides whether the words appear beside it.
   */
  transcribe_voicemail: boolean;
  /**
   * #367/D89: ask callers for the problem and the address in the voicemail
   * greeting, and break the transcript out into those fields.
   *
   * The one Lou setting that is OFF until somebody turns it on, because it is
   * the only one that changes what a CALLER hears rather than what a member
   * reads.
   */
  voicemail_intake: boolean;
  /**
   * #507: whether a crew member can DICTATE a post-call wrap-up instead of
   * typing it. Off leaves the note composer exactly as it is — the words were
   * always typeable, this only decides whether they can be spoken.
   *
   * Their own voice, about a call that has ENDED. Never the customer's, never
   * the call itself; D117 is why that distinction is load-bearing rather than
   * decorative, and no copy attached to this flag may blur it.
   */
  call_wrapup: boolean;
}

/** POST /v1/conversations/:id/reply-suggestions — up to three reviewed drafts. */
export interface ReplySuggestions {
  suggestions: string[];
  /**
   * Lou has not been told what this business does. The prompt forbids it from
   * saying anything about the trade without that line, so every draft is
   * thinner until someone writes it.
   */
  business_unknown?: boolean;
  /** True when the company turned suggestions off (hide the affordance). */
  suggestions_disabled?: boolean;
  /**
   * Why the list is empty. Every failure used to look identical to the person
   * waiting ("nothing to suggest"), which hid real breakage — the founder hit
   * exactly that. Absent on success.
   */
  reason?:
    | "disabled"
    | "nothing_to_reply"
    | "unavailable"
    | "rate_limited"
    | "over_cap"
    | "model_error"
    | "unusable_output"
    // #250: the thread is marked spam, so no budget is spent drafting a warm
    // reply to a robotext.
    | "spam";
}

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
  /**
   * #237: whether this job texts its customer before it happens, and whether
   * they said they would be there.
   *
   * `confirmed_by` matters as much as `confirmed_at`: 'crew' is a note to
   * ourselves and 'customer' is a promise, and a screen that showed them the
   * same way would let a dispatcher trust the weaker of the two.
   *
   * Optional so a response from a server predating the reminders migration
   * still decodes — the panel reads them defensively.
   */
  reminders_off?: boolean;
  confirmed_at?: string | null;
  confirmed_by?: "customer" | "crew" | null;
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
  /**
   * #214 structured job address + provenance. Nullable — a task without an
   * address has all-null fields (addr_provenance null). Returned by every task
   * read (TASK_COLUMNS); forward-compatible with pre-#214 rows (all null).
   */
  addr_street: string | null;
  addr_unit: string | null;
  addr_city: string | null;
  addr_state: string | null;
  addr_postal_code: string | null;
  addr_country: string | null;
  addr_provenance: AddressProvenance | null;
  /**
   * The task's OWN geocoded address (task_geocode cron), null until resolved.
   * The Map view PREFERS this over the contact's geocode so a task pins at its
   * job site, not where the contact lives. Optional (a mutation response may
   * omit it); reads via TASK_COLUMNS carry it.
   */
  lat?: number | null;
  lng?: number | null;
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
  /**
   * #291: for quotes (#287) and receipts (#224), and as the fallback a human
   * can use when a text will not reach somebody. Null on nearly every contact
   * until a crew fills it in.
   */
  email?: string | null;
  /**
   * #291: the company this customer represents, when they represent one. For
   * a property manager or a general contractor it is most of the record.
   */
  business_name?: string | null;
  /**
   * #291: values for the fields this workspace defined, keyed on the field's
   * key. Absent on every contact nobody has filled one in for, which is most
   * of them — and on the LIST projection, which does not carry them.
   */
  custom_fields?: Record<string, string> | null;
  consent_source: ConsentSource | null;
  consent_at: string | null;
  consent_attested_by: string | null;
  /** #393: null means a first outbound to this contact would be signed, so the
   *  composer folds the suffix into its segment count. Non-null means they have
   *  already been told who we are and the suffix is not appended again. */
  first_identification_sent_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * #191: who created / last edited this contact record, resolved to a
   * company-member display name server-side (the same actor join used for
   * message senders and assignment actors). Both are null for contacts that
   * predate attribution — no backfill lie — and the UI shows the attribution
   * line only when the name resolves.
   */
  created_by_user_id: string | null;
  created_by_name: string | null;
  updated_by_user_id: string | null;
  updated_by_name: string | null;
  /**
   * #292/D49: a person's CORRECTION to the area-code inference, or null to
   * keep inferring. Never a cached copy of the inferred zone — that would go
   * stale the day the area-code table is fixed, with nothing to distinguish it
   * from a deliberate choice. Read {@link ContactDetail.timezone_resolved} for
   * the answer actually in force.
   */
  timezone: string | null;
  /**
   * #228: this customer's OWN language, or null to follow the workspace's.
   *
   * Null is not English. A workspace that switches to fr-CA moves every
   * customer nobody has said otherwise about, including the ones added years
   * earlier, so anything reading this must resolve against
   * {@link CompanyView.locale} rather than defaulting on its own.
   *
   * Optional because the LIST projection does not carry it, the same reason
   * `custom_fields` is: absent and null would otherwise be indistinguishable,
   * and only one of them means the customer follows the workspace.
   */
  locale?: Locale | null;
}

/**
 * GET /v1/contacts/:id and GET /v1/contacts list rows add the app-side
 * opt-out state (the G6 opted-out badge).
 */
export interface ContactDetail extends Contact {
  /**
   * #291: primary first, then oldest. Empty for every contact that predates
   * the feature — `address` still holds their one address and still works.
   */
  addresses?: {
    id: string;
    label: string | null;
    address: string;
    is_primary: boolean;
    created_at: string;
  }[];
  /**
   * #291: the OTHER numbers this customer answers, oldest first. There is no
   * primary among them — `phone_e164` on the record above IS the primary.
   * Empty for nearly every contact, which is the honest answer rather than a
   * gap: most customers have one line.
   */
  phones?: {
    id: string;
    phone_e164: string;
    label: string | null;
    created_at: string;
  }[];
  opted_out: boolean;
  /**
   * Which kind of opt-out this is, because only some of them can be undone
   * from inside the app.
   *
   * "stop_keyword" and "carrier" are both CARRIER blocks (#331): the first is
   * a STOP our webhook saw, the second one we learned about afterwards —
   * Telnyx refused a send, or the nightly reconciliation found the number on
   * their list and not ours. Either way the block lives at the carrier, so
   * clearing our record would not lift it and every send would still be
   * rejected. Use {@link isCarrierEnforcedOptOut} rather than comparing to one
   * of them. "manual" and "import" are records someone in the office made,
   * with no carrier involved. Null when the contact is not opted out.
   */
  opt_out_source: OptOutSource | null;
  /**
   * #410: how many conversations this contact has had, and when the first one
   * was. Derived server-side so three clients cannot each count differently,
   * and scoped to the numbers the caller may see. Optional: the fixtures that
   * predate it omit both, and a missing count reads as no history.
   */
  conversation_count?: number | null;
  first_conversation_at?: string | null;
  /**
   * #292/D49: what time it is where they are, resolved the same way a send
   * resolves it — a person's correction, else the area code, else the shop's
   * own clock. `timezone_source` says which rung answered, so a screen can be
   * honest about a guess instead of presenting it as a fact.
   */
  timezone_resolved: string;
  timezone_source: "contact" | "area_code" | "company";
  /** 0–23 there, at the moment the detail was read. */
  local_hour: number;
}

/**
 * #342 — one spam-marked thread whose activity does not look like spam.
 *
 * A thread marked spam appends silently, never notifies, and is frozen at the
 * moment it was marked so it sinks in every list including the spam filter.
 * That is right for a robotexter and catastrophic for a mis-tap: the customer
 * keeps texting and the business believes they stopped. These are the ones
 * worth a second look — never all of them, or the review strip becomes the
 * noise the silence exists to remove.
 */
export interface SpamReviewItem {
  conversation_id: string;
  contact: ContactSummary | null;
  marked_at: string;
  marked_by_user_id: string | null;
  /** Inbound messages since the mark (or since it was last confirmed). */
  inbound_since: number;
  /** The REAL latest inbound time — not the frozen list sort key. */
  last_inbound_at: string;
  /** We texted this number before marking it. The strongest signal by far. */
  we_texted_them: boolean;
  /** Messages spread across days rather than one burst. */
  sustained: boolean;
  /** Enough of them to be worth a glance regardless. */
  high_volume: boolean;
}

/**
 * Whether this opt-out is enforced by the carrier — the ones nobody here can
 * undo, whatever the UI offers. A predicate rather than a comparison because
 * #331 added a second source that behaves identically, and every site that
 * had hard-coded "stop_keyword" would silently have started offering a revoke
 * the API answers with a 409.
 */
export function isCarrierEnforcedOptOut(
  source: OptOutSource | null | undefined,
): boolean {
  return source === "stop_keyword" || source === "carrier";
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
  /**
   * #274: the crew's own grouping. Free text and optional — a taxonomy we
   * imposed would be ignored, and a category is worth typing at thirty
   * templates and friction at five.
   */
  category?: string | null;
  /** #274: how many times this reply has been sent. Present only on the
   *  use-sorted list the picker asks for. */
  uses?: number;
  created_by: string | null;
  /** #419: who last edited this shared copy. Null = nobody has since it existed. */
  updated_by: string | null;
  /** #419: that editor's display name, resolved server-side (#191 attribution)
   *  so three clients cannot disagree. Null when the id resolves to nobody. */
  updated_by_name: string | null;
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

/**
 * What a member is still carrying (#276) — open conversations assigned to
 * them and live tasks they own. The numbers the removal flow asks about.
 */
export interface MemberHoldings {
  conversations: number;
  tasks: number;
}

/** What removing someone actually did (#276) — so the confirmation can say. */
export interface OffboardResult {
  conversations_moved: number;
  tasks_moved: number;
  sessions_ended: number;
  push_devices_removed: number;
}

/**
 * One privileged change, from GET /v1/audit-log (#231). The table it comes
 * from is append-only at the database level, so a row here is what actually
 * happened — not what someone later decided it should say.
 */
export interface AuditEntry {
  id: string;
  /** Null when the system acted (a scheduled job, a provider webhook). */
  actor_user_id: string | null;
  actor_name: string | null;
  actor_ip: string | null;
  /** Dotted `subject.verb`, e.g. "member.role_changed". */
  action: string;
  target_type: string;
  target_id: string | null;
  /** Shape of the change — never message bodies or customer content. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  occurred_at: string;
}

/**
 * A teammate who may be named on a note in one conversation. Narrower than
 * Member on purpose: this list is already filtered by number access, so it
 * carries only what the picker renders.
 */
export interface MentionableMember {
  user_id: string;
  role: MemberRole;
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
  /**
   * #521: what the inviter told this person, or null when they left it blank.
   *
   * The API returns it on the team list on purpose. There is no edit path by
   * design, so a read path is the only way whoever sent the invite can check
   * what it says before the new member reads it once and it is gone.
   */
  note: string | null;
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
  /** Stored MMS media of every kind — photos, audio, video, PDFs, cards. */
  mms_bytes: number;
  /** Media a customer sent us. */
  received_media_bytes: number;
  /** Media we sent out. */
  sent_media_bytes: number;
  /** Voicemail recordings we keep in our own bucket. */
  voicemail_bytes: number;
  /** Anything stored that the named kinds do not account for. */
  other_bytes: number;
  /** Every byte this workspace holds, measured from the buckets themselves. */
  total_bytes: number;
}

/**
 * #426 — carrier-reported delivery, split by where the message was going.
 *
 * The NAME is load-bearing. A delivery receipt means a carrier acknowledged
 * handoff, not that a person read it, and some carriers report optimistically.
 * Every surface must say "carrier-reported" rather than "delivered".
 */
export interface UsageDeliveryCountry {
  /** "US" | "CA" | "other" — the destination's country, from its area code. */
  country: string;
  delivered: number;
  failed: number;
  /** Accepted by us, not yet acknowledged by a carrier. Not a failure. */
  pending: number;
  /**
   * delivered / (delivered + failed), or NULL when too few have settled to
   * mean anything. Render counts, never a percentage, when this is null: one
   * failure out of forty reads as 2.5% and almost always means a disconnected
   * number, which is manufactured anxiety rather than information.
   */
  rate: number | null;
}

export interface UsageDelivery {
  by_country: UsageDeliveryCountry[];
  delivered: number;
  failed: number;
  pending: number;
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
/** One AI feature's month on the usage screen. */
export interface AiFeatureUsage {
  /** The ledger key, so a row is matched on identity rather than on copy. */
  key: string;
  label: string;
  used: number;
  cap: number;
  /** False when the workspace has this feature switched off. */
  enabled: boolean;
  /**
   * #431 ask 3 — what people did with the output, beside what it cost.
   *
   * Server-labelled in each feature's own words ("sent as written", "cleared")
   * so all three clients say the same thing. EMPTY until outcomes arrive, and an
   * empty list must render as "not measured yet", never as three zeroes: a
   * feature used forty times with nothing recorded is an instrumentation gap,
   * and showing it as "0 sent as written" reports that gap as a quality result.
   */
  outcomes: { label: string; count: number }[];
  /**
   * How many outcomes those lines cover. Separate from `used` because they will
   * not match — a draft offered and never looked at is a request with no
   * outcome — and no rate is computed anywhere, deliberately.
   */
  outcomesRecorded: number;
}

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
  /**
   * What Lou has done this month, per feature. Absent from a Worker deployed
   * before this shipped, so every reader must default it.
   */
  ai?: AiFeatureUsage[];
  /** #12: calling minutes used vs the plan allowance (both directions). */
  voice: UsageVoice;
  /**
   * #426: carrier-reported delivery for this period, split by destination.
   * Null when the read failed — the page still renders everything else.
   * Absent from a Worker deployed before this shipped, so readers default it.
   */
  delivery?: UsageDelivery | null;
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
  /**
   * What the voicemail says, written best-effort after the recording is
   * stored. Null means it was not transcribed (turned off, over the monthly
   * cap, too long, or the model failed) and is never a reason to hide the
   * audio.
   */
  voicemail_transcript: string | null;
  /**
   * #367: what the caller said, pulled out of the transcript — the problem,
   * the address, a callback number, a name. Extraction only, never a judgement
   * about urgency, and null whenever there is nothing to show.
   */
  voicemail_intake: VoicemailIntake | null;
  answered_by_user_id: string | null;
  /** #191: the acting member's display name — the PLACER of an outbound call, the
   *  ANSWERER of an inbound one. Null when the actor is unknown (pre-#211 outbound,
   *  an un-answered call, or a blank profile). */
  answered_by_name: string | null;
  started_at: string;
  /**
   * #170/#208 CALLS-V3 §3/§8.4: the DO-mirrored live phase. NULLABLE by
   * design — legacy rows and every outbound row are null; readers derive
   * from `outcome` when absent. Optional so cached pre-v3 shapes stay
   * assignable (same posture as PhoneNumberSummary.source).
   */
  state?:
    | "ringing"
    | "answered"
    | "voicemail_greeting"
    | "voicemail_recording"
    | "ended_answered"
    | "ended_voicemail"
    | "ended_missed"
    | "ended_rejected"
    | null;
  /**
   * #210: when a member picked up — the Ongoing card's live-duration anchor.
   * Optional until the api_list_calls projection ships it; readers fall back
   * to started_at.
   */
  answered_at?: string | null;
}

/**
 * GET /v1/calls/:sessionId — #336. The list row plus the fields only a detail
 * surface has room for.
 */
export interface CallDetail extends Call {
  ended_at: string | null;
  /**
   * Whether there is a recording to play. The storage path itself never leaves
   * the server; the signed URL is minted on demand by the voicemail endpoint.
   */
  has_voicemail: boolean;
  /**
   * When we last TRIED to write the words down. Non-null with a null
   * transcript is the honest "we tried and there was nothing" — distinct from
   * never having tried, which is what a null here means. The pipeline is
   * best-effort by design, so this is a normal state rather than an error.
   */
  voicemail_transcript_attempted_at: string | null;
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
 * GET /v1/search voicemail hit (#409) — the words we paid to write down.
 * `call_session_id` is the #336 permalink key, so a hit has somewhere to land.
 */
export interface SearchVoicemailHit {
  id: string;
  call_session_id: string;
  contact_id: string | null;
  caller_e164: string | null;
  started_at: string;
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
  voicemails: SearchVoicemailHit[];
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
    /**
     * Flat monthly price in whole USD (SPEC §2).
     *
     * #328: derived from the shared price book rather than retyped. This used
     * to be a hand-kept mirror of a number that also lived in the API's cost
     * model and in the Stripe catalog script, and "hand-kept" is how a pricing
     * page ends up quoting a figure the invoice does not.
     *
     * USD only, deliberately. A workspace's own currency comes from its
     * `billing_currency`, and marketing reads the visitor's country — neither
     * is knowable from a module constant.
     */
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
    monthlyDollars: PLAN_PRICE_CENTS.usd.starter / 100,
    // #392: derived, never retyped. Web carried TWO unlinked copies of the
    // seat number — this one and lib/settings/seat-line.ts — and nothing kept
    // them equal. The seat ceiling is the Starter-to-Pro upgrade trigger, so a
    // drift here misprices the plan card while the team page says otherwise.
    seats: PLAN_SEATS.starter,
    numbers: 1,
    includedTexts: 500,
    overageCentsPerText: OVERAGE_CENTS_PER_SEGMENT.usd.starter,
  },
  pro: {
    monthlyDollars: PLAN_PRICE_CENTS.usd.pro / 100,
    seats: PLAN_SEATS.pro,
    numbers: 2,
    includedTexts: 2500,
    overageCentsPerText: OVERAGE_CENTS_PER_SEGMENT.usd.pro,
  },
};

/**
 * The one-time US carrier-registration fee in whole USD (SPEC §4.1: charged
 * at most once per company, ever; Canadian companies that never text US
 * numbers never pay it). Same hand-kept-mirror rules as PLAN_PRICING.
 */
export const US_REGISTRATION_FEE_DOLLARS = US_REGISTRATION_FEE_CENTS.usd / 100;

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
  /**
   * #244: this member's own do-not-disturb window, "22:00"/"07:00". Both or
   * neither — half a window is not a window. Null on every member who has not
   * set one, which is all of them until they do.
   */
  quiet_from?: string | null;
  quiet_to?: string | null;
  /** Their own zone; null falls back to the workspace's. */
  quiet_timezone?: string | null;
  /**
   * #297: category -> "immediate" | "batched" | "summary". An ABSENT key means
   * immediate, which is what every member receives today — so `{}` and "never
   * touched this" are the same state, deliberately.
   */
  delivery?: Record<string, string>;
  /** How long a group waits. Null when nothing is grouped. */
  batch_window_minutes?: number | null;
  /** When the daily summary goes, in their own clock. Null = no summary. */
  summary_at?: string | null;
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

/**
 * #293 — one follow-up reminder that has come DUE, in the /for-you queue.
 *
 * The reason it is its own section rather than folded into "Waiting on you":
 * that section means "you have not answered them". This means "they have not
 * answered YOU, and you asked to be told" — which is a different job, and the
 * highest-value one in the business to be reminded about.
 */
export interface ForYouFollowUp {
  conversation_id: string;
  status: ConversationStatus;
  contact: ContactSummary | null;
  last_message_at: string;
  unread: boolean;
  /** When you asked to be reminded. Always in the past by the time it is here. */
  due_at: string;
  /** The reason you gave, if you gave one. */
  note: string | null;
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

/**
 * Unassigned open conversations + unassigned open tasks. Every member gets it
 * since #416/D53; it was owner/admin-only, and null for a member, before that.
 */
export interface ForYouTriage {
  conversations: ForYouTriageConversation[];
  tasks: ForYouTriageTask[];
}

/** GET /v1/for-you — the four-section focus queue (api_for_you RPC). */
/**
 * #306 — what each section ACTUALLY holds, independent of the 20 rows returned.
 *
 * The rows are capped at the section limit (D23: a calm card list, not a
 * paginated inbox). Counting them was counting the page, so a member with 60
 * conversations waiting on them was told about 20 and the queue looked finished.
 *
 * `distinct_work` is the only one to render as "N things need you" — the
 * per-section totals overlap, and a client cannot dedupe them because it only
 * ever holds 20 of the N ids. The server does it.
 *
 * Optional: a client that ships ahead of the Worker falls back to counting rows,
 * which is today's behaviour rather than a wrong number.
 */
export interface ForYouTotals {
  waiting_on_you: number;
  my_tasks: number;
  unread: number;
  triage_conversations: number;
  triage_tasks: number;
  /** #293: follow-up reminders that have come due. */
  follow_ups?: number;
  /** Each conversation counted once, plus every task. The headline number. */
  distinct_work: number;
}

export interface ForYou {
  /**
   * #293. Absent from an older Worker — readers default to [], which is the
   * pre-#293 behaviour rather than a crash.
   */
  follow_ups?: ForYouFollowUp[];
  waiting_on_you: ForYouWaiting[];
  my_tasks: ForYouTask[];
  unread: ForYouUnread[];
  /** null for a plain member (never leaked); the strip for owner/admin. */
  triage: ForYouTriage | null;
  /** #306. Absent from an older Worker; see {@link ForYouTotals}. */
  totals?: ForYouTotals;
}

/** One derived notification (api_notifications RPC row). */
export type NotificationType =
  | "inbound_message"
  | "assigned"
  | "task_assigned"
  | "missed_call"
  // A teammate named you on an internal note.
  | "mention";

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

/**
 * #343 — whether the workspace's daily notification allowance is spent.
 *
 * At the ceiling notifications stop reaching EVERY member while only the owner
 * is emailed, so a tech's phone just goes quiet and the reasonable inference
 * is that the business had a slow afternoon. `resets_at` is the company's next
 * LOCAL midnight.
 */
export interface AlertPause {
  email_paused: boolean;
  push_paused: boolean;
  resets_at: string;
}

/** GET /v1/notifications/unread-count. */
export interface UnreadCount {
  count: number;
  /** #343. Absent from an older Worker — treat as "nothing paused". */
  alert_pause?: AlertPause;
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

/**
 * What closing a workspace actually did (#341 / D48). Specific on purpose: the
 * confirmation says what happened rather than just that something did.
 */
export interface WorkspaceClosure {
  already_closed: boolean;
  /** When the erasure may begin — ISO, ~30 days out. */
  purge_after: string | null;
  sessions_ended: number;
  push_devices_removed: number;
  numbers_released: number;
  subscription_cancelled: boolean;
  /** #371: whether the written record reached the owner's inbox. */
  receipt_emailed: boolean;
}

/**
 * What deleting your account would touch (#346), asked before anything
 * happens. `blocked_by: "owner"` means the workspaces below have to be handed
 * on or closed first — there is no ownership transfer yet (#332), so the rule
 * has to be stated rather than discovered.
 */
export interface AccountDeletionPreview {
  blocked_by: "owner" | null;
  owned_workspaces: { id: string; name: string }[];
  memberships: number;
  open_conversations: number;
  open_tasks: number;
}

/** What deleting your account did (#346). */
export interface AccountDeletionResult {
  deleted: boolean;
  workspaces_left: number;
  personal_rows_removed: number;
  /** #371: sent before the address itself was removed, or not sent at all. */
  receipt_emailed: boolean;
}

/**
 * One data export (#227). Built on a cron rather than in the request, so a
 * workspace with tens of thousands of messages can still have one.
 */
export interface DataExport {
  id: string;
  status: "pending" | "running" | "ready" | "failed";
  /** Rows written per table — the receipt that it is whole, not truncated. */
  row_counts: Record<string, number>;
  error: string | null;
  requested_at: string;
  completed_at: string | null;
  expires_at: string | null;
  /** Signed links, minted at read time. Empty unless ready and unexpired. */
  files: { name: string; url: string }[];
}

/**
 * #307 — one field of a line's identity: what a caller gets, and whether it
 * came from the workspace rather than from this line.
 */
export interface ResolvedField<T> {
  value: T;
  inherited: boolean;
}

/** GET/PATCH /v1/numbers/:id/identity. */
export interface NumberIdentity {
  label: ResolvedField<string>;
  voicemail_greeting: ResolvedField<string | null>;
  away_message: ResolvedField<string | null>;
  mctb_enabled: ResolvedField<boolean>;
  mctb_message: ResolvedField<string | null>;
  timezone: ResolvedField<string>;
  business_hours: ResolvedField<BusinessHours | null>;
  business_hours_exceptions: ResolvedField<HoursException[] | null>;
  /** #309: which RECORDING plays. Null is the written words, read aloud. */
  voicemail_greeting_id: ResolvedField<string | null>;
  /** #278: what a call to this line does outside its hours. */
  after_hours_calls: ResolvedField<"ring_everyone" | "on_call_only" | "voicemail">;
  /** #278: the recording played after hours; null is the ordinary greeting. */
  after_hours_greeting_id: ResolvedField<string | null>;
  /** #278: how this line's phones ring, and for how long. */
  ring_strategy: ResolvedField<"all" | "in_turn">;
  ring_seconds: ResolvedField<number>;
  /**
   * #301: where calls and texts to this line come from.
   *
   * A bare value, NOT a ResolvedField — this is the one field on the identity
   * route that does not inherit. A workspace default would attribute every
   * line to the same place, which is the opposite of what tracking numbers are
   * for, so null means "not advertised anywhere" rather than "follow the
   * workspace".
   */
  lead_source_id: string | null;
}

/** Null on a field CLEARS the override back to the workspace value. */
export interface NumberIdentityPatch {
  label?: string | null;
  voicemail_greeting?: string | null;
  away_message?: string | null;
  mctb_enabled?: boolean | null;
  mctb_message?: string | null;
  timezone?: string | null;
  business_hours?: BusinessHours | null;
  business_hours_exceptions?: HoursException[] | null;
  voicemail_greeting_id?: string | null;
  after_hours_calls?: "ring_everyone" | "on_call_only" | "voicemail" | null;
  after_hours_greeting_id?: string | null;
  ring_strategy?: "all" | "in_turn" | null;
  ring_seconds?: number | null;
  lead_source_id?: string | null;
}
