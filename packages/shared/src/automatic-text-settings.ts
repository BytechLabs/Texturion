/**
 * How a workspace wants its automatic texts to behave.
 *
 * Every value here is a policy, not a safety rule: the product's default is the
 * behaviour a workspace had before these were settings, and an admin may change
 * it. What stays fixed is listed in docs/DECISIONS.md (an opt-out only the
 * customer can lift, the legal sending window, the queue caps).
 */
import { RATING_ASK_DELAY_HOURS, RATING_ASK_HORIZON_HOURS } from "./job-ratings";

export interface AutomaticTextSettings {
  /** Hold a text a person scheduled when the customer replied after it was written. */
  hold_scheduled_on_reply: boolean;
  /** Hold an appointment reminder when the customer replied after it was queued. */
  hold_reminders_on_reply: boolean;
  /** Hold the automatic rating question when the customer replied after it was queued. */
  hold_rating_ask_on_reply: boolean;
  /** Hold a calendar-mirrored reminder until the calendar was verified recently. */
  hold_reminders_unverified_calendar: boolean;
  /** Ask the customer how a finished job went. */
  rating_ask_enabled: boolean;
  /** Hours after a job is finished before the rating question is queued. */
  rating_ask_delay_hours: number;
  /** Hours a rating question stays sendable before it expires. */
  rating_ask_expiry_hours: number;
  /** Days before the same customer is asked about another job. */
  rating_ask_cooldown_days: number;
  /** Hours a held text a person scheduled waits before it expires. */
  scheduled_text_expiry_hours: number;
  /** Hours a held appointment reminder waits, after the appointment time, before it expires. */
  reminder_expiry_hours: number;
  /** Minutes between automatic replies (away reply, missed-call text) on one conversation. */
  auto_reply_cooldown_minutes: number;
}

export const AUTOMATIC_TEXT_DEFAULTS: AutomaticTextSettings = {
  hold_scheduled_on_reply: true,
  hold_reminders_on_reply: true,
  hold_rating_ask_on_reply: true,
  hold_reminders_unverified_calendar: true,
  rating_ask_enabled: true,
  rating_ask_delay_hours: RATING_ASK_DELAY_HOURS,
  rating_ask_expiry_hours: RATING_ASK_HORIZON_HOURS,
  rating_ask_cooldown_days: 30,
  scheduled_text_expiry_hours: 24,
  reminder_expiry_hours: 2,
  auto_reply_cooldown_minutes: 180,
};

/** Inclusive bounds, mirrored by the companies_*_ck constraints. */
export const AUTOMATIC_TEXT_BOUNDS = {
  rating_ask_delay_hours: { min: 0, max: 168 },
  rating_ask_expiry_hours: { min: 1, max: 168 },
  rating_ask_cooldown_days: { min: 1, max: 365 },
  scheduled_text_expiry_hours: { min: 1, max: 720 },
  reminder_expiry_hours: { min: 1, max: 72 },
  auto_reply_cooldown_minutes: { min: 1, max: 1440 },
} as const;

export const AUTOMATIC_TEXT_KEYS = Object.keys(
  AUTOMATIC_TEXT_DEFAULTS,
) as (keyof AutomaticTextSettings)[];

/**
 * A company row's settings with every missing or malformed value replaced by
 * the default, so a partial select can never read as "off".
 */
export function resolveAutomaticTextSettings(
  row: Partial<Record<keyof AutomaticTextSettings, unknown>> | null | undefined,
): AutomaticTextSettings {
  const out: Record<string, unknown> = { ...AUTOMATIC_TEXT_DEFAULTS };
  if (!row) return out as unknown as AutomaticTextSettings;
  for (const key of AUTOMATIC_TEXT_KEYS) {
    const value = row[key];
    if (typeof value === typeof AUTOMATIC_TEXT_DEFAULTS[key]) out[key] = value;
  }
  return out as unknown as AutomaticTextSettings;
}
