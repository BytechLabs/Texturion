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
    /// #228: KEYS, not sentences. This map is built at type-init, before any
    /// reader exists.
    private static let holdReasonKeys: [String: String] = [
        "subscription_inactive": "domain.scheduledHoldSubscriptionInactive",
        // #277: the seasonal hold. A SEPARATE reason from a lapse because the
        // events and the remedies are separate: nothing lapsed, no card needs
        // sorting, and the number is not on any clock. The sentence above used
        // to say "paused" for a lapse; that word belongs to this now, and two
        // reasons both claiming it is the confusion this roster exists to stop.
        "workspace_paused": "domain.scheduledHoldWorkspacePaused",
        "registration_pending": "domain.scheduledHoldRegistrationPending",
        "service_unavailable": "domain.scheduledHoldServiceUnavailable",
        "calendar_unverified": "domain.scheduledHoldCalendarUnverified",
        "customer_replied": "domain.scheduledHoldCustomerReplied",
        "recipient_opted_out": "domain.scheduledHoldOptedOut",
        "invalid_destination": "domain.scheduledHoldInvalidDestination",
        "expired": "domain.scheduledHoldExpired",
        "workspace_closed": "domain.scheduledHoldWorkspaceClosed",
        // #237: done, deleted, or reminders switched off for that job. One
        // reason for three causes — from the reader's side the actionable fact
        // is identical, and three near-identical sentences is the drift this
        // roster exists to prevent.
        "job_no_longer_scheduled": "domain.scheduledHoldJobUnscheduled",
    ]

    /// Every reason, resolved, in the reader's language.
    static func localisedHoldReasons(_ locale: String? = nil) -> [String: String] {
        holdReasonKeys.mapValues { AppStrings.translate(locale, $0) }
    }

    /// The English, for the callers and the guards that have no reader.
    ///
    /// `ScheduledSendTests` walks this asserting every reason is a SENTENCE and
    /// not a code, which is a guard worth keeping pointed at the copy rather
    /// than at the keys.
    static var holdReasons: [String: String] { localisedHoldReasons() }

    /// One reason, or nil for a state we do not have words for.
    static func holdReason(_ reason: String, locale: String? = nil) -> String? {
        holdReasonKeys[reason].map { AppStrings.translate(locale, $0) }
    }

    /// Does this reason clear on its own?
    ///
    /// Drives whether the UI offers "we will keep trying" or asks for a
    /// decision. A reason wrongly marked recoverable is a message that retries
    /// forever against a condition that will never change.
    static func reasonRecovers(_ reason: String) -> Bool {
        switch reason {
        // #277: a pause is the most recoverable state in the product. It is a
        // season, and the whole promise is that everything is where it was left
        // when the crew comes back. Marked terminal, pausing would quietly
        // destroy a workspace's scheduled work.
        case "subscription_inactive", "workspace_paused", "registration_pending",
             "service_unavailable", "calendar_unverified", "customer_replied":
            return true
        default:
            return false
        }
    }

    /// The sentences the send-later UI says on every client.
    ///
    /// `holdReasons` covers the states where a message did NOT go; this covers
    /// the rest of the surface — the picker, the quiet-hours warning, the
    /// confirmations. Here for the same reason: three clients writing their own
    /// version of "that lands late where they are" is three different products,
    /// and the phone is where somebody schedules a text at 9:40pm with the van
    /// still running.
    ///
    /// Whole sentences only. Button labels stay per-platform, because a
    /// SwiftUI `Button` role and a web dialog footer have different conventions
    /// and a shared "Cancel" would be pretending otherwise.
    private static let copyKeys: [String: String] = [
        "picker_reassurance": "domain.scheduledPickerReassurance",
        "quiet_hours_choice": "domain.scheduledQuietHoursChoice",
        "quiet_hours_unknown": "domain.scheduledQuietHoursUnknown",
        "canceled_confirmation": "domain.scheduledCancelled",
        "nothing_scheduled": "domain.scheduledNothingWaiting",
    ]

    /// The English, for the callers that have no reader.
    static var copy: [String: String] {
        copyKeys.mapValues { AppStrings.translate(nil, $0) }
    }

    /// One line of ``copy``, or empty rather than a crash on a key typo.
    ///
    /// The empty string is deliberate and unchanged: a typo'd key must leave a
    /// gap in a sentence somebody notices, not take a screen down.
    static func copyLine(_ key: String, locale: String? = nil) -> String {
        copyKeys[key].map { AppStrings.translate(locale, $0) } ?? ""
    }

    /// Whose clock the sender picked against, said out loud.
    ///
    /// The same three rungs and the same wording as the thread's "their time"
    /// line (`clockProvenance` in MessagingRepository.swift) — a product that
    /// says "from their area code" in one place and something else in another
    /// has two vocabularies for one fact.
    /// #228 — why a held message did not go, in the reader's language.
    ///
    /// Hand-port of `scheduledHoldText` in packages/shared. The API writes BOTH
    /// a catalogue key and the English sentence it has always written, so:
    /// translate the key where we have words for it, and otherwise render the
    /// stored sentence — which is what a row written before the key existed has.
    ///
    /// A key with no words resolves to ITSELF (the catalogue fails open), so a
    /// self-resolving key counts as absent. Without that check a French reader
    /// would see `domain.scheduledHoldExpired` rather than an English sentence,
    /// which is the worse of the two.
    static func holdText(
        reasonKey: String?,
        storedEnglish: String?,
        locale: String? = nil
    ) -> String? {
        if let reasonKey, !reasonKey.isEmpty {
            let words = AppStrings.translate(locale, reasonKey)
            if !words.isEmpty, words != reasonKey { return words }
        }
        return storedEnglish
    }

    static func clockProvenance(_ source: String, locale: String? = nil) -> String {
        switch source {
        case "contact": return AppStrings.translate(locale, "domain.clockTheirTimeContact")
        case "area_code": return AppStrings.translate(locale, "domain.clockTheirTimeAreaCode")
        default: return AppStrings.translate(locale, "domain.clockWorkspaceTime")
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
///
/// PREFIXED, not just `private`. A top-level `private` func still occupies the
/// module's namespace, so this and SnoozeLogic's identical signature were an
/// "invalid redeclaration" — a break only CI's iOS job could see, because
/// nothing on this side of the repo compiles Swift. The name now says which
/// feature's calendar it is, which is what the doc above was already for.
private func sendLaterDaysUntilNextMonday(_ date: Date, calendar: Calendar) -> Int {
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
    timeZone: TimeZone,
    locale: String? = nil
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
        SchedulePreset(
            id: "tomorrow",
            label: AppStrings.translate(locale, "domain.scheduledPresetTomorrow"),
            at: at(addDays: 1)
        ),
        SchedulePreset(
            id: "monday",
            label: AppStrings.translate(locale, "domain.scheduledPresetMonday"),
            at: at(addDays: sendLaterDaysUntilNextMonday(now, calendar: calendar))
        ),
        SchedulePreset(
            id: "custom",
            label: AppStrings.translate(locale, "domain.scheduledPresetCustom"),
            at: nil
        ),
    ]
}
