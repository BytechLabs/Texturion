import Foundation

/// #410 — how long they have been a customer, and how often, in one line.
/// #505 — and the same fact again, shortened, for the thread header.
///
/// Hand-ported from `packages/shared/src/contact-relationship.ts`, whose
/// `CONTACT_RELATIONSHIP_CASES` and `CONTACT_REPEAT_BADGE_CASES` tables are the
/// fixtures this is pinned against case for case (see
/// `ContactRelationshipTests`). The same deal `SettingsLogic` and
/// `MentionLogic` already keep.
///
/// Two facts and deliberately not a third: a count and a date are
/// observations, while a score or a segment is a judgement, and the line this
/// product holds is that it never tells a crew what a customer is worth.

/// #228 — catalogue KEYS. The old table was fixed rather than locale-derived
/// because a DEVICE locale is not a shared input; the app locale is, and every
/// screen here already resolves against it.
private let relationshipMonthKeys = [
    "domain.monthJanuary", "domain.monthFebruary", "domain.monthMarch",
    "domain.monthApril", "domain.monthMay", "domain.monthJune",
    "domain.monthJuly", "domain.monthAugust", "domain.monthSeptember",
    "domain.monthOctober", "domain.monthNovember", "domain.monthDecember",
]

/// "March 2026" from an ISO timestamp, or nil when it cannot be read.
///
/// Parsed off the STRING rather than through `Date`, so a device timezone
/// cannot shift a midnight-UTC first conversation into the previous month on
/// one client and not another.
func monthYear(_ iso: String?, locale: String? = nil) -> String? {
    guard let trimmed = iso?.trimmingCharacters(in: .whitespacesAndNewlines),
          trimmed.count >= 7
    else { return nil }

    let parts = trimmed.split(separator: "-", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count >= 2,
          parts[0].count == 4,
          parts[1].count >= 2,
          let year = Int(parts[0]),
          year > 0,
          let month = Int(parts[1].prefix(2)),
          month >= 1,
          month <= 12
    else { return nil }

    return "\(AppStrings.translate(locale, relationshipMonthKeys[month - 1])) \(parts[0])"
}

/// The identity line, or nil when there is nothing worth saying.
///
/// Nil on a contact with no conversations — one somebody typed in, or one
/// whose history sits entirely on numbers this member cannot see. Both
/// honestly mean "nothing to tell you".
func contactRelationshipLine(
    _ conversationCount: Int?,
    _ firstConversationAt: String?,
    locale: String? = nil
) -> String? {
    let count = conversationCount ?? 0
    if count <= 0 { return nil }
    // One and many are separate keys: English gets away with an "s", a language
    // that agrees the noun with the number does not.
    let conversations = count == 1
        ? AppStrings.translate(locale, "domain.contactConversationOne")
        : AppStrings.translate(
            locale,
            "domain.contactConversationMany",
            ["count": String(count)]
        )
    // A count with no date still earns its place: "3 conversations" answers the
    // question this exists for, and inventing a date would not.
    guard let since = monthYear(firstConversationAt, locale: locale) else {
        return conversations
    }
    return AppStrings.translate(
        locale,
        "domain.contactSince",
        ["since": since, "conversations": conversations]
    )
}

/// Two, because the conversation on screen is one of them.
///
/// Mirrored from `REPEAT_CUSTOMER_MINIMUM` rather than written as a literal at
/// the one call site, so the three clients cannot quietly drift apart on where
/// "repeat customer" starts.
let repeatCustomerMinimum = 2

/// #505 — the THREAD-HEADER form of the relationship: a count, or nothing.
///
/// Not just `contactRelationshipLine` again. A contact record is a READING
/// surface and a thread header is a GLANCE surface, so the same truth is
/// carried at two weights: `ContactDetailView` spends a full line on "Customer
/// since March 2026 · 7 conversations" because whoever opened it is reading,
/// and the header spends a chip on "7 conversations" because whoever is
/// mid-reply is not.
///
/// Nil below two, and that is the feature rather than an edge case.
/// `conversation_count` counts every conversation with this contact INCLUDING
/// the open one, so a first-time caller reads exactly 1 — and a header that
/// decorates everybody distinguishes nobody. Their header stays exactly what it
/// was before this shipped; the ABSENCE of the chip is what says they are new,
/// which costs no glance at all. `contactRelationshipLine` still says "1
/// conversation" on the contact screen, because on a surface somebody chose to
/// read, being new IS worth a line.
///
/// The count is the number-access-filtered one the server derived (#106/D88).
/// A member kept off a number must not learn the customer's history from a chip
/// either, so nothing here re-counts or re-filters anything.
func contactRepeatBadge(_ conversationCount: Int?, locale: String? = nil) -> String? {
    let count = conversationCount ?? 0
    // A count that arrived negative is not a repeat customer either: fail quiet
    // rather than printing "-3 conversations" beside somebody's name.
    if count < repeatCustomerMinimum { return nil }
    // No singular branch, unlike `contactRelationshipLine` above — nothing
    // below two reaches this line, so "1 conversations" cannot be reached.
    return AppStrings.translate(
        locale,
        "domain.contactConversationMany",
        ["count": String(count)]
    )
}
