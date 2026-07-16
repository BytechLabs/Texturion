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
    }
}
