import Foundation

/// #749: one attributed setting that is off its default, from
/// GET /v1/company/setting-choices (settings.manage only).
///
/// `value` and `default_value` are JSON of mixed type (string, bool or number),
/// so they stay a `JSONValue` rather than a guess at one type. The two names are
/// null when the change predates the audit trail or the member has gone.
struct SettingChoice: Codable, Sendable, Equatable {
    let key: String
    let value: JSONValue
    let default_value: JSONValue
    let chosen_by: String?
    let chosen_at: String?
}

struct SettingChoices: Codable, Sendable, Equatable {
    let data: [SettingChoice]
}

/// True when two wire values are the same setting value. A number and the
/// string that spells it are the same value, as `overage_cap_multiplier` can
/// arrive either way.
func sameSettingValue(_ a: JSONValue, _ b: JSONValue) -> Bool {
    if a == b { return true }
    switch (a, b) {
    case (.number(let x), .string(let y)): return Double(y) == x
    case (.string(let x), .number(let y)): return Double(x) == y
    default: return false
    }
}

/// #749: the line under a setting that has left its default, or nil.
///
/// Silent at the default, and silent when the list was fetched before the
/// control changed (its value no longer matches `current`), so a save never
/// shows the previous person's name beside the new value.
func settingChoiceText(
    choice: SettingChoice?,
    current: JSONValue,
    defaultLabel: String,
    locale: String?
) -> String? {
    guard let choice else { return nil }
    if sameSettingValue(current, choice.default_value) { return nil }
    if !sameSettingValue(current, choice.value) { return nil }
    let date = TimestampFormat.calendarDate(choice.chosen_at, locale: locale)
    if let name = choice.chosen_by, !date.isEmpty {
        return AppStrings.translate(
            locale,
            "settingsMore.choiceChosenBy",
            ["name": name, "date": date, "default": defaultLabel]
        )
    }
    return AppStrings.translate(
        locale,
        "settingsMore.choiceChangedFromDefault",
        ["default": defaultLabel]
    )
}

/// "on" or "off" in the reader's language, for a switch's default.
func settingOnOffLabel(_ on: Bool, locale: String?) -> String {
    AppStrings.translate(locale, on ? "settingsMore.choiceOn" : "settingsMore.choiceOff")
}
