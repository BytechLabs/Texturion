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

    /// #228 — how every sentence in this namespace reaches a reader.
    ///
    /// Nothing in `Core/` has an `@Environment(\.appLocale)` to read: this is a
    /// plain `enum` whose constants are built at type-init, long before any
    /// view exists. So each sentence is a KEY, resolved by a function that
    /// takes the reader's language LAST and DEFAULTED — the shape
    /// `AppLock.headline` already uses.
    ///
    /// The old constant names are kept as computed `static var`s over those
    /// keys, so a card that has not been given a reader keeps rendering exactly
    /// what it rendered before rather than a bare key. A screen that HAS one
    /// moves to the `…Key` constant and `AppStrings.translate`, or to the
    /// locale-taking function beside it.
    private static func say(_ key: String, _ locale: String? = nil) -> String {
        AppStrings.translate(locale, key)
    }

    /// The three offers, in the reader's language.
    ///
    /// A DIFFERENT NAME from the `presets` property below rather than an
    /// overload of it: whether Swift accepts a property and a method sharing
    /// one base name in one type is a question this repo cannot answer
    /// locally — Swift compiles only in CI's `Gate / iOS` — and there is no
    /// precedent for the pair anywhere in this app to copy.
    static func localisedPresets(_ locale: String? = nil) -> [Preset] {
        [
            Preset(
                key: "tonight",
                label: say("domain.onCallPresetTonight", locale),
                detail: say("domain.onCallPresetTonightDetail", locale)
            ),
            Preset(
                key: "weekend",
                label: say("domain.onCallPresetWeekend", locale),
                detail: say("domain.onCallPresetWeekendDetail", locale)
            ),
            Preset(
                key: "week",
                label: say("domain.onCallPresetWeek", locale),
                detail: say("domain.onCallPresetWeekDetail", locale)
            ),
        ]
    }

    /// The English, for the card that has not been handed a reader yet.
    static var presets: [Preset] { localisedPresets() }

    /// Nobody holding it — states the CONSEQUENCE, which is the decision.
    static let nobodyKey = "domain.onCallNobody"
    static var nobody: String { say(nobodyKey) }

    static let untilKey = "domain.onCallUntil"
    static var until: String { say(untilKey) }

    static let escalationKey = "domain.onCallEscalation"
    static var escalation: String { say(escalationKey) }

    static let readOnlyKey = "domain.onCallReadOnly"
    static var readOnly: String { say(readOnlyKey) }

    /// One whole sentence rather than a name glued to a fragment: the verb sits
    /// in a different place in the two languages, and a sentence assembled from
    /// pieces can only ever be assembled in one word order.
    static func line(
        _ name: String,
        until value: String,
        locale: String? = nil
    ) -> String {
        AppStrings.translate(
            locale, "domain.onCallLine", ["name": name, "until": value]
        )
    }

    // MARK: - #244 the unclaimed-page banner

    /// Unclaimed. Says what is owed, not what happened.
    static let bannerWaitingKey = "domain.onCallBannerWaiting"
    static var bannerWaiting: String { say(bannerWaitingKey) }

    /// The action. First person, because that is what tapping it means.
    static let bannerClaimKey = "domain.onCallBannerClaim"
    static var bannerClaim: String { say(bannerClaimKey) }

    /// Claimed by somebody else — the sentence that stops a second callback.
    static let bannerTakenKey = "domain.onCallBannerTaken"
    static var bannerTaken: String { say(bannerTakenKey) }

    /// Claimed by you. Confirms it stuck, and that the others were told.
    static let bannerYoursKey = "domain.onCallBannerYours"
    static var bannerYours: String { say(bannerYoursKey) }

    /// One whole sentence, for the same reason `line` is one.
    static func alertTakenLine(_ name: String, locale: String? = nil) -> String {
        AppStrings.translate(locale, "domain.onCallTakenLine", ["name": name])
    }

    // MARK: - #244 a member's own quiet hours

    static let quietHeadingKey = "domain.quietHoursHeading"
    static var quietHeading: String { say(quietHeadingKey) }

    /// THE LOAD-BEARING SENTENCE. The reason people do not set quiet hours is
    /// the fear of missing the emergency, so a control that offers silence
    /// without saying what still gets through does not get switched on — and
    /// the member goes back to turning notifications off entirely.
    static let quietReassuranceKey = "domain.quietHoursReassurance"
    static var quietReassurance: String { say(quietReassuranceKey) }

    static let quietOffKey = "domain.quietHoursOff"
    static var quietOff: String { say(quietOffKey) }

    static let quietOnKey = "domain.quietHoursOn"
    static var quietOn: String { say(quietOnKey) }

    static let quietScopeKey = "domain.quietHoursScope"
    static var quietScope: String { say(quietScopeKey) }

    /// The window most people want, offered rather than imposed.
    static let quietDefaultFrom = "22:00"
    static let quietDefaultTo = "07:00"

    /// One whole sentence, for the same reason `line` is one.
    static func quietHoursLine(
        from: String,
        to: String,
        locale: String? = nil
    ) -> String {
        AppStrings.translate(
            locale, "domain.quietHoursLine", ["from": from, "to": to]
        )
    }

    // MARK: - #297 how loud each kind of notification is

    static let deliveryHeadingKey = "domain.deliveryHeading"
    static var deliveryHeading: String { say(deliveryHeadingKey) }

    /// THE PROMISE THAT MAKES A QUIETER SETTING PICKABLE. Without it nobody
    /// chooses one, because the fear is missing the call that mattered — and
    /// they go back to turning notifications off entirely.
    static let deliveryUrgentAlwaysKey = "domain.deliveryUrgentAlways"
    static var deliveryUrgentAlways: String { say(deliveryUrgentAlwaysKey) }

    static let deliveryImmediateKey = "domain.deliveryImmediate"
    static var deliveryImmediate: String { say(deliveryImmediateKey) }

    static let deliveryBatchedKey = "domain.deliveryBatched"
    static var deliveryBatched: String { say(deliveryBatchedKey) }

    static let deliverySummaryKey = "domain.deliverySummary"
    static var deliverySummary: String { say(deliverySummaryKey) }

    /// Said next to "Once a day", the option people misread as off.
    static let deliverySummaryDetailKey = "domain.deliverySummaryDetail"
    static var deliverySummaryDetail: String { say(deliverySummaryDetailKey) }

    /// The categories, in the words a member would use, in display order.
    ///
    /// The wire key is the CATEGORY's, which the server reads and which is
    /// never translated; only the label beside it is.
    static func localisedCategoryLabels(
        _ locale: String? = nil
    ) -> [(key: String, label: String)] {
        [
            ("messages_mine", say("domain.categoryMessagesMine", locale)),
            ("messages_all", say("domain.categoryMessagesAll", locale)),
            ("mentions", say("domain.categoryMentions", locale)),
            ("assignments", say("domain.categoryAssignments", locale)),
            ("missed_calls", say("domain.categoryMissedCalls", locale)),
            ("voicemails", say("domain.categoryVoicemails", locale)),
        ]
    }

    /// The English, for the card that has not been handed a reader yet.
    static var categoryLabels: [(key: String, label: String)] {
        localisedCategoryLabels()
    }

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
