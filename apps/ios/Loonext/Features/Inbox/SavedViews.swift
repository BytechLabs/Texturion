import Foundation

/// #280 — saved views on iOS.
///
/// # This is a hand port, and the thing being ported is a CONTRACT
///
/// `packages/shared/src/saved-views.ts` decides what a view may hold; four
/// things replay those filters and must agree. A drift here does not crash — it
/// produces a view that saves on the phone and opens something else on the web,
/// which is the exact failure the whole feature is judged on.
///
/// So the allow-list below mirrors the TypeScript one key for key, and
/// `SavedViewsPortTests` asserts a positive case for each rather than only the
/// refusals: a port that rejects everything passes a refusal-only suite.
///
/// # A view stores the QUERY
///
/// Never the result. Opening one replays its filters through the ordinary
/// conversations request, so #106 number access applies per viewer and a shared
/// view grants nothing. Nothing in this file reads a conversation.

/// Swift's synthesized decoder IGNORES a property's default value, so a missing
/// key throws rather than falling back. `@Default` is this codebase's answer,
/// and it is used here for every field the server could stop sending without
/// this screen being the thing that should break.
// Not Equatable: the @Default property wrapper is not, so the synthesis would
// fail. Nothing compares two views — they are matched by id.
struct SavedView: Codable, Sendable, Identifiable {
    let id: String
    let surface: String
    let name: String
    @Default<DefaultEmptyFilters> var filters: [String: JSONValue]
    @Default<DefaultZero> var position: Int
    /// True when the whole workspace sees it.
    @Default<DefaultFalse> var shared: Bool
}

enum DefaultEmptyFilters: DefaultCodableProvider {
    static var defaultValue: [String: JSONValue] { [:] }
}

struct SavedViewDefaults: Codable, Sendable, Equatable {
    var conversations: String?
    var tasks: String?
}

enum DefaultNoSavedViewDefaults: DefaultCodableProvider {
    static var defaultValue: SavedViewDefaults { SavedViewDefaults() }
}

enum DefaultNoCounts: DefaultCodableProvider {
    static var defaultValue: [String: Int] { [:] }
}

struct SavedViewPage: Codable, Sendable {
    @Default<DefaultEmptyList<SavedView>> var data: [SavedView]
    @Default<DefaultNoSavedViewDefaults> var defaults: SavedViewDefaults
}

struct SavedViewCounts: Codable, Sendable {
    @Default<DefaultNoCounts> var counts: [String: Int]
}

enum SavedViewLimits {
    /// How many views one counts request will price. Mirrors the shared value.
    static let countMaxViews = 12
    /// Stop counting here and say "99+".
    static let countCeiling = 99
    /// The longest a view name may be.
    static let nameMax = 60
}

/// Render a bounded count the way every client must render it.
func formatViewCount(_ count: Int) -> String {
    count > SavedViewLimits.countCeiling ? "\(SavedViewLimits.countCeiling)+" : String(count)
}

private let conversationStatuses: Set<String> = ["new", "open", "waiting", "closed"]
private let pinnedValues: Set<String> = ["only", "exclude"]
private let snoozedValues: Set<String> = ["only", "exclude", "all"]
/// #508: no "all" — unset already means no filter, unlike `snoozed`.
private let awaitingValues: Set<String> = ["only", "exclude"]

/// Is this a UUID?
///
/// Written as a character walk rather than a regex on purpose. `NSRegularExpression`
/// would do, and the shared TypeScript uses one, but hand-porting a pattern
/// across three languages is where this repository has been bitten before —
/// `\b` means backspace in Kotlin and does not compile in Swift. A shape this
/// simple does not need a pattern.
func isSavedViewUUID(_ value: String) -> Bool {
    let parts = value.split(separator: "-", omittingEmptySubsequences: false)
    let expected = [8, 4, 4, 4, 12]
    guard parts.count == expected.count else { return false }
    for (part, length) in zip(parts, expected) {
        guard part.count == length else { return false }
        for character in part where !character.isHexDigit { return false }
    }
    return true
}

/// Keep only the conversation filters the list endpoint understands.
///
/// Mirrors `sanitizeFilters` in shared, including the part that matters most:
/// an unknown or stale key is DROPPED rather than rejected, so a view written
/// before a filter was renamed still opens instead of failing on a screen the
/// person cannot repair.
func sanitizeConversationFilters(_ raw: [String: JSONValue]) -> [String: JSONValue] {
    var out: [String: JSONValue] = [:]
    for (key, value) in raw {
        var text: String?
        var flag: Bool?
        if case let .string(s) = value { text = s }
        if case let .bool(b) = value { flag = b }

        let keep: Bool
        switch key {
        case "status": keep = text.map { conversationStatuses.contains($0) } ?? false
        case "assigned_user_id", "tag_id": keep = text.map(isSavedViewUUID) ?? false
        case "assigned_to_me", "is_spam", "unread": keep = flag != nil
        case "pinned": keep = text.map { pinnedValues.contains($0) } ?? false
        case "snoozed": keep = text.map { snoozedValues.contains($0) } ?? false
        case "awaiting": keep = text.map { awaitingValues.contains($0) } ?? false
        default: keep = false
        }
        if keep { out[key] = value }
    }
    // The two assignee filters contradict each other and the contradiction is
    // silent: whichever the request builder read last would win, differently on
    // different clients. The deliberate one takes the slot.
    if case .bool(true) = out["assigned_to_me"] ?? .null {
        out["assigned_user_id"] = nil
    } else {
        out["assigned_to_me"] = nil
    }
    return out
}

private func filterString(_ filters: [String: JSONValue], _ key: String) -> String? {
    if case let .string(value) = filters[key] ?? .null { return value }
    return nil
}

private func filterBool(_ filters: [String: JSONValue], _ key: String) -> Bool {
    if case let .bool(value) = filters[key] ?? .null { return value }
    return false
}

/// The `assigned_user_id` a request should carry, given the view and who asks.
///
/// "Mine" is relative on purpose: an owner sharing the crew's morning queue
/// means each person's own work, not the owner's. A stored id would make it one
/// specific human on everybody else's screen.
func resolveAssignee(_ filters: [String: JSONValue], viewerUserId: String) -> String? {
    filterBool(filters, "assigned_to_me")
        ? viewerUserId
        : filterString(filters, "assigned_user_id")
}

/// Which status tab a view selects.
enum SavedViewTab: String, Sendable, Equatable {
    case open, mine, all, closed
}

/// The inbox controller state a view describes.
struct ViewSelection: Sendable, Equatable {
    var tab: SavedViewTab
    var assigneeUserId: String?
    var tagId: String?
    var unreadOnly: Bool
    var spamOnly: Bool
    var snoozedOnly: Bool
    /// #508: threads nobody has replied to yet (the #388 lead clock).
    var awaitingOnly: Bool
}

/// A view's stored filters as the inbox's own controls.
///
/// The tab and the assignee are entangled here exactly as they are on the web:
/// "Mine" is a TAB rather than an assignee chip, so a view holding
/// `assigned_to_me` selects that tab instead of setting a chip nobody can see.
func viewToSelection(_ filters: [String: JSONValue]) -> ViewSelection {
    let clean = sanitizeConversationFilters(filters)
    let assignedToMe = filterBool(clean, "assigned_to_me")
    let status = filterString(clean, "status")
    let tab: SavedViewTab
    if assignedToMe {
        tab = .mine
    } else if status == "open" {
        tab = .open
    } else if status == "closed" {
        tab = .closed
    } else {
        tab = .all
    }
    return ViewSelection(
        tab: tab,
        assigneeUserId: assignedToMe ? nil : filterString(clean, "assigned_user_id"),
        tagId: filterString(clean, "tag_id"),
        unreadOnly: filterBool(clean, "unread"),
        spamOnly: filterBool(clean, "is_spam"),
        snoozedOnly: filterString(clean, "snoozed") == "only",
        awaitingOnly: filterString(clean, "awaiting") == "only"
    )
}

/// The inbox's current controls as a view would store them.
func selectionToView(_ selection: ViewSelection) -> [String: JSONValue] {
    var raw: [String: JSONValue] = [:]
    switch selection.tab {
    case .open: raw["status"] = .string("open")
    case .closed: raw["status"] = .string("closed")
    case .mine: raw["assigned_to_me"] = .bool(true)
    case .all: break
    }
    if let assignee = selection.assigneeUserId { raw["assigned_user_id"] = .string(assignee) }
    if let tag = selection.tagId { raw["tag_id"] = .string(tag) }
    if selection.unreadOnly { raw["unread"] = .bool(true) }
    if selection.spamOnly { raw["is_spam"] = .bool(true) }
    if selection.snoozedOnly { raw["snoozed"] = .string("only") }
    if selection.awaitingOnly { raw["awaiting"] = .string("only") }
    return sanitizeConversationFilters(raw)
}

/// Is this view the arrangement currently on screen?
func viewMatchesSelection(_ filters: [String: JSONValue], _ selection: ViewSelection) -> Bool {
    sanitizeConversationFilters(filters) == selectionToView(selection)
}

/// A name for the view about to be saved, from what is filtered.
///
/// The save sheet is never empty: typing a name is the whole friction between
/// arranging a useful screen and keeping it, and the person already said what
/// the view is by building it. Empty for the unfiltered list, because
/// "Everything" is a name to offer only if somebody deliberately saves it.
func suggestViewName(
    _ selection: ViewSelection,
    assigneeName: String? = nil,
    tagName: String? = nil
) -> String {
    var parts: [String] = []
    switch selection.tab {
    case .open: parts.append("Open")
    case .closed: parts.append("Closed")
    case .mine: parts.append("Mine")
    case .all: break
    }
    if selection.assigneeUserId != nil, let assigneeName, !assigneeName.isEmpty {
        parts.append(assigneeName)
    }
    if selection.tagId != nil, let tagName, !tagName.isEmpty {
        parts.append(tagName)
    }
    if selection.unreadOnly { parts.append("Unread") }
    if selection.spamOnly { parts.append("Spam") }
    if selection.snoozedOnly { parts.append("Snoozed") }
    if selection.awaitingOnly { parts.append("Unanswered") }
    // A middot, not a dash: Law 6 bans em and en dashes in rendered copy and a
    // hyphen reads as part of a word.
    return parts.joined(separator: " · ")
}
