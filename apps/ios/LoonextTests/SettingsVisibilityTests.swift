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

    /// #286: the business's, but open to every role, because reading who is in
    /// the crew and changing who is in it are different rights. "A new member
    /// can identify the owner and the rest of the crew without asking" is an
    /// Acceptance line a hidden row cannot meet. Kept out of `personal` for
    /// exactly that reason: it is not theirs, it is one they may read.
    private let readableByAll: Set<SettingsSection> = [.team]

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
        let business = SettingsSection.allCases.filter {
            !personal.contains($0) && !readableByAll.contains($0)
        }
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
        XCTAssertEqual(visible(MemberRole.member), personal.union(readableByAll))
    }

    func testTheTwoOfTheThreeTheComplaintNamedThatAreStillHidden() {
        // A plan they cannot change and a registration they cannot file. The
        // third was Team, which #286 reopened as a read — below.
        let member = visible(MemberRole.member)
        XCTAssertFalse(member.contains(.billing))
        XCTAssertFalse(member.contains(.numbers))
    }

    /// #286. A tech who wants to know who owns the workspace, or who to ask
    /// about a thread, previously had no screen at all — and asking is the cost
    /// the issue is about.
    func testAMemberCanSeeWhoIsInTheCrewAndChangeNothing() {
        XCTAssertTrue(visible(MemberRole.member).contains(.team))
        // Shown on the baseline capability; acting on it is not.
        XCTAssertEqual(SettingsSection.team.needs, Capability.workspaceAccess)
        XCTAssertFalse(SettingsRoleGate.canManageTeam(MemberRole.member))
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

    /// #315: the whole point of the preset. Billing, Usage and Getting paid are
    /// the rows their role exists for; every other business row stays hidden.
    ///
    /// #224 added the third. It is `billing.manage` and NOT `workspace.own`,
    /// even though CONNECTING the Stripe account is owner-only on the server —
    /// because opening the screen is how the bookkeeper reaches the Stripe
    /// dashboard to issue a refund, which is the task the role was created to
    /// make possible without sharing the owner's login.
    func testABookkeeperSeesBillingAndNothingElseOfTheBusiness() {
        XCTAssertEqual(
            visible(MemberRole.bookkeeper),
            personal.union(readableByAll).union([.billing, .usage, .payments])
        )
    }

    /// #315: read_only differs from a member in what it can DO, not in what it
    /// sees — so the settings index answers exactly as it does for one.
    func testAViewOnlyObserverSeesTheSameIndexAMemberDoes() {
        XCTAssertEqual(visible(MemberRole.readOnly), personal.union(readableByAll))
    }

    func testAnUnknownOrAbsentRoleIsTreatedAsAMember() {
        // The safe way for a missing membership to fail is least privilege —
        // and least privilege here is still the reader's own rows, because
        // reaching this screen means the server authorized the session.
        // #286: `readableByAll` rides the BASELINE capability, which every
        // recognised role holds — including one this build has never heard of,
        // for the same reason profile and notifications do.
        let baseline = personal.union(readableByAll)
        XCTAssertEqual(visible(nil), baseline)
        XCTAssertEqual(visible(""), baseline)
        XCTAssertEqual(visible("superuser"), baseline)
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
