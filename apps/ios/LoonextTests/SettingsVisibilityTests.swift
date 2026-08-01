import XCTest
@testable import Loonext

/// #461 — "Why is member able to see all settings (sure they cant edit but
/// they can still see settings... why?)"
///
/// #315 turned the personal/business boolean into a capability per section,
/// because a bookkeeper is neither: they hold billing and nothing else, so
/// "is this the business's?" stopped answering "may they see it?".
///
/// Vectors shared with packages/shared/src/settings-visibility.test.ts and the
/// Kotlin port. Three hand-maintained section tables is how the clients
/// drifted in the first place.
final class SettingsVisibilityTests: XCTestCase {

    private let personal: Set<SettingsSection> = [
        // #321: everybody paying for the product is entitled to know it
        // got better, so What's new is personal like the rest.
        .profile, .notifications, .devices, .help, .whatsNew, .diagnostics,
    ]

    /// The same rule `SettingsHome.visibleSections` applies, minus the
    /// seven-tap diagnostics unlock, which is a gesture rather than a role.
    private func visible(_ role: String?) -> Set<SettingsSection> {
        Set(
            SettingsSection.allCases.filter { section in
                section.needs == Capability.workspaceAccess
                    || MemberRole.has(role, section.needs)
            }
        )
    }

    func testPersonalSectionsNeedOnlyTheBootBaseline() {
        for section in personal {
            XCTAssertEqual(
                section.needs,
                Capability.workspaceAccess,
                "\(section.rawValue) should be the reader's own"
            )
        }
    }

    func testTheBusinessSettingsNeedMoreThanTheBaseline() {
        let business = SettingsSection.allCases.filter { !personal.contains($0) }
        for section in business {
            XCTAssertNotEqual(
                section.needs,
                Capability.workspaceAccess,
                "\(section.rawValue) is the business's, not a member's"
            )
        }
        // Guard the guard: if `personal` ever swallowed the list, the loop
        // above would assert nothing.
        XCTAssertGreaterThan(business.count, 5)
    }

    func testAMemberSeesWhatIsTheirs() {
        XCTAssertEqual(visible(MemberRole.member), personal)
    }

    func testTheThreeTheComplaintNamed() {
        // A plan they cannot change, roles they cannot set, a registration
        // they cannot file.
        let member = visible(MemberRole.member)
        XCTAssertFalse(member.contains(.billing))
        XCTAssertFalse(member.contains(.team))
        XCTAssertFalse(member.contains(.numbers))
    }

    func testTemplatesAreTheBusinessesWords() {
        // The away message, the text-back and the voicemail greeting are all
        // settings.manage already. A template is the same class of thing: words
        // the whole crew sends in the business's name. Using them is untouched
        // — the composer's picker is not this surface.
        XCTAssertEqual(SettingsSection.templates.needs, Capability.settingsManage)
        XCTAssertFalse(visible(MemberRole.member).contains(.templates))
    }

    func testAnOwnerAndAnAdminSeeEverything() {
        for role in [MemberRole.owner, MemberRole.admin] {
            XCTAssertEqual(
                visible(role),
                Set(SettingsSection.allCases),
                "\(role) should see every section"
            )
        }
    }

    /// #315: the whole point of the preset. Billing and Usage are the two rows
    /// their role exists for; every other business row stays hidden.
    func testABookkeeperSeesBillingAndNothingElseOfTheBusiness() {
        XCTAssertEqual(
            visible(MemberRole.bookkeeper),
            personal.union([.billing, .usage])
        )
    }

    /// #315: read_only differs from a member in what it can DO, not in what it
    /// sees — so the settings index answers exactly as it does for one.
    func testAViewOnlyObserverSeesNoBusinessSettings() {
        XCTAssertEqual(visible(MemberRole.readOnly), personal)
    }

    func testAnUnknownOrAbsentRoleIsTreatedAsAMember() {
        // The safe way for a missing membership to fail is least privilege —
        // and least privilege here is still the reader's own rows, because
        // reaching this screen means the server authorized the session.
        XCTAssertEqual(visible(nil), personal)
        XCTAssertEqual(visible(""), personal)
        XCTAssertEqual(visible("superuser"), personal)
    }

    /// The #461 rule, held across every preset that exists now or later: an
    /// index with nothing in it reads as a broken app.
    func testNoRoleGetsAnEmptySettingsScreen() {
        let roles: [String?] = [
            MemberRole.owner, MemberRole.admin, MemberRole.member,
            MemberRole.readOnly, MemberRole.bookkeeper, nil,
        ]
        for role in roles {
            XCTAssertFalse(visible(role).isEmpty, "\(role ?? "nil") sees nothing")
        }
    }
}
