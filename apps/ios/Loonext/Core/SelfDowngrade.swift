import Foundation

/// #538 — taking powers away from yourself, said out loud first.
///
/// The hand-port of `packages/shared/src/self-downgrade.ts`, and the third copy
/// after `core/roles/SelfDowngrade.kt`.
///
/// ## The trap
///
/// An admin who sets their own role to member loses the ability to change roles in
/// the same stroke — which is the ability that would let them change it back.
/// Nothing asked, nothing warned, and the way out is to go and find the owner. In a
/// workspace whose owner is on a roof with no signal, that is a real afternoon lost
/// to a control that looked like a menu.
///
/// ## Why this cannot be a rank comparison
///
/// Roles are capability SETS, not rungs (#315). A bookkeeper has billing that a
/// plain member does not, so "is this a downgrade" is a question about what is being
/// taken away rather than about which role sits higher — there is no higher.
///
/// ## Why the capability table is repeated here
///
/// iOS has no capability model of its own; the server is the authority and the
/// clients have never needed one. Rather than build one for a single warning, the
/// sets sit here — and `SelfDowngradeTests` reads
/// `packages/shared/src/capabilities.ts` and fails if any role's set drifts. That
/// test caught two mistakes in the Kotlin twin's copy of this same table on its
/// first run, which is precisely why it exists.
enum SelfDowngrade {

    /// The field the server requires before it will take somebody's own access.
    static let ack = "confirm_losing_access"

    /// What each capability means to somebody deciding whether to give it up.
    ///
    /// Written as things they DO. "team.manage" tells a developer what is being
    /// revoked and tells an owner nothing.
    private static let plain: [String: String] = [
        "billing.manage": "the plan and billing",
        "settings.manage": "workspace settings",
        "team.manage": "who is on the team and what they can do",
        "numbers.manage": "phone numbers",
        "history.read": "the history log",
        "contacts.bulk": "importing and exporting customers",
    ]

    /// The capability set for each role. Kept in step with the shared module by test.
    static let capabilities: [String: [String]] = [
        "member": [
            "workspace.access",
            "conversations.read",
            "conversations.send",
            "conversations.note",
        ],
        "read_only": ["workspace.access", "conversations.read"],
        // Billing and NOT the history log.
        "bookkeeper": ["workspace.access", "billing.manage"],
        "admin": [
            "workspace.access",
            "conversations.read",
            "conversations.send",
            "conversations.note",
            "billing.manage",
            "settings.manage",
            "team.manage",
            "numbers.manage",
            "history.read",
            "contacts.bulk",
        ],
    ]

    /// What only an owner can do. Named so the parity test can check it.
    static let ownerOnly = ["workspace.own"]

    /// The owner holds everything, so it is derived rather than listed.
    ///
    /// Spelling out an owner's set would be a fourth place to forget a new
    /// capability, and the one role where a gap is silent — an owner never gets a
    /// refusal that would reveal it.
    private static func capabilitiesOf(_ role: String) -> [String] {
        if role == "owner" {
            var seen: [String] = []
            for set in capabilities.values {
                for cap in set where !seen.contains(cap) { seen.append(cap) }
            }
            return seen + ownerOnly
        }
        return capabilities[role] ?? []
    }

    /// What a member would lose by moving from one role to another.
    static func capabilitiesLost(from: String, to: String) -> [String] {
        let after = Set(capabilitiesOf(to))
        return capabilitiesOf(from).filter { !after.contains($0) }
    }

    /// Does this change take anything away? False for a promotion.
    static func isDowngrade(from: String, to: String) -> Bool {
        !capabilitiesLost(from: from, to: to).isEmpty
    }

    /// The one that cannot be undone by the person doing it.
    ///
    /// `team.manage` is the capability that changes roles, so losing it is the moment
    /// somebody stops being able to reverse their own decision. Singled out because
    /// it is the difference between "you will have less access" — which people accept
    /// easily and correctly — and "you will not be able to put this back".
    static func losesRoleControl(from: String, to: String) -> Bool {
        capabilitiesLost(from: from, to: to).contains("team.manage")
    }

    /// The sentence to show before somebody takes powers off themselves.
    ///
    /// Nil when the change takes nothing away, so a caller can ask unconditionally
    /// and get silence on a promotion.
    ///
    /// Names at most three things and then counts the rest: six revoked capabilities
    /// listed in full reads as legal boilerplate and gets skipped, which defeats the
    /// whole point of asking.
    static func warning(from: String, to: String) -> String? {
        let lost = capabilitiesLost(from: from, to: to)
        if lost.isEmpty { return nil }
        let named = lost.compactMap { plain[$0] }
        let head = Array(named.prefix(3))
        let rest = named.count - head.count
        let list: String
        if head.isEmpty {
            list = "some of what you can do now"
        } else if head.count == 1 {
            list = head[0]
        } else {
            list = head.dropLast().joined(separator: ", ") + " and " + head[head.count - 1]
        }
        let scope = rest > 0 ? "\(list), and \(rest) more" : list
        let undo = losesRoleControl(from: from, to: to)
            ? " You won't be able to change it back yourself — only an owner can."
            : ""
        return "You'll lose access to \(scope).\(undo)"
    }
}
