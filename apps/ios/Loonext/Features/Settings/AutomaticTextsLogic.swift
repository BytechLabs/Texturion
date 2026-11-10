import Foundation

/// #689 — the "Automatic texts" settings, as pure logic.
///
/// Mirrors the web and Android twins: the same five switches, the same six
/// pickers, the same fixed choice lists, the same defaults. The defaults and
/// ranges are the SERVER's (PATCH /v1/company); a value outside a list can only
/// have been set elsewhere, so the picker adds it rather than hiding it.

/// The five on/off settings. Every one defaults to on.
enum AutoTextFlag: CaseIterable, Sendable {
    case holdScheduled
    case holdReminders
    case holdRating
    case holdUnverifiedCalendar
    case ratingEnabled

    var key: String {
        switch self {
        case .holdScheduled: "hold_scheduled_on_reply"
        case .holdReminders: "hold_reminders_on_reply"
        case .holdRating: "hold_rating_ask_on_reply"
        case .holdUnverifiedCalendar: "hold_reminders_unverified_calendar"
        case .ratingEnabled: "rating_ask_enabled"
        }
    }

    var titleKey: String {
        switch self {
        case .holdScheduled: "domain.autoTextsHoldScheduled"
        case .holdReminders: "domain.autoTextsHoldReminders"
        case .holdRating: "domain.autoTextsHoldRating"
        case .holdUnverifiedCalendar: "domain.autoTextsHoldUnverified"
        case .ratingEnabled: "domain.autoTextsRatingEnabled"
        }
    }

    /// The explanation that sits under a title, when the title alone is not
    /// enough. Nil for the rows that need none.
    var noteKey: String? {
        switch self {
        case .holdUnverifiedCalendar: "domain.autoTextsHoldUnverifiedCaption"
        default: nil
        }
    }

    /// The three "hold" switches that describe what a reply does, so their
    /// caption can say what each position means ("On: it waits for you.").
    /// The rating switch and the calendar switch carry their own wording.
    var explainsPosition: Bool {
        switch self {
        case .holdScheduled, .holdReminders, .holdRating: true
        case .holdUnverifiedCalendar, .ratingEnabled: false
        }
    }

    func value(in company: CompanyView) -> Bool {
        switch self {
        case .holdScheduled: company.hold_scheduled_on_reply
        case .holdReminders: company.hold_reminders_on_reply
        case .holdRating: company.hold_rating_ask_on_reply
        case .holdUnverifiedCalendar: company.hold_reminders_unverified_calendar
        case .ratingEnabled: company.rating_ask_enabled
        }
    }
}

/// The unit an integer setting is stored in.
enum AutoTextUnit: Sendable {
    case minutes
    case hours
    case days
}

/// The six integer settings, each picked from a fixed list.
enum AutoTextNumber: CaseIterable, Sendable {
    case ratingDelay
    case ratingExpiry
    case ratingCooldown
    case scheduledExpiry
    case reminderExpiry
    case autoReplyCooldown

    var key: String {
        switch self {
        case .ratingDelay: "rating_ask_delay_hours"
        case .ratingExpiry: "rating_ask_expiry_hours"
        case .ratingCooldown: "rating_ask_cooldown_days"
        case .scheduledExpiry: "scheduled_text_expiry_hours"
        case .reminderExpiry: "reminder_expiry_hours"
        case .autoReplyCooldown: "auto_reply_cooldown_minutes"
        }
    }

    var titleKey: String {
        switch self {
        case .ratingDelay: "domain.autoTextsRatingDelay"
        case .ratingExpiry: "domain.autoTextsRatingExpiry"
        case .ratingCooldown: "domain.autoTextsRatingCooldown"
        case .scheduledExpiry: "domain.autoTextsScheduledExpiry"
        case .reminderExpiry: "domain.autoTextsReminderExpiry"
        case .autoReplyCooldown: "domain.autoTextsReplyCooldown"
        }
    }

    var unit: AutoTextUnit {
        switch self {
        case .ratingCooldown: .days
        case .autoReplyCooldown: .minutes
        case .ratingDelay, .ratingExpiry, .scheduledExpiry, .reminderExpiry: .hours
        }
    }

    /// The server's default, in `unit`.
    var fallback: Int {
        switch self {
        case .ratingDelay: 4
        case .ratingExpiry: 24
        case .ratingCooldown: 30
        case .scheduledExpiry: 24
        case .reminderExpiry: 2
        case .autoReplyCooldown: 180
        }
    }

    /// The fixed list, in `unit`, ascending.
    var choices: [Int] {
        switch self {
        case .ratingDelay: [0, 1, 2, 4, 8, 12, 24, 48]
        case .ratingExpiry: [6, 12, 24, 48, 72, 168]
        case .ratingCooldown: [7, 14, 30, 60, 90, 180]
        case .scheduledExpiry: [6, 12, 24, 48, 72, 168, 720]
        case .reminderExpiry: [1, 2, 6, 12, 24, 72]
        case .autoReplyCooldown: [30, 60, 180, 360, 720, 1440]
        }
    }

    func value(in company: CompanyView) -> Int {
        switch self {
        case .ratingDelay: company.rating_ask_delay_hours
        case .ratingExpiry: company.rating_ask_expiry_hours
        case .ratingCooldown: company.rating_ask_cooldown_days
        case .scheduledExpiry: company.scheduled_text_expiry_hours
        case .reminderExpiry: company.reminder_expiry_hours
        case .autoReplyCooldown: company.auto_reply_cooldown_minutes
        }
    }
}

enum AutomaticTexts {
    /// The picker's options: the fixed list, plus `current` when the list lacks
    /// it, so the control always shows what is really saved. Ascending, unique.
    static func choices(_ number: AutoTextNumber, current: Int) -> [Int] {
        var all = number.choices
        if !all.contains(current) { all.append(current) }
        return all.sorted()
    }

    /// "Right away", "30 minutes", "1 hour", "3 hours", "1 day", "30 days".
    ///
    /// A whole number of days reads as days and a whole number of hours as
    /// hours, whatever unit the value is stored in, so 1440 minutes is "1 day"
    /// and 24 hours is "1 day" too. French uses the singular for 0 and 1, which
    /// is why the singular test is `< 2` and not `== 1`.
    static func duration(_ value: Int, unit: AutoTextUnit, locale: String?) -> String {
        let minutes: Int
        switch unit {
        case .minutes: minutes = value
        case .hours: minutes = value * 60
        case .days: minutes = value * 1440
        }
        if minutes <= 0 {
            return AppStrings.translate(locale, "domain.autoTextsRightAway")
        }
        if minutes % 1440 == 0 {
            let days = minutes / 1440
            return counted(
                days, one: "domain.autoTextsDay", many: "domain.autoTextsDays", locale
            )
        }
        if minutes % 60 == 0 {
            let hours = minutes / 60
            return counted(
                hours, one: "domain.autoTextsHour", many: "domain.autoTextsHours", locale
            )
        }
        return counted(
            minutes, one: "domain.autoTextsMinute", many: "domain.autoTextsMinutes", locale
        )
    }

    private static func counted(
        _ count: Int,
        one: String,
        many: String,
        _ locale: String?
    ) -> String {
        AppStrings.translate(locale, count < 2 ? one : many, ["count": String(count)])
    }

    static func label(_ number: AutoTextNumber, value: Int, locale: String?) -> String {
        duration(value, unit: number.unit, locale: locale)
    }

    /// "Default: on". All five switches default to on, so there is no off form.
    static func defaultCaption(_ flag: AutoTextFlag, locale: String?) -> String {
        AppStrings.translate(
            locale,
            "domain.autoTextsDefault",
            ["value": AppStrings.translate(locale, "domain.autoTextsOn")]
        )
    }

    /// "Default: 4 hours".
    static func defaultCaption(_ number: AutoTextNumber, locale: String?) -> String {
        AppStrings.translate(
            locale,
            "domain.autoTextsDefault",
            ["value": label(number, value: number.fallback, locale: locale)]
        )
    }

    /// What the switch's current position means, for the three hold rows.
    static func positionCaption(_ flag: AutoTextFlag, isOn: Bool, locale: String?) -> String? {
        guard flag.explainsPosition else { return nil }
        return AppStrings.translate(
            locale,
            isOn ? "domain.autoTextsHoldOn" : "domain.autoTextsHoldOff"
        )
    }

    /// The PATCH body for one switch: only that field.
    static func patch(_ flag: AutoTextFlag, isOn: Bool) -> JSONValue {
        JSONValue.object([flag.key: .bool(isOn)])
    }

    /// The PATCH body for one picker: only that field.
    static func patch(_ number: AutoTextNumber, value: Int) -> JSONValue {
        JSONValue.object([number.key: .number(Double(value))])
    }
}
