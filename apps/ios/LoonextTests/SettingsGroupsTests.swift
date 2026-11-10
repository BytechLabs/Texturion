import XCTest
@testable import Loonext

/// #727: the group table is the shared one, and every section is under one group.
final class SettingsGroupsTests: XCTestCase {

    /// Copied from SETTINGS_GROUPS in packages/shared/src/settings-groups.ts,
    /// the source of truth. Change that file first, then this table.
    private let shared: [(id: String, sections: [String])] = [
        ("workspace", ["workspace", "team", "ai"]),
        ("messages", ["hours", "templates"]),
        ("phone", ["numbers", "calling", "blockedNumbers"]),
        ("billing", ["usage", "billing", "payments"]),
        ("you", ["notifications", "profile", "account", "devices"]),
        ("developers", ["webhooks", "apiKeys"]),
        ("support", ["history", "help", "whatsNew"]),
    ]

    private func visible(_ role: String?) -> [SettingsSection] {
        SettingsSection.allCases.filter { section in
            section.needs == Capability.workspaceAccess
                || MemberRole.has(role, section.needs)
        }
    }

    func testTheGroupTableEqualsTheSharedOne() {
        XCTAssertEqual(SettingsGroup.allCases.map { $0.rawValue }, shared.map { $0.id })
        for (group, expected) in zip(SettingsGroup.allCases, shared) {
            XCTAssertEqual(group.sharedIds, expected.sections, group.rawValue)
        }
    }

    func testNoSectionIdIsRepeatedAcrossGroups() {
        let all = SettingsGroup.allCases.flatMap { $0.sharedIds }
        XCTAssertEqual(Set(all).count, all.count)
    }

    func testEverySectionOnThisPhoneIsUnderExactlyOneGroup() {
        for section in SettingsSection.allCases {
            let homes = SettingsGroup.allCases.filter { $0.sharedIds.contains(section.sharedId) }
            XCTAssertEqual(homes.count, 1, section.rawValue)
        }
    }

    func testAnOwnerSeesEverySectionOnceInGroupOrder() {
        let grouped = groupSettingsSections(visible("owner"))
        XCTAssertEqual(grouped.map { $0.group }, SettingsGroup.allCases)
        XCTAssertEqual(grouped.flatMap { $0.sections }.count, SettingsSection.allCases.count)
        XCTAssertEqual(
            Set(grouped.flatMap { $0.sections }),
            Set(SettingsSection.allCases)
        )
        let messages = grouped.first { $0.group == .messages }?.sections
        XCTAssertEqual(messages, [.hours, .automaticTexts, .templates])
    }

    func testAMemberSeesOnlyTheGroupsHoldingSomethingTheyCanOpen() {
        let grouped = groupSettingsSections(visible("member"))
        XCTAssertEqual(grouped.map { $0.group }, [.workspace, .you, .support])
        XCTAssertEqual(grouped[0].sections, [.team])
    }
}
