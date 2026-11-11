/**
 * #749: every workspace setting's default. The reason for each is a row in
 * docs/DECISIONS.md D162, which a test holds to this table.
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

/** Why each default is what it is: docs/DECISIONS.md D162, one row per setting. */
export interface SettingDefault {
  value: SettingValue;
  /**
   * Changing it can lose a customer, so the settings screen says who chose a
   * value other than the default, and when.
   */
  revenue?: true;
}

export const COMPANY_SETTING_DEFAULTS = {
  after_hours_calls: { value: "ring_everyone", revenue: true },
  ring_strategy: { value: "all", revenue: true },
  ring_seconds: { value: RING_SECONDS_MAX, revenue: true },
  away_enabled: { value: false, revenue: true },
  call_screening: { value: "flag", revenue: true },
  us_texting_enabled: {
    value: true,
    // Not attributed: answered at signup, not in Settings, and the card that
    // turns it back on already says it is off.
  },
  emergency_keyword_enabled: { value: true, revenue: true },
  emergency_reply_enabled: { value: true, revenue: true },
  overage_cap_multiplier: { value: 3, revenue: true },
  mctb_enabled: { value: false },
  caller_id_lookup: { value: true },
  push_include_content: { value: true },
  first_message_identification: { value: false },
  quiet_hours_confirm_enabled: { value: true },
  response_stats_per_member: { value: false },
  tags_locked: { value: false },
  lead_chase_crew_enabled: { value: false },
  on_call_escalate_after_minutes: { value: 10 },
  timezone: { value: "America/Toronto" },
  locale: { value: "en" },
  business_hours: { value: {} },
  business_hours_exceptions: { value: [] },
  hold_scheduled_on_reply: { value: AUTOMATIC_TEXT_DEFAULTS.hold_scheduled_on_reply },
  hold_reminders_on_reply: { value: AUTOMATIC_TEXT_DEFAULTS.hold_reminders_on_reply },
  hold_rating_ask_on_reply: { value: AUTOMATIC_TEXT_DEFAULTS.hold_rating_ask_on_reply },
  hold_reminders_unverified_calendar: { value: AUTOMATIC_TEXT_DEFAULTS.hold_reminders_unverified_calendar },
  rating_ask_enabled: { value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_enabled },
  rating_ask_delay_hours: { value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_delay_hours },
  rating_ask_expiry_hours: { value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_expiry_hours },
  rating_ask_cooldown_days: { value: AUTOMATIC_TEXT_DEFAULTS.rating_ask_cooldown_days },
  scheduled_text_expiry_hours: { value: AUTOMATIC_TEXT_DEFAULTS.scheduled_text_expiry_hours },
  reminder_expiry_hours: { value: AUTOMATIC_TEXT_DEFAULTS.reminder_expiry_hours },
  auto_reply_cooldown_minutes: { value: AUTOMATIC_TEXT_DEFAULTS.auto_reply_cooldown_minutes },
  away_message: { value: null },
  mctb_message: { value: null },
  emergency_keywords: { value: null },
  emergency_message: { value: null },
  offramp_message: { value: null },
  voicemail_greeting: { value: null },
  voicemail_greeting_id: { value: null },
  after_hours_greeting_id: { value: null },
  cnam_display_name: { value: null },
  notify_email_limit: { value: null },
  notify_push_limit: { value: null },
  high_priority_push_limit: { value: null },
  retention_days: { value: null },
  backup_owner_user_id: { value: null },
  mfa_required_at: { value: null },
  widget_number_id: { value: null },
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
  email_enabled: { value: true, revenue: true },
  push_enabled: { value: true, revenue: true },
  delivery: { value: {} },
  quiet_from: { value: null },
  quiet_to: { value: null },
  quiet_timezone: { value: null },
  batch_window_minutes: { value: null },
  summary_at: { value: null },
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
