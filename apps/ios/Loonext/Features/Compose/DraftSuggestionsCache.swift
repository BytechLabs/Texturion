import Foundation

/// The drafts Lou already wrote for a conversation, kept until it moves on.
///
/// Asking costs a real AI call, so the answer is worth keeping: closing the
/// strip and opening it again, or leaving the thread and coming back, must not
/// spend again. And there is deliberately no "try again" — re-rolling until a
/// draft looks nice is the one interaction that turns a bounded per-message
/// cost into an unbounded one, for an answer that is only ever a starting point
/// you edit anyway.
///
/// The key carries the conversation's last activity, so the moment a message is
/// sent or received the old drafts stop applying and the next ask is a fresh
/// one. That is the only thing that should ever buy a new set.
///
/// In memory on purpose: drafts are a momentary offer, not state worth
/// surviving a relaunch. Twin of
/// apps/web/src/lib/messaging/draft-suggestions-cache.ts and
/// apps/android/.../features/compose/DraftSuggestionsCache.kt.
@MainActor
enum DraftSuggestionsCache {
    /// Bound it so a long session over many threads cannot grow forever.
    private static let maxEntries = 50

    private static var entries: [String: [String]] = [:]
    /// Insertion order, so the oldest key is the one evicted.
    private static var order: [String] = []

    /// The cache key for a thread at a point in its history.
    static func key(conversationId: String, lastActivityAt: String?) -> String {
        "\(conversationId):\(lastActivityAt ?? "-")"
    }

    static func read(_ key: String) -> [String]? {
        entries[key]
    }

    static func write(_ key: String, suggestions: [String]) {
        // "Nothing to suggest" is not worth remembering as an answer.
        guard !suggestions.isEmpty else { return }
        if entries[key] == nil { order.append(key) }
        entries[key] = suggestions
        while order.count > maxEntries {
            let oldest = order.removeFirst()
            entries.removeValue(forKey: oldest)
        }
    }

    static func clear() {
        entries.removeAll()
        order.removeAll()
    }
}
