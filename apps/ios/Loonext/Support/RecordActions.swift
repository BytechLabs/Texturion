import Foundation

/// #712: ONE action list per record type.
///
/// A record's actions (label, group, order, whether this viewer may do it) are
/// written once, by a builder per type below, and every surface that offers them
/// renders THAT list: the long-press menu, the row's more-actions menu and the
/// thread's actions sheet. Two menus for one record can therefore never disagree,
/// because there is only one list to disagree with.
///
/// The Swift twin of `apps/web/src/lib/record-actions/types.ts`, the per-record
/// builders beside it, and Android's `RecordActions.kt`. Ids, groups and order
/// match. What a surface cannot offer is `allowed: false`, never a second list.

/// The groups, in the order they are drawn.
enum ActionGroup: Int, CaseIterable, Sendable {
    /// Where the record lives, and what you do to reach the person.
    case primary
    /// What you do to the record's state.
    case state
    /// What reaches you about it.
    case alerts
    /// The photos and files.
    case attachments
    /// Spam, block, delete: last, in the destructive style.
    case danger
}

/// One choice inside an action that needs one more answer (a person, a duration, a day).
struct RecordSubAction: Identifiable, Equatable, Sendable {
    let id: String
    /// A catalogue key; nil when `label` is already the words (a member's name).
    var labelKey: String?
    var label: String?
    /// Muted text at the row's end, e.g. the time a snooze preset resolves to.
    var trailing: String?
}

struct RecordAction: Identifiable, Equatable, Sendable {
    let id: String
    /// A `recordMenu.*` catalogue key, so every surface says the same words.
    let labelKey: String
    let group: ActionGroup
    /// Whether this viewer may do it. A false action is never rendered, and a
    /// record with none allowed opens no menu at all.
    var allowed: Bool = true
    var destructive: Bool = false
    /// Non-nil means a toggle: it names a STATE and shows a trailing mark (#465).
    var checked: Bool?
    var enabled: Bool = true
    /// Plain explanatory text, not something to press (a carrier STOP note).
    var note: Bool = false
    /// Non-empty means choosing it opens these choices.
    var submenu: [RecordSubAction] = []
}

extension Array where Element == RecordAction {
    /// The actions this viewer may take, in group order (stable within a group).
    var visible: [RecordAction] {
        let allowed = filter(\.allowed)
        return ActionGroup.allCases.flatMap { group in
            allowed.filter { $0.group == group }
        }
    }

    /// Just the ids, in render order. The parity tests compare these.
    var visibleIds: [String] { visible.map(\.id) }
}

/// What a role may do to a record, from the capability table the screens already use.
struct RecordViewer: Equatable, Sendable {
    let canWrite: Bool
    let canDelete: Bool

    init(canWrite: Bool, canDelete: Bool) {
        self.canWrite = canWrite
        self.canDelete = canDelete
    }

    init(role: String?) {
        self.init(
            canWrite: MemberRole.has(role, Capability.conversationsNote),
            canDelete: RecordDeletion.canDelete(role: role)
        )
    }
}

// MARK: - Conversation

enum ConversationActionId {
    static let open = "open"
    static let markRead = "mark-read"
    static let markUnread = "mark-unread"
    static let catchUp = "catch-up"
    static let assign = "assign"
    static let reopen = "reopen"
    static let close = "close"
    static let pin = "pin"
    static let newTask = "new-task"
    static let unsnooze = "unsnooze"
    static let snooze = "snooze"
    static let followUp = "follow-up"
    static let unmute = "unmute"
    static let mute = "mute"
    static let follow = "follow"
    static let attachments = "attachments"
    static let spam = "spam"
    static let unblock = "unblock"
    static let block = "block"
    static let delete = "delete"
    static let optIn = "opt-in"
    static let carrierStop = "carrier-stop"
    static let optOut = "opt-out"
}

struct OptOutState: Equatable, Sendable {
    let optedOut: Bool
    let carrierEnforced: Bool
}

/// What this surface can offer at all: an inbox row has no gallery, the thread has no "open".
struct ConversationSurface: Equatable, Sendable {
    let canOpen: Bool
    let hasGallery: Bool
    let hasCatchUp: Bool
    /// Phones only: a task can start from the conversation sheet.
    let hasNewTask: Bool
}

struct ConversationActionsInput: Sendable {
    let unread: Bool
    let closed: Bool
    let pinned: Bool
    let deferred: Bool
    let muted: Bool
    let followed: Bool
    let spam: Bool
    /// Nil where the surface does not know: neither block nor unblock is offered.
    let blocked: Bool?
    /// Nil where the surface does not know the contact's opt-out state.
    let optOut: OptOutState?
    let viewer: RecordViewer
    let hasMembers: Bool
    let surface: ConversationSurface
    var assignChoices: [RecordSubAction] = []
    var snoozeChoices: [RecordSubAction] = []
    var followUpChoices: [RecordSubAction] = []
    var muteChoices: [RecordSubAction] = []
}

/// The mute durations the server takes, in the order the web menu lists them.
let recordMuteChoices: [RecordSubAction] = [
    RecordSubAction(id: "1h", labelKey: "thread.mute1h"),
    RecordSubAction(id: "8h", labelKey: "thread.mute8h"),
    RecordSubAction(id: "1w", labelKey: "thread.mute1w"),
    RecordSubAction(id: "forever", labelKey: "thread.muteForever"),
]

func conversationActions(_ input: ConversationActionsInput) -> [RecordAction] {
    let viewer = input.viewer
    let surface = input.surface
    var list: [RecordAction] = []

    list.append(RecordAction(
        id: ConversationActionId.open, labelKey: "recordMenu.open",
        group: .primary, allowed: surface.canOpen
    ))

    list.append(
        input.unread
            ? RecordAction(
                id: ConversationActionId.markRead, labelKey: "recordMenu.markRead", group: .state
            )
            : RecordAction(
                id: ConversationActionId.markUnread, labelKey: "recordMenu.markUnread", group: .state
            )
    )
    list.append(RecordAction(
        id: ConversationActionId.catchUp, labelKey: "recordMenu.catchUp",
        group: .state, allowed: surface.hasCatchUp
    ))
    list.append(RecordAction(
        id: ConversationActionId.assign, labelKey: "recordMenu.assign",
        group: .state, allowed: viewer.canWrite && input.hasMembers,
        submenu: input.assignChoices
    ))
    list.append(
        input.closed
            ? RecordAction(
                id: ConversationActionId.reopen, labelKey: "recordMenu.reopen",
                group: .state, allowed: viewer.canWrite
            )
            : RecordAction(
                id: ConversationActionId.close, labelKey: "recordMenu.close",
                group: .state, allowed: viewer.canWrite
            )
    )
    list.append(RecordAction(
        id: ConversationActionId.pin, labelKey: "recordMenu.pin",
        group: .state, allowed: viewer.canWrite, checked: input.pinned
    ))
    list.append(RecordAction(
        id: ConversationActionId.newTask, labelKey: "recordMenu.newTask",
        group: .state, allowed: surface.hasNewTask
    ))
    list.append(
        input.deferred
            ? RecordAction(
                id: ConversationActionId.unsnooze, labelKey: "recordMenu.unsnooze", group: .state
            )
            : RecordAction(
                id: ConversationActionId.snooze, labelKey: "recordMenu.snooze",
                group: .state, submenu: input.snoozeChoices
            )
    )
    list.append(RecordAction(
        id: ConversationActionId.followUp, labelKey: "recordMenu.followUp",
        group: .state, allowed: !input.deferred, submenu: input.followUpChoices
    ))

    list.append(
        input.muted
            ? RecordAction(
                id: ConversationActionId.unmute, labelKey: "recordMenu.unmute", group: .alerts
            )
            : RecordAction(
                id: ConversationActionId.mute, labelKey: "recordMenu.mute",
                group: .alerts, submenu: input.muteChoices
            )
    )
    list.append(RecordAction(
        id: ConversationActionId.follow, labelKey: "recordMenu.follow",
        group: .alerts, checked: input.followed
    ))

    list.append(RecordAction(
        id: ConversationActionId.attachments, labelKey: "recordMenu.attachments",
        group: .attachments, allowed: surface.hasGallery
    ))

    list.append(RecordAction(
        id: ConversationActionId.spam, labelKey: "recordMenu.spam",
        group: .danger, allowed: viewer.canWrite, checked: input.spam
    ))
    list.append(
        input.blocked == true
            ? RecordAction(
                id: ConversationActionId.unblock, labelKey: "recordMenu.unblock",
                group: .danger, allowed: viewer.canWrite
            )
            : RecordAction(
                id: ConversationActionId.block, labelKey: "recordMenu.block",
                group: .danger, allowed: viewer.canWrite && input.blocked != nil
            )
    )
    list.append(RecordAction(
        id: ConversationActionId.delete, labelKey: "recordMenu.deleteConversation",
        group: .danger, allowed: viewer.canDelete, destructive: true
    ))
    let optedOut = input.optOut?.optedOut ?? false
    let carrier = input.optOut?.carrierEnforced ?? false
    list.append(RecordAction(
        id: ConversationActionId.optIn, labelKey: "recordMenu.optIn",
        group: .danger, allowed: input.optOut != nil && optedOut && !carrier
    ))
    list.append(RecordAction(
        id: ConversationActionId.carrierStop, labelKey: "recordMenu.carrierStop",
        group: .danger, allowed: input.optOut != nil && optedOut && carrier, note: true
    ))
    list.append(RecordAction(
        id: ConversationActionId.optOut, labelKey: "recordMenu.optOut",
        group: .danger, allowed: input.optOut != nil && !optedOut
    ))
    return list
}

// MARK: - Message

enum MessageActionId {
    static let copyText = "copy-text"
    static let retry = "retry"
    static let done = "done"
    static let makeTask = "make-task"
    static let pin = "pin"
    static let delete = "delete"
}

func messageActions(_ message: Message, viewer: RecordViewer) -> [RecordAction] {
    let note = message.direction == MessageDirection.note
    return [
        RecordAction(
            id: MessageActionId.copyText, labelKey: "recordMenu.copyText",
            group: .primary, allowed: !message.body.isBlank
        ),
        RecordAction(
            id: MessageActionId.retry, labelKey: "recordMenu.retry",
            group: .primary, allowed: message.retryable
        ),
        // Phones only: the web bubble keeps "done" as its own check at the edge.
        RecordAction(
            id: MessageActionId.done, labelKey: "recordMenu.done",
            group: .state, checked: message.done_at != nil
        ),
        RecordAction(
            id: MessageActionId.makeTask, labelKey: "recordMenu.makeTask",
            group: .state,
            // A promoted message cannot be promoted twice, and a note is not a customer's ask.
            allowed: !message.has_task && message.promoted_task == nil && !note
        ),
        RecordAction(
            id: MessageActionId.pin, labelKey: "recordMenu.pin",
            group: .state, checked: message.pinned_at != nil
        ),
        RecordAction(
            id: MessageActionId.delete,
            labelKey: note ? "recordMenu.deleteNote" : "recordMenu.deleteMessage",
            group: .danger, allowed: viewer.canDelete, destructive: true
        ),
    ]
}

// MARK: - Call

enum CallActionId {
    static let callBack = "call-back"
    static let text = "text"
    static let copyNumber = "copy-number"
    static let deleteVoicemail = "delete-voicemail"
    static let deleteCall = "delete-call"
}

struct CallActionsInput: Sendable {
    let hasConversation: Bool
    let hasContact: Bool
    let callerE164: String?
    let hasVoicemail: Bool
    let canDelete: Bool
}

func callActions(_ input: CallActionsInput) -> [RecordAction] {
    let hasNumber = !(input.callerE164?.isBlank ?? true)
    return [
        RecordAction(
            id: CallActionId.callBack, labelKey: "recordMenu.callBack",
            group: .primary, allowed: input.hasConversation || input.hasContact || hasNumber
        ),
        RecordAction(
            id: CallActionId.text, labelKey: "recordMenu.text",
            group: .primary, allowed: input.hasConversation
        ),
        RecordAction(
            id: CallActionId.copyNumber, labelKey: "recordMenu.copyNumber",
            group: .primary, allowed: hasNumber
        ),
        RecordAction(
            id: CallActionId.deleteVoicemail, labelKey: "recordMenu.deleteVoicemail",
            group: .danger, allowed: input.canDelete && input.hasVoicemail, destructive: true
        ),
        RecordAction(
            id: CallActionId.deleteCall, labelKey: "recordMenu.deleteCall",
            group: .danger, allowed: input.canDelete, destructive: true
        ),
    ]
}

// MARK: - Task

enum TaskActionId {
    static let open = "open"
    static let copyLink = "copy-link"
    static let done = "done"
    static let due = "due"
    static let delete = "delete"
}

/// The three relative moves web offers: a day earlier, a day later, a week later.
let recordTaskDueMoves: [RecordSubAction] = [
    RecordSubAction(id: "-1", labelKey: "recordMenu.dueDayEarlier"),
    RecordSubAction(id: "1", labelKey: "recordMenu.dueDayLater"),
    RecordSubAction(id: "7", labelKey: "recordMenu.dueWeekLater"),
]

struct TaskActionsInput: Sendable {
    let done: Bool
    /// Access to the conversation the task came from (#107). Completion is derived
    /// from the source message, so without it the server refuses, and offering the
    /// item would be a dead item.
    let hasAccess: Bool
    let canDelete: Bool
    /// False on the task's own screen, where it is already open.
    let canOpen: Bool
    let canCopyLink: Bool
}

func taskActions(_ input: TaskActionsInput) -> [RecordAction] {
    [
        RecordAction(
            id: TaskActionId.open, labelKey: "recordMenu.open",
            group: .primary, allowed: input.canOpen
        ),
        RecordAction(
            id: TaskActionId.copyLink, labelKey: "recordMenu.copyLink",
            group: .primary, allowed: input.canCopyLink
        ),
        RecordAction(
            id: TaskActionId.done, labelKey: "recordMenu.done",
            group: .state, allowed: input.hasAccess, checked: input.done
        ),
        RecordAction(
            id: TaskActionId.due, labelKey: "recordMenu.moveDue",
            group: .state, allowed: input.hasAccess, submenu: recordTaskDueMoves
        ),
        RecordAction(
            id: TaskActionId.delete, labelKey: "recordMenu.deleteTask",
            group: .danger, allowed: input.canDelete, destructive: true
        ),
    ]
}

// MARK: - Contact

enum ContactActionId {
    static let open = "open"
    static let text = "text"
    static let call = "call"
    static let copyNumber = "copy-number"
    static let unblock = "unblock"
    static let block = "block"
    static let optIn = "opt-in"
    static let carrierStop = "carrier-stop"
    static let optOut = "opt-out"
    static let delete = "delete"
}

struct ContactActionsInput: Sendable {
    let canOpen: Bool
    let optedOut: Bool
    let carrierEnforced: Bool
    /// Nil where the surface does not know: neither block nor unblock is offered.
    let blocked: Bool?
    let canBlock: Bool
    let canDelete: Bool
}

func contactActions(_ input: ContactActionsInput) -> [RecordAction] {
    [
        RecordAction(
            id: ContactActionId.open, labelKey: "recordMenu.open",
            group: .primary, allowed: input.canOpen
        ),
        RecordAction(id: ContactActionId.text, labelKey: "recordMenu.text", group: .primary),
        RecordAction(id: ContactActionId.call, labelKey: "recordMenu.call", group: .primary),
        RecordAction(
            id: ContactActionId.copyNumber, labelKey: "recordMenu.copyNumber", group: .primary
        ),
        input.blocked == true
            ? RecordAction(
                id: ContactActionId.unblock, labelKey: "recordMenu.unblock",
                group: .danger, allowed: input.canBlock
            )
            : RecordAction(
                id: ContactActionId.block, labelKey: "recordMenu.block",
                group: .danger, allowed: input.canBlock && input.blocked != nil
            ),
        RecordAction(
            id: ContactActionId.optIn, labelKey: "recordMenu.optIn",
            group: .danger, allowed: input.optedOut && !input.carrierEnforced
        ),
        RecordAction(
            id: ContactActionId.carrierStop, labelKey: "recordMenu.carrierStop",
            group: .danger, allowed: input.optedOut && input.carrierEnforced, note: true
        ),
        RecordAction(
            id: ContactActionId.optOut, labelKey: "recordMenu.optOut",
            group: .danger, allowed: !input.optedOut
        ),
        RecordAction(
            id: ContactActionId.delete, labelKey: "recordMenu.deleteContact",
            group: .danger, allowed: input.canDelete, destructive: true
        ),
    ]
}

// MARK: - Scheduled text

enum ScheduledActionId {
    static let open = "open"
    static let cancel = "cancel"
}

func scheduledActions(cancelling: Bool = false) -> [RecordAction] {
    [
        RecordAction(
            id: ScheduledActionId.open, labelKey: "recordMenu.openConversation", group: .primary
        ),
        RecordAction(
            id: ScheduledActionId.cancel, labelKey: "recordMenu.cancelScheduled",
            group: .danger, destructive: true, enabled: !cancelling
        ),
    ]
}
