import Foundation

/// #713: how a tag stands across a selection. Hand port of
/// `packages/shared/src/tag-selection.ts`, checked against its vectors.
///
/// `absent` is the TypeScript's "none"; a case named `none` would read as
/// `Optional.none` wherever the value is optional.
enum TagSelectionState: String, Sendable {
    case all
    case some
    case absent = "none"
    case unknown
}

/// `itemTagIds` is the tag ids on each selected item, or nil when the rows are
/// not loaded (a filter selection). Nil or empty is `unknown`, never `absent`.
func tagSelectionState(itemTagIds: [[String]]?, tagId: String) -> TagSelectionState {
    guard let itemTagIds, !itemTagIds.isEmpty else { return .unknown }
    let having = itemTagIds.filter { $0.contains(tagId) }.count
    if having == 0 { return .absent }
    if having == itemTagIds.count { return .all }
    return .some
}

/// Choosing a tag takes it off only when every selected item already has it.
func tagToggleAction(_ state: TagSelectionState) -> String {
    state == .all ? "remove" : "add"
}
