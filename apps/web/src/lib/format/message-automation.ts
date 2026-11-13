import { isMessageAutomation, type MessageAutomation } from "@loonext/shared";

import type { MessageKey, Translate } from "@/i18n/translate";

/** #725: each automation's name, so a Record keeps the list complete. */
const AUTOMATION_KEYS: Record<MessageAutomation, MessageKey> = {
  away_reply: "thread.automationAwayReply",
  help_reply: "thread.automationHelpReply",
  off_ramp: "thread.automationOffRamp",
  emergency_ack: "thread.automationEmergencyAck",
  missed_call_text: "thread.automationMissedCallText",
  job_rating: "thread.automationJobRating",
  reminder: "thread.automationReminder",
};

/** The automation's own name ("Away reply"), or null when the text does not say. */
export function messageAutomationName(automation: unknown, t: Translate): string | null {
  return isMessageAutomation(automation) ? t(AUTOMATION_KEYS[automation]) : null;
}

/**
 * #725: what stands where a person's name would on an automated text:
 * "Sent automatically · Away reply", or just "Sent automatically" for a text
 * sent before the automation was recorded.
 */
export function sentAutomaticallyLabel(automation: unknown, t: Translate): string {
  const name = messageAutomationName(automation, t);
  return name ? t("thread.sentAutomaticallyBy", { automation: name }) : t("thread.sentAutomatically");
}
