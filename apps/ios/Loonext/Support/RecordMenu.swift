import SwiftUI

/// #712: the one renderer for a record's action list, as the content of a
/// `.contextMenu { }` or a `Menu { }`.
///
/// It draws exactly what `visible` returns, in that order, with a section break
/// where the group changes and the destructive group last in the destructive
/// style. A record with nothing allowed draws nothing at all, so
/// `.recordContextMenu` can be applied unconditionally and no empty menu opens.
///
/// `onSelect` gets the action id and, for an action with choices, the chosen
/// sub-action id. The caller dispatches on the ids in `RecordActions.swift` and
/// plays the haptic its action deserves: a done or a send commits, a pin is a tap.
///
/// `exactTime` is the record's exact time with its zone (#720). A row that opens
/// this menu on long-press cannot also pop the time's own popover from the same
/// press, so the time is the menu's first line instead.
struct RecordMenuContent: View {
    let actions: [RecordAction]
    var exactTime: String?
    let onSelect: @MainActor (_ actionId: String, _ subId: String?) -> Void

    @Environment(\.appLocale) private var appLocale

    private var groups: [[RecordAction]] {
        let shown = actions.visible
        return ActionGroup.allCases
            .map { group in shown.filter { $0.group == group } }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        if let exactTime, !exactTime.isEmpty, !groups.isEmpty {
            Section {
                Label(
                    AppStrings.translate(appLocale, "recordMenu.exactTime", ["time": exactTime]),
                    systemImage: "clock"
                )
            }
        }
        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
            Section {
                ForEach(group) { action in
                    row(action)
                }
            }
        }
    }

    private func title(_ action: RecordAction) -> String {
        AppStrings.translate(appLocale, action.labelKey)
    }

    private func title(_ choice: RecordSubAction) -> String {
        let words = choice.label
            ?? choice.labelKey.map { AppStrings.translate(appLocale, $0) }
            ?? choice.id
        guard let trailing = choice.trailing else { return words }
        return "\(words) · \(trailing)"
    }

    @ViewBuilder
    private func row(_ action: RecordAction) -> some View {
        if action.note {
            // Says something rather than doing something: not a control.
            Text(title(action))
        } else if !action.submenu.isEmpty {
            Menu {
                ForEach(action.submenu) { choice in
                    Button(title(choice)) {
                        onSelect(action.id, choice.id)
                    }
                }
            } label: {
                Label(title(action), systemImage: recordActionSymbol(action.id))
            }
            .disabled(!action.enabled)
        } else if let checked = action.checked {
            // #465: a state is a Toggle, which draws its own mark in both positions.
            Toggle(
                isOn: Binding(
                    get: { checked },
                    set: { _ in onSelect(action.id, nil) }
                )
            ) {
                Label(title(action), systemImage: recordActionSymbol(action.id))
            }
            .disabled(!action.enabled)
        } else {
            Button(role: action.destructive ? .destructive : nil) {
                onSelect(action.id, nil)
            } label: {
                Label(title(action), systemImage: recordActionSymbol(action.id))
            }
            .disabled(!action.enabled)
        }
    }
}

/// The SF Symbol each action id wears. One place, so an action looks the same on
/// every record that offers it.
func recordActionSymbol(_ id: String) -> String {
    switch id {
    case "open": return "arrow.up.right.square"
    case "mark-read": return "envelope.open"
    case "mark-unread": return "envelope.badge"
    case "catch-up": return "sparkles"
    case "assign": return "person.badge.plus"
    case "close": return "checkmark"
    case "reopen": return "arrow.uturn.backward"
    case "pin": return "pin"
    case "new-task", "make-task": return "checklist"
    case "snooze": return "moon.zzz"
    case "unsnooze": return "alarm.slash"
    case "follow-up": return "bell.and.waves.left.and.right"
    case "mute": return "bell.slash"
    case "unmute": return "bell"
    case "follow": return "bell.badge"
    case "attachments": return "photo.on.rectangle"
    case "spam": return "exclamationmark.octagon"
    case "block": return "hand.raised"
    case "unblock", "opt-in": return "arrow.uturn.backward"
    case "opt-out": return "nosign"
    case "copy-text", "copy-number": return "doc.on.doc"
    case "copy-link": return "link"
    case "retry": return "arrow.clockwise"
    case "done": return "checkmark.circle"
    case "due": return "calendar"
    case "text": return "text.bubble"
    case "call", "call-back": return "phone"
    case "cancel": return "xmark"
    case "delete", "delete-call", "delete-voicemail": return "trash"
    default: return "ellipsis"
    }
}

extension View {
    /// #712: a long-press / right-click menu drawn from the record's action list.
    /// Nothing allowed means no menu at all.
    @ViewBuilder
    func recordContextMenu(
        _ actions: [RecordAction],
        exactTime: String? = nil,
        onSelect: @escaping @MainActor (_ actionId: String, _ subId: String?) -> Void
    ) -> some View {
        if actions.visible.isEmpty {
            self
        } else {
            environment(\.recordMenuOwnsLongPress, true)
                .contextMenu {
                    RecordMenuContent(actions: actions, exactTime: exactTime, onSelect: onSelect)
                }
        }
    }
}
