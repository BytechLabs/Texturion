import Foundation

/// #690: the words that point at a task, a contact or a conversation.
///
///   #T-142            task number 142 in this workspace
///   #contact-1a2b3c4d a contact (the first eight hex digits of its id)
///   #conv-1a2b3c4d    a conversation (the same)
///
/// A hand port of `packages/shared/src/task-references.ts`, run against
/// `packages/shared/vectors/task-references.json`. No regular expression, no
/// look-behind and no word-boundary escape: `\b` does not compile in a Swift
/// regex literal, so the scan walks the characters.
///
/// The rule, identical on every client and on the server: the token starts the
/// text or follows a character that is not a letter, a digit or `#`, and it is
/// not followed by a letter or a digit. `a#T-1` and `#T-1x` are not references.
///
/// Customer-facing texts are never read for references, and a `#` typed into a
/// text to a customer stays a `#`.

enum ReferenceKind: String, Sendable, Equatable {
    case task
    case contact
    case conversation
}

struct ReferenceToken: Equatable, Sendable {
    let kind: ReferenceKind
    /// The task number, or the lower-case eight hex digits.
    let key: String
    /// Character offsets of the token in the text, `#` included.
    let start: Int
    let end: Int
    let raw: String
}

private func isAsciiDigit(_ c: Character) -> Bool {
    guard let v = c.asciiValue else { return false }
    return v >= 48 && v <= 57
}

private func isAsciiLetter(_ c: Character) -> Bool {
    guard let v = c.asciiValue else { return false }
    return (v >= 65 && v <= 90) || (v >= 97 && v <= 122)
}

private func isWordChar(_ c: Character?) -> Bool {
    guard let c else { return false }
    return isAsciiDigit(c) || isAsciiLetter(c)
}

/// Lower-cases A-Z only, one character to one character, so the scan never
/// changes how many characters there are.
private func asciiLowercased(_ c: Character) -> Character {
    if let v = c.asciiValue, v >= 65, v <= 90 {
        return Character(UnicodeScalar(v + 32))
    }
    return c
}

private func isLowerHex(_ c: Character) -> Bool {
    guard let v = c.asciiValue else { return false }
    return (v >= 48 && v <= 57) || (v >= 97 && v <= 102)
}

/// Every reference in the text, in order.
func parseReferenceTokens(_ text: String) -> [ReferenceToken] {
    let chars = Array(text)
    var out: [ReferenceToken] = []
    var i = 0
    while i < chars.count {
        guard chars[i] == "#" else {
            i += 1
            continue
        }
        let before: Character? = i > 0 ? chars[i - 1] : nil
        if let before, isWordChar(before) || before == "#" {
            i += 1
            continue
        }
        if let token = referenceToken(in: chars, at: i) {
            out.append(token)
            i = token.end
        } else {
            i += 1
        }
    }
    return out
}

/// The token that starts at the `#` at `hash`, if the characters after it spell
/// one and the character after THAT is not a letter or a digit.
private func referenceToken(in chars: [Character], at hash: Int) -> ReferenceToken? {
    let lowered = chars.map(asciiLowercased)
    func matches(_ prefix: String, at index: Int) -> Bool {
        let want = Array(prefix)
        guard index + want.count <= lowered.count else { return false }
        for k in 0 ..< want.count where lowered[index + k] != want[k] { return false }
        return true
    }
    func finish(_ kind: ReferenceKind, _ key: String, _ end: Int) -> ReferenceToken? {
        if end < chars.count, isWordChar(chars[end]) { return nil }
        return ReferenceToken(
            kind: kind,
            key: key,
            start: hash,
            end: end,
            raw: String(chars[hash ..< end])
        )
    }

    if matches("t-", at: hash + 1) {
        var end = hash + 3
        while end < chars.count, isAsciiDigit(chars[end]) { end += 1 }
        let digits = end - (hash + 3)
        // One to nine digits; a tenth is a word character that fails `finish`,
        // and zero digits is not a number at all.
        guard digits >= 1, digits <= 9 else { return nil }
        let number = Int(String(chars[(hash + 3) ..< end])) ?? 0
        return finish(.task, String(number), end)
    }
    for (prefix, kind) in [("contact-", ReferenceKind.contact), ("conv-", ReferenceKind.conversation)] {
        guard matches(prefix, at: hash + 1) else { continue }
        let from = hash + 1 + prefix.count
        guard from + 8 <= chars.count else { return nil }
        for k in from ..< (from + 8) where !isLowerHex(lowered[k]) { return nil }
        return finish(kind, String(lowered[from ..< (from + 8)]), from + 8)
    }
    return nil
}

/// "T-142", the way a task number is shown and spoken.
func taskNumberLabel(_ number: Int) -> String {
    "T-\(number)"
}

/// The text a picker inserts for a task.
func taskReferenceText(_ number: Int) -> String {
    "#T-\(number)"
}

/// The text a picker inserts for a contact or a conversation. A `.task` kind is
/// not a record id and reads as a conversation, which the picker never asks for.
func recordReferenceText(_ kind: ReferenceKind, id: String) -> String {
    let prefix = String(id.replacingOccurrences(of: "-", with: "").lowercased().prefix(8))
    return "#\(kind == .contact ? "contact" : "conv")-\(prefix)"
}

struct ReferenceQuery: Equatable, Sendable {
    let start: Int
    let query: String
}

/// The "#" the member just typed, if the caret sits at the end of one: the
/// query after it. A picker opens on this. Nil when the caret is not in a
/// `#word`, or the `#` follows a letter or digit (a URL fragment, "No.#4").
func referenceQueryAt(_ text: String, caret: Int) -> ReferenceQuery? {
    let chars = Array(text)
    guard caret >= 0, caret <= chars.count else { return nil }
    var i = caret
    while i > 0, isWordChar(chars[i - 1]) || chars[i - 1] == "-" { i -= 1 }
    guard i > 0, chars[i - 1] == "#" else { return nil }
    let hash = i - 1
    let before: Character? = hash > 0 ? chars[hash - 1] : nil
    if let before, isWordChar(before) || before == "#" { return nil }
    return ReferenceQuery(start: hash, query: String(chars[i ..< caret]))
}

/// Should typing `value` over `previous` open the reference picker?
///
/// Exactly one character was appended, it is a `#`, and the `#` is a fresh one
/// (not glued to a word). Only the places that take references call this: a
/// conversation NOTE, a task description and a task comment. The composer for a
/// text to a customer never does, so a `#` there is only ever a `#`.
func opensReferencePicker(previous: String, value: String) -> Bool {
    guard value.count == previous.count + 1, value.hasPrefix(previous) else { return false }
    guard value.last == "#" else { return false }
    return referenceQueryAt(value, caret: value.count) != nil
}

/// The composer's rule: only a NOTE takes references. A text to a customer is
/// never read for them, whatever is typed in it, and the picker never opens.
func composerOpensReferencePicker(
    isNote: Bool,
    enabled: Bool,
    previous: String,
    value: String
) -> Bool {
    isNote && enabled && opensReferencePicker(previous: previous, value: value)
}

/// What a text box holds after the member picks something: the `#word` at the
/// end of the draft is replaced by the reference and a space. A text box here
/// does not report its caret, so the end of the draft is the caret.
func insertingReference(into text: String, insert: String) -> String {
    let chars = Array(text)
    var head = text
    if let at = referenceQueryAt(text, caret: chars.count) {
        head = String(chars[0 ..< at.start])
    }
    // A reference glued to a word is not a reference, so give it room.
    if let last = head.last, isWordChar(last) || last == "#" { head += " " }
    return head + insert + " "
}

// MARK: - What the server says a reference points at now

struct ResolvedTaskRef: Codable, Sendable, Equatable {
    let number: Int
    let id: String
    let title: String
    let done: Bool
}

struct ResolvedContactRef: Codable, Sendable, Equatable {
    let prefix: String
    let id: String
    let name: String?
}

struct ResolvedConversationRef: Codable, Sendable, Equatable {
    let prefix: String
    let id: String
    let contact_name: String?
}

/// GET /v1/references/resolve. Anything unknown, deleted or on a denied number
/// is simply absent, so a token with no entry stays plain text.
struct ResolvedReferences: Codable, Sendable, Equatable {
    var tasks: [ResolvedTaskRef]?
    var contacts: [ResolvedContactRef]?
    var conversations: [ResolvedConversationRef]?
}

/// What a chip says and where a tap goes.
struct ReferenceChipInfo: Equatable, Sendable {
    let kind: ReferenceKind
    /// The row id the tap opens.
    let targetId: String
    /// "T-142 Title", a contact's name, a conversation's contact name.
    let label: String
    /// Tasks only: finished or not.
    let done: Bool
}

/// The server's answers, kept so the same token is not asked for twice.
struct ReferenceCache: Sendable {
    private(set) var tasks: [String: ResolvedTaskRef] = [:]
    private(set) var contacts: [String: ResolvedContactRef] = [:]
    private(set) var conversations: [String: ResolvedConversationRef] = [:]
    /// Everything already asked about, answered or not, and when. An answer is
    /// good for a minute: a task renamed or finished shows its new chip the
    /// next time its text is drawn after that.
    private(set) var asked: [String: Date] = [:]
    static let timeToLive: TimeInterval = 60

    private func askedKey(_ token: ReferenceToken) -> String {
        "\(token.kind.rawValue):\(token.key)"
    }

    /// The tokens that still need asking about.
    func missing(_ tokens: [ReferenceToken], now: Date = Date()) -> [ReferenceToken] {
        var seen: Set<String> = []
        var out: [ReferenceToken] = []
        for token in tokens {
            let key = askedKey(token)
            if seen.contains(key) { continue }
            if let when = asked[key], now.timeIntervalSince(when) < Self.timeToLive { continue }
            seen.insert(key)
            out.append(token)
        }
        return out
    }

    mutating func record(
        asking tokens: [ReferenceToken],
        answer: ResolvedReferences,
        now: Date = Date()
    ) {
        for token in tokens {
            asked[askedKey(token)] = now
            // What the server no longer answers for (deleted, or a number this
            // member is denied) must stop drawing as a chip.
            switch token.kind {
            case .task: tasks[token.key] = nil
            case .contact: contacts[token.key] = nil
            case .conversation: conversations[token.key] = nil
            }
        }
        for task in answer.tasks ?? [] { tasks[String(task.number)] = task }
        for contact in answer.contacts ?? [] { contacts[contact.prefix.lowercased()] = contact }
        for conv in answer.conversations ?? [] { conversations[conv.prefix.lowercased()] = conv }
    }

    func chip(for token: ReferenceToken) -> ReferenceChipInfo? {
        switch token.kind {
        case .task:
            guard let task = tasks[token.key] else { return nil }
            return ReferenceChipInfo(
                kind: .task,
                targetId: task.id,
                label: "\(taskNumberLabel(task.number)) \(task.title)",
                done: task.done
            )
        case .contact:
            guard let contact = contacts[token.key] else { return nil }
            let name = (contact.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return ReferenceChipInfo(
                kind: .contact,
                targetId: contact.id,
                label: name.isEmpty ? token.raw : name,
                done: false
            )
        case .conversation:
            guard let conv = conversations[token.key] else { return nil }
            let name = (conv.contact_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return ReferenceChipInfo(
                kind: .conversation,
                targetId: conv.id,
                label: name.isEmpty ? token.raw : name,
                done: false
            )
        }
    }
}

/// The comma lists GET /v1/references/resolve takes. Nil when there is nothing
/// of that kind, so the query does not carry an empty parameter. Fifty at most.
func referenceResolveQuery(_ tokens: [ReferenceToken]) -> [String: String?] {
    func list(_ kind: ReferenceKind) -> String? {
        var keys: [String] = []
        for token in tokens where token.kind == kind && !keys.contains(token.key) {
            keys.append(token.key)
        }
        return keys.isEmpty ? nil : keys.prefix(50).joined(separator: ",")
    }
    return [
        "tasks": list(.task),
        "contacts": list(.contact),
        "conversations": list(.conversation),
    ]
}

// MARK: - Relations and linked tasks

/// What the OTHER task is to this one.
enum TaskRelation {
    static let blockedBy = "blocked_by"
    static let blocks = "blocks"
    static let parent = "parent"
    static let subTask = "sub_task"
    static let all = [blockedBy, blocks, parent, subTask]

    static func labelKey(_ relation: String) -> String {
        switch relation {
        case blockedBy: return "taskRefs.relBlockedBy"
        case blocks: return "taskRefs.relBlocks"
        case parent: return "taskRefs.relParent"
        default: return "taskRefs.relSubTask"
        }
    }
}

struct TaskLink: Codable, Sendable, Identifiable, Equatable {
    let relation: String
    let task_id: String
    let number: Int
    let title: String
    let done: Bool

    var id: String { relation + ":" + task_id }
}

/// One row of GET /v1/conversations/:id/linked-tasks and /v1/contacts/:id/linked-tasks.
struct LinkedTask: Codable, Sendable, Identifiable, Equatable {
    let id: String
    let number: Int
    let title: String
    let done: Bool
    let due_at: String?
    let how: [String]?
}

/// A back-reference or an outgoing reference in a task's activity feed.
struct ReferenceContactStub: Codable, Sendable, Equatable {
    let id: String
    let name: String?
}

struct ReferenceTaskStub: Codable, Sendable, Equatable {
    let id: String
    let number: Int
    let title: String
}

/// The sentence for a "reference" activity item, from the catalogue.
func taskReferenceSentence(_ item: TaskFeedItem, by: String, locale: String?) -> String {
    func say(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }
    let contactName = (item.contact?.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let who = contactName.isEmpty ? say("taskRefs.aContact") : contactName
    if item.direction == "out" {
        switch item.target_kind {
        case "contact":
            return say("taskRefs.outContact", ["name": who])
        case "conversation":
            return say("taskRefs.outConversation", ["name": who])
        case "task":
            guard let task = item.task else { return say("taskRefs.outOther") }
            let label = "\(taskNumberLabel(task.number)) \(task.title)"
            return say("taskRefs.outTask", ["task": label])
        default:
            return say("taskRefs.outOther")
        }
    }
    switch item.source_kind {
    case "task_description", "task_comment":
        guard let task = item.task else { return say("taskRefs.inTaskFallback", ["by": by]) }
        return say(
            "taskRefs.inTask",
            ["task": "\(taskNumberLabel(task.number)) \(task.title)", "by": by]
        )
    default:
        return say("taskRefs.inNote", ["name": who, "by": by])
    }
}

/// The sentence for a `link_added` / `link_removed` event.
func taskLinkSentence(_ item: TaskFeedItem, by: String, locale: String?) -> String {
    let removed = item.event == "link_removed"
    let side = removed ? item.from : item.to
    let relation = side?["relation"]?.stringValue ?? ""
    let number = side?["number"]?.intValue
    let title = side?["title"]?.stringValue ?? ""
    let other = number.map { "\(taskNumberLabel($0)) \(title)" } ?? title
    let key: String
    switch (relation, removed) {
    case (TaskRelation.blockedBy, false): key = "taskRefs.histBlockedByAdded"
    case (TaskRelation.blockedBy, true): key = "taskRefs.histBlockedByRemoved"
    case (TaskRelation.blocks, false): key = "taskRefs.histBlocksAdded"
    case (TaskRelation.blocks, true): key = "taskRefs.histBlocksRemoved"
    case (TaskRelation.parent, false): key = "taskRefs.histParentAdded"
    case (TaskRelation.parent, true): key = "taskRefs.histParentRemoved"
    case (_, false): key = "taskRefs.histSubTaskAdded"
    case (_, true): key = "taskRefs.histSubTaskRemoved"
    }
    return AppStrings.translate(locale, key, ["by": by, "task": other])
}

// MARK: - The picker's rows

/// One thing the `#` picker offers.
struct ReferencePick: Identifiable, Equatable, Sendable {
    let id: String
    let kind: ReferenceKind
    /// The task, contact or conversation id the row stands for.
    let targetId: String
    /// The plain text written into the draft.
    let insertText: String
    let title: String
    let subtitle: String?
}

/// Tasks (by the list's own search, which reads "T-142" and "142" too), then
/// contacts, then conversations. A task row from an older server has no number
/// and cannot be referenced, so it is left out.
func referencePicks(tasks: [TaskItem], search: SearchResult?) -> [ReferencePick] {
    var out: [ReferencePick] = []
    for task in tasks {
        guard let number = task.number else { continue }
        out.append(
            ReferencePick(
                id: "task:" + task.id,
                kind: .task,
                targetId: task.id,
                insertText: taskReferenceText(number),
                title: "\(taskNumberLabel(number)) \(task.title)",
                subtitle: task.contact?.name
            )
        )
    }
    for contact in search?.contacts ?? [] {
        let name = (contact.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        out.append(
            ReferencePick(
                id: "contact:" + contact.id,
                kind: .contact,
                targetId: contact.id,
                insertText: recordReferenceText(.contact, id: contact.id),
                title: name.isEmpty ? contact.phone_e164 : name,
                subtitle: name.isEmpty ? nil : contact.phone_e164
            )
        )
    }
    for conv in search?.conversations ?? [] {
        let name = (conv.contact.name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        out.append(
            ReferencePick(
                id: "conv:" + conv.id,
                kind: .conversation,
                targetId: conv.id,
                insertText: recordReferenceText(.conversation, id: conv.id),
                title: name.isEmpty ? conv.contact.phone_e164 : name,
                subtitle: conv.snippet
            )
        )
    }
    return out
}

// MARK: - The calls

struct TaskReferencesApi: Sendable {
    let api: ApiClient

    func links(companyId: String, taskId: String) async throws -> [TaskLink] {
        let page: Page<TaskLink> = try await api.get(
            "/v1/tasks/\(taskId)/links",
            companyId: companyId
        )
        return page.data
    }

    /// A loop is a 422 and a second parent a 409; both reach the caller as the
    /// `ApiError` the server's own sentence rides on.
    func addLink(
        companyId: String,
        taskId: String,
        relation: String,
        otherTaskId: String
    ) async throws -> [TaskLink] {
        let page: Page<TaskLink> = try await api.post(
            "/v1/tasks/\(taskId)/links",
            body: JSONValue.object([
                "relation": .string(relation),
                "task_id": .string(otherTaskId),
            ]),
            companyId: companyId
        )
        return page.data
    }

    func removeLink(
        companyId: String,
        taskId: String,
        otherTaskId: String,
        relation: String
    ) async throws {
        _ = try await api.raw(
            "DELETE",
            "/v1/tasks/\(taskId)/links/\(otherTaskId)",
            query: ["relation": relation],
            companyId: companyId
        )
    }

    func linkedTasks(companyId: String, conversationId: String) async throws -> [LinkedTask] {
        let page: Page<LinkedTask> = try await api.get(
            "/v1/conversations/\(conversationId)/linked-tasks",
            companyId: companyId
        )
        return page.data
    }

    func linkedTasks(companyId: String, contactId: String) async throws -> [LinkedTask] {
        let page: Page<LinkedTask> = try await api.get(
            "/v1/contacts/\(contactId)/linked-tasks",
            companyId: companyId
        )
        return page.data
    }

    func resolve(companyId: String, tokens: [ReferenceToken]) async throws -> ResolvedReferences {
        try await api.get(
            "/v1/references/resolve",
            query: referenceResolveQuery(tokens),
            companyId: companyId
        )
    }
}
