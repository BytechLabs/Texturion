import Foundation

/// Pure watermark semantics for the derived feed (D24) — unit-tested on the
/// simulator/macOS CI. The server keeps ONE per-user/per-company last-seen
/// timestamp; an item is unread iff `created_at > watermark`. Marking one
/// item read advances the watermark to its `created_at`, which also marks
/// everything older read while newer items stay unread. The RPC keeps the
/// greatest value, so the watermark only ever moves forward —
/// `advanceWatermark` mirrors that client-side.
///
/// The feed SCREEN ships with the notifications pass (#162); the reducer
/// lives here now because the shell's unread-dot logic and the tests bind to
/// these exact semantics.

/// Optimistically apply a watermark advance to loaded items: everything at or
/// before `lastSeenAt` flips read; newer items keep their unread dot. Items
/// with unparseable timestamps (or an unparseable watermark) are left as the
/// server sent them — never guess read state.
func applyWatermark(items: [NotificationItem], lastSeenAt: String) -> [NotificationItem] {
    guard let watermark = parseWireTimestamp(lastSeenAt) else { return items }
    return items.map { item in
        guard item.unread, let createdAt = parseWireTimestamp(item.created_at) else {
            return item
        }
        if createdAt > watermark { return item }
        var read = item
        read.unread = false
        return read
    }
}

/// Forward-only merge of watermark candidates: returns the later of the two
/// (server semantics — the RPC keeps the greatest, never moves backwards).
/// An unparseable candidate never displaces a valid current value.
func advanceWatermark(current: String?, candidate: String) -> String {
    guard let current, let currentInstant = parseWireTimestamp(current) else {
        return candidate
    }
    guard let candidateInstant = parseWireTimestamp(candidate) else {
        return current
    }
    return candidateInstant > currentInstant ? candidate : current
}
