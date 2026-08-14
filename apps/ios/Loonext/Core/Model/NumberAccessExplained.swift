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
///
/// #228: `locale` is last and defaulted, so the hand-port tests that pin the
/// English are untouched while the screen that knows the reader's language can
/// pass it.
func numberAccessLevelLabel(_ level: String, locale: String? = nil) -> String {
    switch level {
    case "text": AppStrings.translate(locale, "domain.numberAccessCanText")
    case "note": AppStrings.translate(locale, "domain.numberAccessNoteOnly")
    default: AppStrings.translate(locale, "domain.numberAccessHidden")
    }
}

/// Why, in one short clause naming the rule an owner would go and edit.
///
/// The two that carry the most weight look alike and are not: `unruled` means
/// nobody has restricted this number, `no-match` means somebody did and left
/// this person out. Both leave the member un-named by any rule; only one is a
/// mistake, and confusing them is how an owner concludes the rules are broken.
func numberAccessReason(
    _ decidedBy: String,
    _ principal: String?,
    /// #286: who is reading. An owner inspecting somebody else's access reads
    /// "them"; a member asking about their own reads "you".
    ///
    /// A PARAMETER and not a second function, matching the shared TypeScript:
    /// these clauses are the one place a security rule is put into words, and
    /// a copy written for the member-facing screen is a copy that drifts.
    ///
    /// Labelled `isSelf` rather than `self`, which is a reserved word an
    /// argument label can only carry in backticks — and a backticked label on
    /// a function three clients call is a trap for the next reader.
    isSelf: Bool = false,
    /// #228: the reader's language. LAST and defaulted, so the parity tests
    /// that pin these clauses in English are untouched while the two screens
    /// that know their reader can pass it.
    locale: String? = nil
) -> String {
    switch decidedBy {
    case "user":
        AppStrings.translate(
            locale,
            isSelf ? "domain.numberAccessRuleNamingYou" : "domain.numberAccessRuleNamingThem"
        )
    case "role":
        // The role is the wire value the rule named, and it is not translated:
        // it is the same word on the rule an owner would go and edit.
        //
        // `map`/`??` rather than an `if let` expression, keeping the shape the
        // arm already had — this file compiles nowhere but CI, so a working
        // expression is not worth swapping for a newer spelling of itself.
        principal.map {
            AppStrings.translate(locale, "domain.numberAccessRuleForRole", ["role": $0])
        } ?? AppStrings.translate(
            locale,
            isSelf
                ? "domain.numberAccessRuleForYourRole"
                : "domain.numberAccessRuleForTheirRole"
        )
    case "all": AppStrings.translate(locale, "domain.numberAccessRuleForEveryone")
    case "no-match":
        AppStrings.translate(
            locale,
            isSelf ? "domain.numberAccessNoMatchYou" : "domain.numberAccessNoMatchThem"
        )
    case "unruled": AppStrings.translate(locale, "domain.numberAccessUnruled")
    case "role-override":
        AppStrings.translate(
            locale,
            principal == "owner"
                ? "domain.numberAccessOwners"
                : "domain.numberAccessAdmins"
        )
    default:
        AppStrings.translate(
            locale,
            isSelf ? "domain.numberAccessNotMemberYou" : "domain.numberAccessNotMemberThem"
        )
    }
}

/**
 #286 — what a MEMBER is owed when a number is missing from their app.

 The issue names the failure precisely: a new tech who can see one line and not
 another reads the absence as the app being broken, and "silent absence is the
 worse failure". This is the sentence under the list, and it is the part that
 stops the reader concluding it is a bug and stops them asking the owner one at
 a time.

 Nil when there is nothing to explain: a member who reaches everything has no
 absence to account for, and a paragraph reassuring them about a problem they
 do not have is furniture.
 */
func numberAccessSelfNote(
    _ rows: [NumberAccessExplanation],
    locale: String? = nil
) -> String? {
    let hidden = rows.filter { $0.level == "none" }.count
    let readOnly = rows.filter { $0.level == "note" }.count
    if hidden == 0 && readOnly == 0 { return nil }

    // #228: WHOLE sentences with the count interpolated in, rather than a
    // count glued to a fragment. French does not put the number, the noun and
    // the verb in the order English does, and a sentence assembled from pieces
    // can only ever be assembled in one word order.
    var parts: [String] = []
    if hidden > 0 {
        parts.append(
            AppStrings.translate(
                locale,
                hidden == 1
                    ? "domain.numberAccessSelfHiddenOne"
                    : "domain.numberAccessSelfHiddenMany",
                ["count": String(hidden)]
            )
        )
    }
    if readOnly > 0 {
        parts.append(
            AppStrings.translate(
                locale,
                readOnly == 1
                    ? "domain.numberAccessSelfReadOnlyOne"
                    : "domain.numberAccessSelfReadOnlyMany",
                ["count": String(readOnly)]
            )
        )
    }
    let and = AppStrings.translate(locale, "domain.and")
    return AppStrings.translate(
        locale,
        "domain.numberAccessSelfNote",
        ["parts": parts.joined(separator: " \(and) ")]
    )
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
