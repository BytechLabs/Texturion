import {
  AUTOMATIC_TEXT_DEFAULTS,
  resolveAutomaticTextSettings,
  type AutomaticTextSettings,
} from "@loonext/shared";

import type { MessageKey, Translate } from "@/i18n/translate";

/**
 * The "Automatic texts" settings: which values an admin may pick, how a value
 * is said in words, and what one change sends.
 *
 * Numbers are never typed. Each one is picked from a short list, and a value
 * the server holds that is not on the list (set by an API call, or by a later
 * version of this list) is added so the screen never shows a value that is not
 * the one in force.
 */

export type NumberField = {
  [K in keyof AutomaticTextSettings]: AutomaticTextSettings[K] extends number
    ? K
    : never;
}[keyof AutomaticTextSettings];

export type BooleanField = Exclude<keyof AutomaticTextSettings, NumberField>;

export const AUTOMATIC_TEXT_CHOICES: Record<NumberField, readonly number[]> = {
  rating_ask_delay_hours: [0, 1, 2, 4, 8, 12, 24, 48],
  rating_ask_expiry_hours: [6, 12, 24, 48, 72, 168],
  rating_ask_cooldown_days: [7, 14, 30, 60, 90, 180],
  scheduled_text_expiry_hours: [6, 12, 24, 48, 72, 168, 720],
  reminder_expiry_hours: [1, 2, 6, 12, 24, 72],
  auto_reply_cooldown_minutes: [30, 60, 180, 360, 720, 1440],
};

type Unit = "minute" | "hour" | "day";

/** The unit each number is stored in. */
const STORED_UNIT: Record<NumberField, Unit> = {
  rating_ask_delay_hours: "hour",
  rating_ask_expiry_hours: "hour",
  rating_ask_cooldown_days: "day",
  scheduled_text_expiry_hours: "hour",
  reminder_expiry_hours: "hour",
  auto_reply_cooldown_minutes: "minute",
};

/** The picker's options: the fixed list, plus the current value if it is not on it. */
export function choicesWithCurrent(
  field: NumberField,
  current: number,
): number[] {
  const list = [...AUTOMATIC_TEXT_CHOICES[field]];
  if (!list.includes(current)) list.push(current);
  return list.sort((a, b) => a - b);
}

/** A company response with every absent or malformed key replaced by its default. */
export function readAutomaticTextSettings(
  company: Partial<Record<keyof AutomaticTextSettings, unknown>> | null,
): AutomaticTextSettings {
  return resolveAutomaticTextSettings(company);
}

/** The one-field PATCH body for a change. */
export function automaticTextPatch<K extends keyof AutomaticTextSettings>(
  field: K,
  value: AutomaticTextSettings[K],
): Pick<AutomaticTextSettings, K> {
  return { [field]: value } as Pick<AutomaticTextSettings, K>;
}

/** Whole days, then whole hours, then minutes: 1440 minutes is "1 day", 180 is "3 hours". */
function plainUnit(
  stored: Unit,
  value: number,
): { unit: Unit; count: number } {
  let minutes = value;
  if (stored === "hour") minutes = value * 60;
  if (stored === "day") minutes = value * 1440;
  if (minutes % 1440 === 0) return { unit: "day", count: minutes / 1440 };
  if (minutes % 60 === 0) return { unit: "hour", count: minutes / 60 };
  return { unit: "minute", count: minutes };
}

const UNIT_KEYS: Record<Unit, { one: MessageKey; other: MessageKey }> = {
  minute: {
    one: "settingsMore.autoTextsMinuteOne",
    other: "settingsMore.autoTextsMinuteOther",
  },
  hour: {
    one: "settingsMore.autoTextsHourOne",
    other: "settingsMore.autoTextsHourOther",
  },
  day: {
    one: "settingsMore.autoTextsDayOne",
    other: "settingsMore.autoTextsDayOther",
  },
};

/** "4 hours", "1 day", "30 minutes", "Right away", with the reader's plural rules. */
export function formatAutomaticTextDuration(
  t: Translate,
  field: NumberField,
  value: number,
): string {
  if (value === 0) return t("settingsMore.autoTextsRightAway");
  const { unit, count } = plainUnit(STORED_UNIT[field], value);
  const one = new Intl.PluralRules(t.locale).select(count) === "one";
  return t(UNIT_KEYS[unit][one ? "one" : "other"], { count });
}

/** The caption under a control that states what "unchanged" means. */
export function automaticTextDefaultCaption(
  t: Translate,
  field: keyof AutomaticTextSettings,
): string {
  const fallback = AUTOMATIC_TEXT_DEFAULTS[field];
  if (typeof fallback === "boolean") {
    return t(
      fallback
        ? "settingsMore.autoTextsDefaultOn"
        : "settingsMore.autoTextsDefaultOff",
    );
  }
  return t("settingsMore.autoTextsDefaultValue", {
    value: formatAutomaticTextDuration(t, field as NumberField, fallback),
  });
}

/** The audit log names a changed setting by its row title. */
export const AUTOMATIC_TEXT_LABEL_KEYS: Record<
  keyof AutomaticTextSettings,
  MessageKey
> = {
  hold_scheduled_on_reply: "settingsMore.autoTextsHoldScheduled",
  hold_reminders_on_reply: "settingsMore.autoTextsHoldReminders",
  hold_rating_ask_on_reply: "settingsMore.autoTextsHoldRating",
  hold_reminders_unverified_calendar: "settingsMore.autoTextsHoldCalendar",
  rating_ask_enabled: "settingsMore.autoTextsRatingEnabled",
  rating_ask_delay_hours: "settingsMore.autoTextsRatingDelay",
  rating_ask_expiry_hours: "settingsMore.autoTextsRatingExpiry",
  rating_ask_cooldown_days: "settingsMore.autoTextsRatingCooldown",
  scheduled_text_expiry_hours: "settingsMore.autoTextsScheduledExpiry",
  reminder_expiry_hours: "settingsMore.autoTextsReminderExpiry",
  auto_reply_cooldown_minutes: "settingsMore.autoTextsReplyCooldown",
};
