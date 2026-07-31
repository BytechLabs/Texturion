import XCTest
@testable import Loonext

/// #461 — "Why is member able to see all settings (sure they cant edit but
/// they can still see settings... why?)"
///
/// Vectors shared with packages/shared/src/settings-visibility.test.ts and the
/// Kotlin port. Three hand-maintained section tables is how the clients
/// drifted in the first place.
final class SettingsVisibilityTests: XCTestCase {

    private let personal: Set<SettingsSection> = [
        .profile, .notifications, .devices, .help, .diagnostics,
    ]

    func testPersonalSectionsAreTheMembersOwn() {
        for section in personal {
            XCTAssertTrue(section.isPersonal, "\(section.rawValue) should be personal")
        }
    }

    func testTheBusinessSettingsAreNotAMembers() {
        let business = SettingsSection.allCases.filter { !personal.contains($0) }
        for section in business {
            XCTAssertFalse(
                section.isPersonal,
                "\(section.rawValue) is the business's, not a member's"
            )
        }
        // Guard the guard: if `personal` ever swallowed the list, the loop
        // above would assert nothing.
        XCTAssertGreaterThan(business.count, 5)
    }

    func testTheThreeTheComplaintNamed() {
        // A plan they cannot change, roles they cannot set, a registration
        // they cannot file.
        XCTAssertFalse(SettingsSection.billing.isPersonal)
        XCTAssertFalse(SettingsSection.team.isPersonal)
        XCTAssertFalse(SettingsSection.numbers.isPersonal)
    }

    func testTemplatesAreTheBusinessesWords() {
        // The away message, the text-back and the voicemail greeting are all
        // admin-gated already. A template is the same class of thing: words the
        // whole crew sends in the business's name. Using them is untouched —
        // the composer's picker is not this surface.
        XCTAssertFalse(SettingsSection.templates.isPersonal)
    }

    func testAMemberNeverGetsAnEmptySettingsScreen() {
        // A settings index with nothing in it reads as broken. Diagnostics is
        // excluded here because it is hidden behind the seven-tap unlock.
        let visible = SettingsSection.allCases.filter {
            $0.isPersonal && $0 != .diagnostics
        }
        XCTAssertGreaterThanOrEqual(visible.count, 4)
    }
}
