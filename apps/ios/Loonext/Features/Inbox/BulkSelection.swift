import Foundation

/// #275 — what "selected" means. The Swift twin of
/// `apps/web/src/lib/inbox/bulk-selection.ts` and
/// `features/inbox/BulkSelection.kt`, kept pure so all three clients can be held
/// to the same assertions.
///
/// THE TRAP THIS EXISTS TO AVOID. The obvious implementation holds a set of ids
/// and, when the user asks for everything, fills it with the ids it happens to
/// have paged in. The inbox is cursor-paged, so that set is 25 rows out of 340 —
/// and the bar then says "select all" while acting on the page. #275 names it:
/// *selecting only the loaded page while implying more is a trap.*
///
/// So there are two DIFFERENT kinds of selection and they are not interchangeable:
///
///   `.ids`    the user pointed at rows. We know exactly which, and how many.
///   `.filter` the user asked for everything matching what they are looking at.
///             We do NOT know how many, because the server has not counted them
///             yet, and this file refuses to guess. The count comes back as
///             `matched`.
enum BulkSelection: Equatable {
    case ids(Set<String>)
    case filter

    static let empty = BulkSelection.ids([])

    var isEmpty: Bool {
        if case let .ids(ids) = self { return ids.isEmpty }
        return false
    }

    /// True when this row should render as selected.
    func isRowSelected(_ conversationId: String) -> Bool {
        switch self {
        // In filter mode every row is included by definition — including rows
        // that page in later.
        case .filter: return true
        case let .ids(ids): return ids.contains(conversationId)
        }
    }

    /// Toggle one row.
    ///
    /// Toggling while in filter mode DROPS OUT of filter mode, keeping the loaded
    /// rows minus the one just unticked. Anything else would be a lie: the user has
    /// said "not that one" about a set we cannot enumerate, so it cannot be honoured
    /// as an exclusion — and ignoring the untick would leave a visibly unselected
    /// row inside the selection.
    func toggling(_ conversationId: String, loadedIds: [String]) -> BulkSelection {
        switch self {
        case .filter:
            var next = Set(loadedIds)
            next.remove(conversationId)
            return .ids(next)
        case let .ids(ids):
            var next = ids
            if next.contains(conversationId) { next.remove(conversationId) }
            else { next.insert(conversationId) }
            return .ids(next)
        }
    }

    /// Whether to offer the escalation to "everything matching".
    ///
    /// Only once every loaded row is selected AND there is more to fetch. Offering
    /// it when everything is already loaded would be an escalation to the same set,
    /// phrased as if it were bigger.
    func canEscalate(loadedIds: [String], hasMore: Bool) -> Bool {
        guard case let .ids(ids) = self else { return false }
        guard !loadedIds.isEmpty, hasMore else { return false }
        return loadedIds.allSatisfy { ids.contains($0) }
    }

    /// The bar's label, in the reader's language. NEVER invents a total.
    ///
    /// Filter mode deliberately carries no number: the server counts the set when it
    /// runs the action, and until then the honest phrasing is the one that does not
    /// commit to a figure.
    ///
    /// #228: a METHOD beside the property below rather than a locale parameter on
    /// `label` itself — Swift will not let a property and a method share a name,
    /// and `BulkSelectionTests` calls the property.
    func labelText(_ locale: String?) -> String {
        switch self {
        case .filter:
            return AppStrings.translate(locale, "common.bulkSelectedAllMatching")
        case let .ids(ids):
            return AppStrings.translate(
                locale,
                "common.bulkSelectedCount",
                ["count": String(ids.count)]
            )
        }
    }

    /// The English label, for callers with no locale to hand (the tests).
    var label: String { labelText(nil) }

    /// The ids to send, or nil when the server should resolve the filter itself.
    var idsOrNil: [String]? {
        switch self {
        case .filter: return nil
        case let .ids(ids): return Array(ids)
        }
    }
}

/// Select every loaded row. Claims nothing about rows not yet fetched.
func selectLoaded(_ loadedIds: [String]) -> BulkSelection {
    .ids(Set(loadedIds))
}

/// The sentence shown after an action ran, from what the server actually did.
///
/// Built from the RESPONSE, never the selection: those two numbers differ whenever
/// a row was on a denied number, already gone, or past the cap, and that difference
/// is exactly what #275 says must not be swallowed.
/// #228: the glue between the counts is KEYED, and the verb and the noun stay the
/// caller's — which action ran, and what it ran on, are facts this function is told
/// rather than facts it knows. Both are interpolated rather than concatenated so a
/// translator can put them where the sentence needs them, which is web's
/// `lib/inbox/bulk-selection.ts` arrangement exactly.
///
/// `locale` is LAST and defaulted, so `BulkSelectionTests` — which pins the English
/// word for word against the other two clients — keeps compiling and keeps reading
/// the same sentence.
func bulkResultMessage(
    verb: String,
    applied: Int,
    failed: Int,
    matched: Int,
    capped: Bool,
    /// #478: what was acted on. Defaulted so every existing call is unchanged.
    nounOne: String? = nil,
    nounMany: String? = nil,
    locale: String? = nil
) -> String {
    let one = nounOne ?? AppStrings.translate(locale, "inbox.bulkNounOne")
    let many = nounMany ?? AppStrings.translate(locale, "inbox.bulkNounMany")
    let thing = applied == 1 ? one : many
    var message = AppStrings.translate(
        locale,
        "inbox.bulkResultApplied",
        ["verb": verb, "count": String(applied), "thing": thing]
    )
    // The cap is where "it worked" and "it finished" are different answers, so the
    // remainder is named rather than left to be discovered.
    if capped, matched > applied {
        message += AppStrings.translate(
            locale,
            "inbox.bulkResultCapped",
            ["count": String(matched - applied)]
        )
    }
    if failed > 0 {
        // One and many are separate keys rather than one sentence with a word
        // swapped in: the agreement moves more than a word in French.
        message += failed == 1
            ? AppStrings.translate(
                locale, "inbox.bulkResultFailedOne", ["count": String(failed)]
            )
            : AppStrings.translate(
                locale, "inbox.bulkResultFailedMany", ["count": String(failed)]
            )
    }
    return message
}

/// One group of the undo plan: the rows that shared a prior value, and the call
/// that puts them back.
struct BulkUndoGroup: Equatable {
    let action: String
    var ids: [String]
    var targetStatus: String?
    var targetSpam: Bool?
    var targetUserId: String?
    var unassign: Bool

    init(
        action: String,
        ids: [String] = [],
        targetStatus: String? = nil,
        targetSpam: Bool? = nil,
        targetUserId: String? = nil,
        unassign: Bool = false
    ) {
        self.action = action
        self.ids = ids
        self.targetStatus = targetStatus
        self.targetSpam = targetSpam
        self.targetUserId = targetUserId
        self.unassign = unassign
    }

    /// Stable identity for grouping rows that share a prior value.
    var groupKey: String {
        // Bool has no String(_:) initializer, so the flag is spelled out rather
        // than mapped through String.init — which compiles on Android's twin and
        // would not here.
        let spam = targetSpam.map { $0 ? "spam" : "not-spam" } ?? "-"
        return "\(action)|\(targetStatus ?? "-")|\(spam)|\(targetUserId ?? "-")|\(unassign)"
    }
}

/// Turn a bulk result into the calls that reverse it, GROUPED by prior value.
///
/// Undoing "close 300 threads that were a mix of new, open and waiting" is three
/// calls rather than three hundred, and every row lands back on the status it
/// ACTUALLY had — not a uniform "open", which would quietly lose the fact that
/// nobody had replied to some of them yet.
///
/// Returns nil when there is nothing to reverse: `mark_read` records no prior
/// state, because "unread" is the absence of a read receipt.
///
/// `previous` is read defensively. It is server JSON, and a client that trapped on
/// an unexpected shape would take the whole inbox down over an undo button.
func bulkUndoPlan(_ result: BulkConversationsResult) -> [BulkUndoGroup]? {
    guard !result.applied.isEmpty else { return nil }
    var order: [String] = []
    var specs: [String: BulkUndoGroup] = [:]
    var ids: [String: [String]] = [:]

    for row in result.applied {
        let previous = row.previous
        var spec: BulkUndoGroup?

        if let status = previous["status"] {
            // A null where a string belongs is skipped, not forced.
            if let value = status.stringValue {
                spec = BulkUndoGroup(action: "set_status", targetStatus: value)
            }
        } else if previous.keys.contains("assigned_user_id") {
            let userId = previous["assigned_user_id"]?.stringValue
            spec = BulkUndoGroup(
                action: "assign",
                targetUserId: userId,
                // A nil prior assignee means the row was unassigned, and the server
                // needs that said explicitly rather than inferred from an absent
                // field.
                unassign: userId == nil
            )
        } else if let spam = previous["is_spam"] {
            if let value = spam.boolValue {
                spec = BulkUndoGroup(action: "set_spam", targetSpam: value)
            }
        } else if let tagged = previous["had_tag"] {
            // Undoing an add removes only the rows that did NOT already carry the
            // tag; undoing a remove restores only the ones that DID. Otherwise the
            // undo strips a tag somebody applied by hand months ago — a bulk action
            // destroying data it never created.
            let hadTag = tagged.boolValue ?? false
            if result.action == "add_tag", hadTag {
                spec = nil
            } else if result.action == "remove_tag", !hadTag {
                spec = nil
            } else {
                spec = BulkUndoGroup(
                    action: result.action == "add_tag" ? "remove_tag" : "add_tag"
                )
            }
        }

        guard let spec else { continue }
        let key = spec.groupKey
        if specs[key] == nil {
            specs[key] = spec
            order.append(key)
        }
        ids[key, default: []].append(row.id)
    }

    guard !order.isEmpty else { return nil }
    return order.compactMap { key in
        guard var group = specs[key] else { return nil }
        group.ids = ids[key] ?? []
        return group
    }
}
