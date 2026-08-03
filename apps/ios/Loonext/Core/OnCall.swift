import Foundation

/// #244 — the windows and the words for "who is holding the phone tonight".
///
/// Hand-port of `packages/shared/src/on-call.ts`; `OnCallTests` carries the
/// same cases as the TS and Kotlin suites.
///
/// PRESETS, NOT A DATETIME BUILDER. The decision a contractor is making is
/// "Dana has tonight", not a pair of ISO instants. A start/end picker turns a
/// five-second choice into a form, and a form does not get filled in from a
/// van.
enum OnCall {

    static let eveningStartHour = 18
    static let morningEndHour = 8

    struct Window {
        let startsAt: String
        let endsAt: String
    }

    struct Preset {
        let key: String
        let label: String
        let detail: String
    }

    static let presets: [Preset] = [
        Preset(key: "tonight", label: "Tonight", detail: "6pm until 8am tomorrow"),
        Preset(
            key: "weekend",
            label: "This weekend",
            detail: "Friday 6pm until Monday 8am"
        ),
        Preset(key: "week", label: "The next 7 days", detail: "Starting now"),
    ]

    /// Nobody holding it — states the CONSEQUENCE, which is the decision.
    static let nobody =
        "Nobody is on call, so an after-hours call wakes everyone who can see "
        + "the number. Put one person on and the rest get a quiet night."

    static let until = "on call until"

    static let escalation =
        "If they do not pick it up, everyone else is told a few minutes later."

    static let readOnly = "Only an owner or admin can change who is on call."

    static func line(_ name: String, until value: String) -> String {
        "\(name) is \(until) \(value)"
    }

    // MARK: - #244 the unclaimed-page banner

    /// Unclaimed. Says what is owed, not what happened.
    static let bannerWaiting = "Nobody has picked this up yet"

    /// The action. First person, because that is what tapping it means.
    static let bannerClaim = "I have this"

    /// Claimed by somebody else — the sentence that stops a second callback.
    static let bannerTaken = "has this"

    /// Claimed by you. Confirms it stuck, and that the others were told.
    static let bannerYours = "You have this. The rest of the crew has been told."

    static func alertTakenLine(_ name: String) -> String {
        "\(name) \(bannerTaken)"
    }

    // MARK: - #244 a member's own quiet hours

    static let quietHeading = "Quiet hours"

    /// THE LOAD-BEARING SENTENCE. The reason people do not set quiet hours is
    /// the fear of missing the emergency, so a control that offers silence
    /// without saying what still gets through does not get switched on — and
    /// the member goes back to turning notifications off entirely.
    static let quietReassurance =
        "Your phone stays quiet for ordinary messages. If you are on call, or "
        + "an alert nobody picked up widens to the crew, it still comes through."

    static let quietOff = "Off — every notification reaches you at any hour."

    static let quietOn = "Quiet from"

    static let quietScope = "This applies to this workspace only."

    /// The window most people want, offered rather than imposed.
    static let quietDefaultFrom = "22:00"
    static let quietDefaultTo = "07:00"

    static func quietHoursLine(from: String, to: String) -> String {
        "\(quietOn) \(from) to \(to)"
    }

    // MARK: - #297 how loud each kind of notification is

    static let deliveryHeading = "How much we tell you"

    /// THE PROMISE THAT MAKES A QUIETER SETTING PICKABLE. Without it nobody
    /// chooses one, because the fear is missing the call that mattered — and
    /// they go back to turning notifications off entirely.
    static let deliveryUrgentAlways =
        "An emergency, a page while you are on call, or an alert nobody picked "
        + "up always arrives straight away, whatever you choose here."

    static let deliveryImmediate = "Straight away"
    static let deliveryBatched = "Grouped up"
    static let deliverySummary = "Once a day"

    /// Said next to "Once a day", the option people misread as off.
    static let deliverySummaryDetail =
        "Held for your daily summary, not discarded."

    /// The categories, in the words a member would use, in display order.
    static let categoryLabels: [(key: String, label: String)] = [
        ("messages_mine", "Texts on my jobs"),
        ("messages_all", "Texts on anyone's jobs"),
        ("mentions", "When somebody @s me"),
        ("assignments", "Work handed to me"),
        ("missed_calls", "Missed calls"),
        ("voicemails", "Voicemails"),
    ]

    static let deliveryModes = ["immediate", "batched", "summary"]

    static let batchWindowChoices = [5, 15, 30, 60]

    static let defaultBatchWindow = 15

    /// Turn a preset into a real window.
    ///
    /// `offsetMinutes` is the crew's offset from UTC, passed in rather than
    /// resolved here so the three ports only have to agree about arithmetic and
    /// not about a tz database.
    static func window(_ preset: String, now: Date, offsetMinutes: Int) -> Window {
        let nowMs = now.timeIntervalSince1970
        let offsetSeconds = Double(offsetMinutes) * 60
        let localSeconds = nowMs + offsetSeconds
        let startOfLocalDay = (localSeconds / 86_400).rounded(.down) * 86_400

        func toUtc(_ local: Double) -> String {
            iso(local - offsetSeconds)
        }

        if preset == "week" {
            return Window(startsAt: iso(nowMs), endsAt: iso(nowMs + 7 * 86_400))
        }

        if preset == "weekend" {
            // ALREADY the weekend means THIS one. Booking eight days out would
            // leave tonight uncovered by the very action taken to cover it.
            //
            // 1970-01-01 was a Thursday, so day 0 is weekday 4.
            let dayNumber = Int(startOfLocalDay / 86_400)
            let weekday = (dayNumber + 4) % 7 // 0 = Sunday
            let daysToFriday: Int
            switch weekday {
            case 6: daysToFriday = -1
            case 0: daysToFriday = -2
            default: daysToFriday = 5 - weekday
            }
            let friday = startOfLocalDay + Double(daysToFriday) * 86_400
            return Window(
                startsAt: toUtc(friday + Double(eveningStartHour) * 3_600),
                endsAt: toUtc(
                    friday + 3 * 86_400 + Double(morningEndHour) * 3_600
                )
            )
        }

        // Past 6pm already, it starts NOW rather than retroactively — a
        // backdated shift claims responsibility for hours nobody was holding.
        let eveningStart = startOfLocalDay + Double(eveningStartHour) * 3_600
        let start = localSeconds > eveningStart ? localSeconds : eveningStart
        return Window(
            startsAt: toUtc(start),
            endsAt: toUtc(
                startOfLocalDay + 86_400 + Double(morningEndHour) * 3_600
            )
        )
    }

    /// ISO-8601 with milliseconds, in a fixed locale.
    ///
    /// `en_US_POSIX` for the same reason the rating formatter pins its locale:
    /// a device in another calendar or locale would otherwise emit a string the
    /// API cannot parse, on that device only.
    private static func iso(_ epochSeconds: Double) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
        return formatter.string(from: Date(timeIntervalSince1970: epochSeconds))
    }
}
