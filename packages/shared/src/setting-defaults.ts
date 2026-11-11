/**
 * #749: every workspace setting's default, with the reason for it.
 *
 * The database's column defaults, the API's fallbacks and the phones' decoders
 * are each tested against this table, so a default is written once. The rule
 * behind it: nothing that can cost the business a customer (calls sent to
 * voicemail, texts held or not sent, notifications off) is on unless a person
 * turned it on.
 */
import { AUTOMATIC_TEXT_DEFAULTS } from "./automatic-text-settings";
import { RING_SECONDS_MAX } from "./number-identity";

export type SettingValue =
  | boolean
  | number
  | string
  | null
  | Readonly<Record<string, never>>
  | readonly never[];

export interface SettingDefault {
  value: SettingValue;
  /** Why this is the default, in a sentence a business owner would accept. */
  reason: string;
  /**
   * Changing it can lose a customer, so the settings screen says who chose a
   * value other than the default, and when.
   */
  revenue?: true;
}

export const COMPANY_SETTING_DEFAULTS = {
  after_hours_calls: {
    value: "ring_everyone",
    revenue: true,
    reason: "A call outside business hours still reaches the crew; sending it to voicemail is the owner's choice.",
  },
  ring_strategy: {
    value: "all",
    revenue: true,
    reason: "Everyone's phone rings at once, so a call is answered by whoever is free.",
  },
  ring_seconds: {
    value: RING_SECONDS_MAX,
    revenue: true,
    reason: "Phones ring for the longest time allowed before the call goes to voicemail.",
  },
  away_enabled: {
    value: false,
    revenue: true,
    reason: "An away reply tells customers nobody is there, so only the owner turns it on.",
  },
  call_screening: {
    value: "flag",
    revenue: true,
    reason: "Likely spam is marked, never sent away, so a real caller is never dropped.",
  },
  us_texting_enabled: {
    value: true,
    // Not attributed: it is answered at signup, not in Settings, and the card
    // that turns it back on already says it is off.
    reason: "Turning it off stops every text to a US number; only a Canadian business can, at signup.",
  },
  emergency_keyword_enabled: {
    value: true,
    revenue: true,
    reason: "A customer who writes about an emergency is flagged to the crew at once.",
  },
  emergency_reply_enabled: {
    value: true,
    revenue: true,
    reason: "A customer reporting an emergency hears straight away that the crew has been told.",
  },
  overage_cap_multiplier: {
    value: 3,
    revenue: true,
    reason: "Sending pauses at three times the plan's allowance, with a warning first, so a bill cannot run away; the owner can raise or clear it.",
  },
  mctb_enabled: {
    value: false,
    reason: "A missed-call text goes out in the business's name, so the owner writes and turns it on.",
  },
  caller_id_lookup: {
    value: true,
    reason: "An unknown caller's name is looked up so the crew knows who is ringing.",
  },
  push_include_content: {
    value: true,
    reason: "A notification shows what the customer wrote, so a reply does not wait for the app to open.",
  },
  first_message_identification: {
    value: false,
    reason: "The first text is the person's own words; adding the business name is opt-in.",
  },
  quiet_hours_confirm_enabled: {
    value: true,
    reason: "Texting a customer late at night asks first; it never blocks the text.",
  },
  response_stats_per_member: {
    value: false,
    reason: "Reply times are shown for the team, not ranked per person, unless the owner asks.",
  },
  tags_locked: {
    value: false,
    reason: "Anyone can add a tag until the owner wants a fixed list.",
  },
  lead_chase_crew_enabled: {
    value: false,
    reason: "Only the assigned person is reminded of an unanswered lead unless the owner widens it.",
  },
  on_call_escalate_after_minutes: {
    value: 10,
    reason: "An after-hours alert the on-call member has not answered widens to everyone on the thread after ten minutes.",
  },
  timezone: {
    value: "America/Toronto",
    reason: "Only a fallback: signup sets the business's own time zone.",
  },
  locale: {
    value: "en",
    reason: "Only a fallback: signup sets the business's language.",
  },
  business_hours: {
    value: {},
    reason: "No hours set means no after-hours rule, so nothing is treated as closed (#721).",
  },
  business_hours_exceptions: {
    value: [],
    reason: "No closed dates until the owner enters one.",
  },
  hold_scheduled_on_reply: {
    value: AUTOMATIC_TEXT_DEFAULTS.hold_scheduled_on_reply,
    reason: "A scheduled text written before the customer replied waits for a person, so it cannot talk past them.",
  },
  hold_reminders_on_reply: {
    value: AUTOMATIC_TEXT_DEFAULTS.hold_reminders_on_reply,
    reason: "A reminder queued before the customer replied waits for a person, so it cannot contradict what they said.",
  },
  hold_rating_ask_on_reply: {
    value: AUTOMATIC_TEXT_DEFAULTS.hold_rating_ask_on_reply,
    reason: "A rating question is held while the customer is mid-conversation.",
  },
  hold_reminders_unverified_calendar: {
    value: AUTOMATIC_TEXT_DEFAULTS.hold_reminders_unverified_calendar,
    reason: "A reminder from a calendar that has not synced lately waits, so it cannot give a wrong time.",
  },
  rating_ask_enabled: {
    value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_enabled,
    reason: "Asking how a finished job went brings reviews, and the owner can turn it off.",
  },
  rating_ask_delay_hours: {
    value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_delay_hours,
    reason: "The question comes a few hours after the job, not while the crew is still there.",
  },
  rating_ask_expiry_hours: {
    value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_expiry_hours,
    reason: "A rating question not sent within a day is dropped as stale.",
  },
  rating_ask_cooldown_days: {
    value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_cooldown_days,
    reason: "A customer is asked at most once a month.",
  },
  scheduled_text_expiry_hours: {
    value: AUTOMATIC_TEXT_DEFAULTS.scheduled_text_expiry_hours,
    reason: "A held scheduled text waits a day for a person before it expires.",
  },
  reminder_expiry_hours: {
    value: AUTOMATIC_TEXT_DEFAULTS.reminder_expiry_hours,
    reason: "A held reminder expires two hours after the appointment, when it can no longer help.",
  },
  auto_reply_cooldown_minutes: {
    value: AUTOMATIC_TEXT_DEFAULTS.auto_reply_cooldown_minutes,
    reason: "One automatic reply per conversation every three hours, so a customer is not answered by a machine twice.",
  },
  away_message: { value: null, reason: "Empty until the owner writes one; the away reply needs it." },
  mctb_message: { value: null, reason: "Empty until the owner writes one; the missed-call text needs it." },
  emergency_keywords: { value: null, reason: "The built-in list of emergency words applies until the owner edits it." },
  emergency_message: { value: null, reason: "The built-in emergency reply applies until the owner writes one." },
  offramp_message: { value: null, reason: "A closing workspace sends nothing from its old number unless the departing owner writes it." },
  voicemail_greeting: { value: null, reason: "The built-in greeting plays until the owner records or writes one." },
  voicemail_greeting_id: { value: null, reason: "The built-in greeting plays until the owner records one." },
  after_hours_greeting_id: { value: null, reason: "The voicemail greeting plays after hours too until the owner records another." },
  cnam_display_name: { value: null, reason: "Outgoing calls show the business name until the owner sets another (#193)." },
  notify_email_limit: { value: null, reason: "The plan's email limit applies unless staff set another." },
  notify_push_limit: { value: null, reason: "The plan's notification limit applies unless staff set another." },
  high_priority_push_limit: { value: null, reason: "The plan's urgent-notification limit applies unless staff set another." },
  retention_days: { value: null, reason: "Records are kept seven years (D77) unless the owner picks a shorter time." },
  backup_owner_user_id: { value: null, reason: "No backup owner until the owner names one." },
  mfa_required_at: { value: null, reason: "Two-step sign-in is offered to everyone and required only when the owner requires it." },
  widget_number_id: { value: null, reason: "The website button uses the oldest active number until the owner picks one." },
} as const satisfies Record<string, SettingDefault>;

/**
 * The columns on `companies` that are not settings: state the product records,
 * not a choice a person makes. Every other column must be in the table above.
 */
export const COMPANY_COLUMNS_NOT_SETTINGS = {
  id: "identity",
  name: "entered at signup",
  owner_user_id: "identity",
  country: "entered at signup",
  requested_area_code: "entered at signup",
  crew_size: "entered at signup",
  chosen_number_e164: "entered at signup",
  stripe_customer_id: "billing state",
  stripe_subscription_id: "billing state",
  subscription_status: "billing state",
  plan: "billing state",
  current_period_start: "billing state",
  current_period_end: "billing state",
  cancel_at_period_end: "billing state",
  canceled_at: "billing state",
  billing_currency: "billing state",
  subscription_started_at: "billing state",
  subscription_start_approximate: "billing state",
  paused_at: "billing state",
  paused_price_cents: "billing state",
  disputed_at: "billing state",
  registration_fee_paid_at: "billing state",
  registration_fee_charge_started_at: "billing state",
  number_provision_count: "number state",
  paid_extra_numbers: "number state",
  paid_capacity_epoch: "number state",
  telnyx_messaging_profile_id: "number state",
  cnam_submitted_at: "number state",
  aup_accepted_at: "a record of when something happened",
  first_inbound_reply_at: "a record of when something happened",
  second_member_sent_at: "a record of when something happened",
  offramp_opted_in_at: "a record of when something happened",
  winback_dismissed_at: "a record of when something happened",
  referral_prompt_dismissed_at: "a record of when something happened",
  backup_owner_prompted_at: "a record of when something happened",
  retention_changed_at: "a record of when something happened",
  retention_changed_by: "a record of when something happened",
  mfa_grace_until: "a record of when something happened",
  calendar_cleanup_unconfirmed_at: "a record of when something happened",
  calendar_cleanup_unconfirmed_count: "a record of when something happened",
  created_at: "a record of when something happened",
  updated_at: "a record of when something happened",
  deleted_at: "workspace closure",
  purge_after: "workspace closure",
  purged_at: "workspace closure",
  purge_receipt_email: "workspace closure",
  purge_receipt_email_id: "workspace closure",
  legal_hold_at: "staff only",
  legal_hold_reason: "staff only",
  legal_hold_by: "staff only",
  is_internal: "staff only",
  aup_enforcement: "staff only",
  aup_enforcement_at: "staff only",
  aup_enforcement_note: "staff only",
  referral_code: "identity",
  widget_key: "identity",
  signup_landing_path: "signup attribution",
  signup_first_touch: "signup attribution",
  signup_source: "signup attribution",
  lead_chase_enabled: "retired by #463 and read by nothing",
} as const satisfies Record<string, string>;

/** Each member's own notification settings. */
export const NOTIFICATION_SETTING_DEFAULTS = {
  email_enabled: {
    value: true,
    revenue: true,
    reason: "A member hears about a new customer message by email unless they turn it off.",
  },
  push_enabled: {
    value: true,
    revenue: true,
    reason: "A member's phone is told about a new customer message unless they turn it off.",
  },
  delivery: { value: {}, reason: "Every kind of notification follows the two switches above until the member picks per kind." },
  quiet_from: { value: null, reason: "No quiet hours until the member sets them." },
  quiet_to: { value: null, reason: "No quiet hours until the member sets them." },
  quiet_timezone: { value: null, reason: "Quiet hours follow the workspace's time zone until the member picks one." },
  batch_window_minutes: { value: null, reason: "Notifications arrive one by one until the member asks for them grouped." },
  summary_at: { value: null, reason: "No daily summary until the member asks for one." },
} as const satisfies Record<string, SettingDefault>;

export const NOTIFICATION_COLUMNS_NOT_SETTINGS = {
  user_id: "identity",
  company_id: "identity",
  updated_at: "a record of when something happened",
  summary_sent_on: "a record of when something happened",
} as const satisfies Record<string, string>;

export type CompanySettingKey = keyof typeof COMPANY_SETTING_DEFAULTS;

/** The workspace settings whose non-default value the settings screens attribute. */
export const REVENUE_SETTING_KEYS = (
  Object.keys(COMPANY_SETTING_DEFAULTS) as CompanySettingKey[]
).filter(
  (key) => (COMPANY_SETTING_DEFAULTS[key] as SettingDefault).revenue === true,
);

export function companySettingDefault<K extends CompanySettingKey>(
  key: K,
): (typeof COMPANY_SETTING_DEFAULTS)[K]["value"] {
  return COMPANY_SETTING_DEFAULTS[key].value;
}
