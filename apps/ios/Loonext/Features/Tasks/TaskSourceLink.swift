import Foundation

enum TaskSourceKind: Equatable {
    case text
    case call
    case note
}

/// The thread to open for a task's source: the message, or the call's line.
struct TaskSourceLink: Equatable {
    let kind: TaskSourceKind
    /// Names the source: "From a text from Sam".
    let label: String
    let conversationId: String
    let messageId: String?
    let callSessionId: String?
}

/// #718: the link from a task back to where it came from, or nil. It exists
/// only when the source does and it names that source, so a standalone task
/// never prints "Open conversation". Mirrors the web's `taskSourceLink`.
func taskSourceLink(
    conversationId: String?,
    messageId: String?,
    source: TaskSource?,
    call: TaskSourceCall?,
    sourceMessageDirection: String?,
    contactName: String?,
    locale: String?
) -> TaskSourceLink? {
    guard let conversationId else { return nil }
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }

    if source?.kind == "call" || call != nil {
        let name = call.map { taskCallerName($0, locale: locale) }
            ?? say("contactsTasks.callUnknownCaller")
        return TaskSourceLink(
            kind: .call,
            label: say("contactsTasks.linkFromCall", ["name": name]),
            conversationId: conversationId,
            messageId: nil,
            callSessionId: call?.call_session_id
        )
    }
    guard let messageId else { return nil }
    if sourceMessageDirection == "note" || source?.direction == "note" {
        return TaskSourceLink(
            kind: .note,
            label: say("contactsTasks.linkNote"),
            conversationId: conversationId,
            messageId: messageId,
            callSessionId: nil
        )
    }
    let trimmed = contactName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return TaskSourceLink(
        kind: .text,
        label: trimmed.isEmpty
            ? say("contactsTasks.linkFromTextUnnamed")
            : say("contactsTasks.linkFromText", ["name": trimmed]),
        conversationId: conversationId,
        messageId: messageId,
        callSessionId: nil
    )
}
