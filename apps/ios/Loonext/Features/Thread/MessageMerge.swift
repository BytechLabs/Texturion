import Foundation

/// How far along an outbound message is. A send only ever moves FORWARD:
/// queued (accepted by us) → sent (the carrier took it) → delivered/failed.
///
/// `received` is the inbound resting state and shares the floor, since an
/// inbound message never transitions.
private func statusRank(_ status: String?) -> Int {
    switch status {
    case "sent": return 1
    case "delivered", "failed": return 2
    default: return 0
    }
}

/// Keep whichever status is further along when the same message arrives twice.
///
/// A page refetch and the realtime status broadcast race constantly, because
/// the send inserts the queued row and bumps the conversation in ONE
/// transaction, before the carrier is even called: the refetch that bump
/// triggers reads the row while it still says queued, and can land AFTER the
/// broadcast that says sent. Replacing the cached row wholesale walked the
/// bubble backwards to "Sending…" and left it there, because nothing refetches
/// again and the broadcast does not replay.
///
/// Ported from the web and Android clients so all three agree about what a
/// message's state is.
func mergeMessage(_ existing: Message, _ incoming: Message) -> Message {
    // A note carries no status; there is nothing to move backwards.
    guard let existingStatus = existing.status, incoming.status != nil else {
        return incoming
    }
    if statusRank(incoming.status) >= statusRank(existingStatus) { return incoming }
    // The incoming row is otherwise newer, so take it and keep only the status
    // it is behind on.
    var merged = incoming
    merged.status = existingStatus
    merged.error_code = existing.error_code
    merged.error_detail = existing.error_detail
    return merged
}

/// `mergeFirstPage` for MESSAGES: identical ordering, except a fresh row may
/// not move a message's status backwards.
func mergeMessagesFirstPage(_ existing: [Message], _ fresh: [Message]) -> [Message] {
    var existingById: [String: Message] = [:]
    for row in existing { existingById[row.id] = row }
    let reconciled = fresh.map { row -> Message in
        guard let prior = existingById[row.id] else { return row }
        return mergeMessage(prior, row)
    }
    return mergeFirstPage(existing, reconciled, idOf: { $0.id }, sortKey: { $0.created_at })
}
