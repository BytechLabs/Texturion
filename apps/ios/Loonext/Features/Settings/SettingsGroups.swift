import Foundation

/// #727: the settings sections under their group headings.
///
/// Hand-ported from packages/shared/src/settings-groups.ts; SettingsGroupsTests
/// pins this table to that one. Entries are the SHARED section ids, because
/// the shared "hours" id covers both Hours and Automatic texts here. A section
/// this phone does not have (Blocked numbers, History) is simply absent from
/// the rows, never from the table.
enum SettingsGroup: String, CaseIterable, Identifiable {
    case workspace
    case messages
    case phone
    case billing
    case you
    case developers
    case support

    var id: String { rawValue }

    var titleKey: String {
        switch self {
        case .workspace: "settingsMore.groupWorkspace"
        case .messages: "settingsMore.groupMessages"
        case .phone: "settingsMore.groupPhone"
        case .billing: "settingsMore.groupBilling"
        case .you: "settingsMore.groupYou"
        case .developers: "settingsMore.groupDevelopers"
        case .support: "settingsMore.groupSupport"
        }
    }

    var sharedIds: [String] {
        switch self {
        case .workspace: ["workspace", "team", "ai"]
        case .messages: ["hours", "templates"]
        case .phone: ["numbers", "calling", "blockedNumbers"]
        case .billing: ["usage", "billing", "payments"]
        case .you: ["notifications", "profile", "account", "devices"]
        case .developers: ["webhooks", "apiKeys"]
        case .support: ["history", "help", "whatsNew"]
        }
    }
}

extension SettingsSection {
    /// The shared section id this phone's section stands for.
    var sharedId: String {
        switch self {
        case .workspace: "workspace"
        case .hours, .automaticTexts: "hours"
        case .calling: "calling"
        case .templates: "templates"
        case .team: "team"
        case .numbers: "numbers"
        case .usage: "usage"
        case .billing: "billing"
        case .payments: "payments"
        case .notifications: "notifications"
        case .ai: "ai"
        case .profile: "profile"
        case .devices: "devices"
        case .help: "help"
        case .whatsNew: "whatsNew"
        case .webhooks: "webhooks"
        case .apiKeys: "apiKeys"
        }
    }

    /// The group this section sits under.
    var group: SettingsGroup {
        SettingsGroup.allCases.first { $0.sharedIds.contains(sharedId) } ?? .support
    }
}

/// One group's heading and the rows under it.
struct SettingsGroupRows: Identifiable {
    let group: SettingsGroup
    let sections: [SettingsSection]

    var id: String { group.id }
}

/// Groups in display order, each with the sections a role can open, in the
/// table's order. A group with nothing to open is left out.
func groupSettingsSections(_ visible: [SettingsSection]) -> [SettingsGroupRows] {
    SettingsGroup.allCases.compactMap { group in
        let rows = visible
            .filter { group.sharedIds.contains($0.sharedId) }
            .enumerated()
            .sorted { lhs, rhs in
                let l = group.sharedIds.firstIndex(of: lhs.element.sharedId) ?? 0
                let r = group.sharedIds.firstIndex(of: rhs.element.sharedId) ?? 0
                return l == r ? lhs.offset < rhs.offset : l < r
            }
            .map { $0.element }
        return rows.isEmpty ? nil : SettingsGroupRows(group: group, sections: rows)
    }
}
