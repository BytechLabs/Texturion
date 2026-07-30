import Foundation

/// #348 — what one member reaches on every number, and WHY.
///
/// Hand-port of `packages/shared/src/number-access-explained.ts`. The access
/// model has three interacting principal kinds and a precedence order, and all
/// of it was invisible: nothing showed an owner which numbers a member reaches,
/// at what level, or which rule decided it.
///
/// The wording lives in shared and is ported rather than reinvented, because
/// three clients describing one security rule three different ways is the #437
/// failure on the surface where it would matter most.
struct NumberAccessExplanation: Codable, Sendable, Identifiable, Equatable {
    let phone_number_id: String
    var number_e164: String? = nil
    /// "text" | "note" | "none"
    let level: String
    /// user | role | all | no-match | unruled | role-override | not-a-member
    let decided_by: String
    /// The role a 'role' rule named. Nil for every other kind.
    var principal: String? = nil

    var id: String { phone_number_id }
}

/// GET /v1/numbers/access/explain/{userId} — owner/admin only.
struct MemberNumberAccess: Codable, Sendable {
    let user_id: String
    @Default<DefaultEmptyList<NumberAccessExplanation>> var numbers: [NumberAccessExplanation]
}

/// What they can do, in the crew's words rather than the schema's.
func numberAccessLevelLabel(_ level: String) -> String {
    switch level {
    case "text": "Can text"
    case "note": "Read and notes only"
    default: "Hidden"
    }
}

/// Why, in one short clause naming the rule an owner would go and edit.
///
/// The two that carry the most weight look alike and are not: `unruled` means
/// nobody has restricted this number, `no-match` means somebody did and left
/// this person out. Both leave the member un-named by any rule; only one is a
/// mistake, and confusing them is how an owner concludes the rules are broken.
func numberAccessReason(_ decidedBy: String, _ principal: String?) -> String {
    switch decidedBy {
    case "user": "A rule naming them"
    case "role": principal.map { "A rule for \($0)s" } ?? "A rule for their role"
    case "all": "A rule for everyone"
    case "no-match": "This number has rules, and none of them include them"
    case "unruled": "Nobody has restricted this number"
    case "role-override":
        principal == "owner" ? "Owners reach every number" : "Admins reach every number"
    default: "No longer in this workspace"
    }
}

/// Anything short of full use is a restriction worth showing first.
func numberAccessIsRestricted(_ level: String) -> Bool { level != "text" }

extension Array where Element == NumberAccessExplanation {
    /// Restricted first, then by number.
    ///
    /// Somebody opening this screen is checking a suspicion, not reading a
    /// report, and a list that opens with unrestricted rows buries the one that
    /// answers them. Sorted by number inside each group so comparing two members
    /// puts the same numbers in the same places.
    func sortedForOwner() -> [NumberAccessExplanation] {
        sorted { lhs, rhs in
            let l = numberAccessIsRestricted(lhs.level)
            let r = numberAccessIsRestricted(rhs.level)
            if l != r { return l }
            return (lhs.number_e164 ?? "") < (rhs.number_e164 ?? "")
        }
    }
}
