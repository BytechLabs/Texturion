import Foundation

/// #740: what the contact screen shows at a time. A phone has room for one thing, so the
/// screen is a header and actions, then a segmented control switching Details, Activity
/// and Files. Conversations, Calls and Tasks are one tap inside Activity, beside the
/// timeline. Ported from the Android `ContactDetailTabs.kt` and the web `contact-tabs.ts`.
enum ContactTab: CaseIterable {
    case details, activity, files

    var labelKey: String {
        switch self {
        case .details: "contactsTasks.tabDetails"
        case .activity: "contactsTasks.tabActivity"
        case .files: "contactsTasks.tabFiles"
        }
    }
}

/// The lists inside the Activity tab.
enum ContactActivityPane: CaseIterable {
    case timeline, conversations, calls, tasks

    var labelKey: String {
        switch self {
        case .timeline: "contactsTasks.tabTimeline"
        case .conversations: "contactsTasks.tabConversations"
        case .calls: "contactsTasks.tabCalls"
        case .tasks: "contactsTasks.tabTasks"
        }
    }
}

/// Every block the screen can draw under the controls.
enum ContactBlock: CaseIterable {
    case details, timeline, conversations, calls, tasks, files
}

/// The one block a tab (and, under Activity, a pane) puts on screen.
func contactBlockOnScreen(tab: ContactTab, pane: ContactActivityPane) -> ContactBlock {
    switch tab {
    case .details: return .details
    case .files: return .files
    case .activity:
        switch pane {
        case .timeline: return .timeline
        case .conversations: return .conversations
        case .calls: return .calls
        case .tasks: return .tasks
        }
    }
}

/// The detail fields that can be empty, and so sit behind "Add details".
enum ContactDetailField: CaseIterable {
    case business, address, email, notes
}

/// The fields nobody has filled in. The name and the numbers always show, since they are
/// what the record is.
func emptyContactDetailFields(
    business: String?,
    address: String?,
    hasAddresses: Bool,
    email: String?,
    notes: String?
) -> [ContactDetailField] {
    func blank(_ value: String?) -> Bool {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    var empty: [ContactDetailField] = []
    if blank(business) { empty.append(.business) }
    if blank(address) && !hasAddresses { empty.append(.address) }
    if blank(email) { empty.append(.email) }
    if blank(notes) { empty.append(.notes) }
    return empty
}

func emptyContactDetailFields(_ contact: Contact) -> [ContactDetailField] {
    emptyContactDetailFields(
        business: contact.business_name,
        address: contact.address,
        hasAddresses: !(contact.addresses ?? []).isEmpty,
        email: contact.email,
        notes: contact.notes
    )
}

/// The fields still folded away. A field is decided empty when the screen opens, so
/// clearing the one you are typing in does not make it vanish; one that somebody else
/// fills in meanwhile appears; "Add details" opens them all.
func hiddenContactDetailFields(
    initiallyEmpty: [ContactDetailField],
    emptyNow: [ContactDetailField],
    adding: Bool
) -> Set<ContactDetailField> {
    if adding { return [] }
    return Set(initiallyEmpty.filter { emptyNow.contains($0) })
}

/// Rows a list shows before "Show all".
let contactListCap = 5

/// The first `contactListCap` rows, or all of them once "Show all" is tapped.
func cappedContactRows<T>(_ rows: [T], showAll: Bool) -> [T] {
    showAll ? rows : Array(rows.prefix(contactListCap))
}
