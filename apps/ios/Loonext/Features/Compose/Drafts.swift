import Foundation

/// Client-side composer drafts, one per conversation (SPEC: the server keeps
/// NO drafts — restore-on-failure and cross-open persistence are purely ours).
/// Text only: staged photos/files reference transient picker grants that do
/// not survive the process, so persisting them would restore dead chips.
@MainActor
final class ComposerDrafts {
    /// The new-conversation screen's draft rides a fixed slot.
    static let newConversation = "new"

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(_ conversationId: String) -> String {
        "composer-draft:\(conversationId)"
    }

    func load(_ conversationId: String) -> String {
        defaults.string(forKey: key(conversationId)) ?? ""
    }

    func save(_ conversationId: String, text: String) {
        if text.isBlank {
            defaults.removeObject(forKey: key(conversationId))
        } else {
            defaults.set(text, forKey: key(conversationId))
        }
    }

    func clear(_ conversationId: String) {
        defaults.removeObject(forKey: key(conversationId))
        defaults.removeObject(forKey: mentionKey(conversationId))
    }

    // MARK: - Note mentions
    //
    // The teammates named on a note draft ride WITH the text. Persisting only
    // the words restored a draft that still read "@Sam" and notified nobody,
    // which is worse than losing the draft: the note on screen was evidence of
    // something that would not happen.
    //
    // JSON under a separate key, so a draft written by an older build still
    // loads and a value we cannot decode costs the picks rather than the draft.

    private func mentionKey(_ conversationId: String) -> String {
        "composer-draft-mentions:\(conversationId)"
    }

    func loadMentions(_ conversationId: String) -> [PickedMention] {
        guard let data = defaults.data(forKey: mentionKey(conversationId)) else { return [] }
        return (try? JSONDecoder().decode([PickedMention].self, from: data)) ?? []
    }

    func saveMentions(_ conversationId: String, mentions: [PickedMention]) {
        if mentions.isEmpty {
            defaults.removeObject(forKey: mentionKey(conversationId))
        } else if let data = try? JSONEncoder().encode(mentions) {
            defaults.set(data, forKey: mentionKey(conversationId))
        }
    }
}
