import Foundation

/// #410 — how long they have been a customer, and how often, in one line.
///
/// Hand-ported from `packages/shared/src/contact-relationship.ts`, whose
/// `CONTACT_RELATIONSHIP_CASES` table is the fixture this is pinned against
/// case for case (see `ContactRelationshipTests`). The same deal
/// `SettingsLogic` and `MentionLogic` already keep.
///
/// Two facts and deliberately not a third: a count and a date are
/// observations, while a score or a segment is a judgement, and the line this
/// product holds is that it never tells a crew what a customer is worth.

private let relationshipMonths = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]

/// "March 2026" from an ISO timestamp, or nil when it cannot be read.
///
/// Parsed off the STRING rather than through `Date`, so a device timezone
/// cannot shift a midnight-UTC first conversation into the previous month on
/// one client and not another.
func monthYear(_ iso: String?) -> String? {
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

    return "\(relationshipMonths[month - 1]) \(parts[0])"
}

/// The identity line, or nil when there is nothing worth saying.
///
/// Nil on a contact with no conversations — one somebody typed in, or one
/// whose history sits entirely on numbers this member cannot see. Both
/// honestly mean "nothing to tell you".
func contactRelationshipLine(
    _ conversationCount: Int?,
    _ firstConversationAt: String?
) -> String? {
    let count = conversationCount ?? 0
    if count <= 0 { return nil }
    let conversations = count == 1 ? "1 conversation" : "\(count) conversations"
    // A count with no date still earns its place: "3 conversations" answers the
    // question this exists for, and inventing a date would not.
    guard let since = monthYear(firstConversationAt) else { return conversations }
    return "Customer since \(since) · \(conversations)"
}
