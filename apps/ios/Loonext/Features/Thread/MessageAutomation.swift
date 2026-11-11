import Foundation

/// #725: which automation sent a text, so a thread reads "Sent automatically ·
/// Away reply" where it would otherwise carry the owner's name. Mirrors
/// `apps/web/src/lib/format/message-automation.ts` and
/// `packages/shared/src/message-automations.ts`.
let messageAutomations: [String] = [
    "away_reply",
    "help_reply",
    "off_ramp",
    "emergency_ack",
    "missed_call_text",
    "job_rating",
    "reminder",
]

/// Each automation's catalogue key. A `switch` over the wire value keeps the
/// list and the words together; nil for a value this build does not know.
private func automationKey(_ automation: String?) -> String? {
    switch automation {
    case "away_reply": return "thread.automationAwayReply"
    case "help_reply": return "thread.automationHelpReply"
    case "off_ramp": return "thread.automationOffRamp"
    case "emergency_ack": return "thread.automationEmergencyAck"
    case "missed_call_text": return "thread.automationMissedCallText"
    case "job_rating": return "thread.automationJobRating"
    case "reminder": return "thread.automationReminder"
    default: return nil
    }
}

/// The automation's own name ("Away reply"), or nil when the text does not say.
func messageAutomationName(_ automation: String?, _ locale: String? = nil) -> String? {
    guard let key = automationKey(automation) else { return nil }
    return AppStrings.translate(locale, key)
}

/// "Sent automatically · Away reply", or just "Sent automatically" for a text
/// sent before the automation was recorded.
func sentAutomaticallyLabel(_ automation: String?, _ locale: String? = nil) -> String {
    guard let name = messageAutomationName(automation, locale) else {
        return AppStrings.translate(locale, "thread.sentAutomatically")
    }
    return AppStrings.translate(locale, "thread.sentAutomaticallyBy", ["automation": name])
}

/// Who an outbound text is credited to, the line under its bubble.
///
/// An automated text is written in the owner's name and is still not theirs,
/// so it is named for the automation and never for `sent_by_user_id` (web
/// `clusters.ts` keeps it out of the owner's run for the same reason).
func messageSenderLabel(
    _ message: Message,
    names: [String: String],
    locale: String? = nil
) -> String? {
    if message.direction == MessageDirection.outbound && message.automated {
        return sentAutomaticallyLabel(message.automation, locale)
    }
    guard let sender = message.sent_by_user_id else { return nil }
    return names[sender]
}
