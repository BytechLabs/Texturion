import Foundation

/// #233 — send later, as this phone understands it.
///
/// A hand-port of packages/shared/src/scheduled-send.ts, mirrored again in
/// android/core/scheduled/ScheduledSend.kt. What is shared is the SPEC: which
/// presets exist, the hour they land on, the order, the wording of every reason
/// a message did not go, and which of those reasons will clear on their own.
///
/// The reasons matter more here than the timing does. `docs/DECISIONS.md` makes
/// disclosure binding — held not dropped, everything held or cancelled told to
/// the owner, time-sensitive work expiring rather than arriving late — and a
/// rule about disclosure is only as good as the sentence doing the disclosing.
/// Three clients writing their own version of "we did not send this" is how one
/// of them ends up saying nothing at all.
///
/// The calendar arithmetic is deliberately NOT ported. It uses Foundation here
/// and java.time on Android because only a real calendar gets DST right, the
/// same reason `SnoozeLogic.swift` gives.
///
/// Resolved in the DESTINATION's zone rather than the device's, which is the
/// one place this differs from the snooze ladder: a snooze is when YOU want to
/// see something again, and a scheduled text is when THEY read it.
enum ScheduledSend {
    /// The hour presets land on. Early enough to be first in the inbox.
    static let presetHour = 8

    /// The longest a scheduled body may be. Mirrors the column check.
    static let bodyMax = 1600

    /// How far out a send may be scheduled. Mirrors the SQL horizon.
    static let horizonDays = 90

    /// How many live scheduled messages one workspace may hold. Mirrors SQL.
    static let perCompanyCap = 200

    /// ...and one thread, so a conversation cannot become a drip campaign.
    static let perThreadCap = 20

    /// Statuses a scheduled message can be in, mirroring the column's CHECK.
    static let statuses = ["pending", "held", "sent", "canceled", "expired", "failed"]

    /// Still going, as far as anybody knows.
    static func isLive(_ status: String) -> Bool {
        status == "pending" || status == "held"
    }

    /// Why a scheduled message did not go, in the words the owner reads.
    ///
    /// Each is a REASON, not an error. `recipient_opted_out` deliberately
    /// offers no remedy, because there is not one — an opt-out can only be
    /// lifted by the customer, which is carrier truth rather than our policy.
    static let holdReasons: [String: String] = [
        "subscription_inactive":
            "Your subscription is paused, so this has not been sent. It will go out when billing is sorted.",
        "registration_pending":
            "This is waiting on carrier approval for US texting. It will send once that clears.",
        "service_unavailable":
            "Texting is paused while we deal with an issue. This is still queued and nothing was lost.",
        "customer_replied":
            "They replied after you scheduled this, so we held it rather than talk over them. Send it anyway, or cancel it.",
        "recipient_opted_out":
            "They replied STOP after you scheduled this, so it was not sent. Only they can undo that.",
        "invalid_destination":
            "We cannot text this number any more, so this was not sent.",
        "expired":
            "The send window passed before this could go, so it was not sent. A late message is usually worse than none.",
        "workspace_closed":
            "The workspace was closed before this was due to send.",
    ]

    /// Does this reason clear on its own?
    ///
    /// Drives whether the UI offers "we will keep trying" or asks for a
    /// decision. A reason wrongly marked recoverable is a message that retries
    /// forever against a condition that will never change.
    static func reasonRecovers(_ reason: String) -> Bool {
        switch reason {
        case "subscription_inactive", "registration_pending",
             "service_unavailable", "customer_replied":
            return true
        default:
            return false
        }
    }

    /// Whose clock the sender picked against, said out loud.
    ///
    /// The same three rungs and the same wording as the thread's "their time"
    /// line (`clockProvenance` in MessagingRepository.swift) — a product that
    /// says "from their area code" in one place and something else in another
    /// has two vocabularies for one fact.
    static func clockProvenance(_ source: String) -> String {
        switch source {
        case "contact": return "their time, set on their contact"
        case "area_code": return "their time, from their area code"
        default: return "your workspace's time — we don't know theirs"
        }
    }
}

/// One offer in the send-later menu. `at` is nil for the picker.
struct SchedulePreset: Equatable {
    let id: String
    let label: String
    let at: Date?
}

/// Days from `date` forward to the next Monday — never 0, always next week.
///
/// Deliberately a copy of `daysUntilNextMonday` in SnoozeLogic.swift rather
/// than a call to it: that one is the snooze ladder's, resolved in the DEVICE's
/// calendar, and this one takes the destination's. Sharing the function would
/// mean one of the two features silently changing zone the day somebody
/// "simplified" the other.
private func daysUntilNextMonday(_ date: Date, calendar: Calendar) -> Int {
    // Calendar's weekday is 1 = Sunday … 7 = Saturday, which is NOT the same
    // numbering as java.time's DayOfWeek or JavaScript's getDay(). Converting
    // to a Monday-is-1 index first keeps this identical to the other two
    // clients rather than merely similar.
    let weekday = calendar.component(.weekday, from: date)
    let mondayBased = weekday == 1 ? 7 : weekday - 1  // Mon = 1 … Sun = 7
    return mondayBased == 7 ? 1 : 8 - mondayBased
}

/// The two presets plus the escape hatch, in the DESTINATION's zone.
///
/// Two, not five: #233 names exactly these, and a preset list long enough to
/// need reading is slower than the picker it was meant to avoid.
func schedulePresets(
    now: Date = Date(),
    timeZone: TimeZone
) -> [SchedulePreset] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone

    func at(addDays: Int) -> Date? {
        guard let day = calendar.date(byAdding: .day, value: addDays, to: now) else {
            return nil
        }
        return calendar.date(
            bySettingHour: ScheduledSend.presetHour,
            minute: 0,
            second: 0,
            of: day,
            matchingPolicy: .nextTime
        )
    }

    return [
        SchedulePreset(id: "tomorrow", label: "Tomorrow, 8:00am", at: at(addDays: 1)),
        SchedulePreset(
            id: "monday",
            label: "Monday, 8:00am",
            at: at(addDays: daysUntilNextMonday(now, calendar: calendar))
        ),
        SchedulePreset(id: "custom", label: "Pick a time", at: nil),
    ]
}
