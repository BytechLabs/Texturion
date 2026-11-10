import SwiftUI
import UIKit

/// The link a task opens at on the web: the tasks board with the drawer on that task.
func taskLink(origin: URL, taskId: String) -> String {
    let encoded = taskId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? taskId
    return "\(origin.absoluteString)/tasks?task=\(encoded)"
}

/// The new due instant for a relative move, keeping the time of day: the move changes
/// the date and leaves the appointment time alone. A task with no due date moves from
/// `now`.
func movedDueAt(
    _ dueAt: String?,
    days: Int,
    now: Date = Date(),
    calendar: Calendar = .current,
    timeZone: TimeZone = .current
) -> String {
    let from = parseWireTimestamp(dueAt) ?? now
    let next = calendar.date(byAdding: .day, value: days, to: from) ?? from
    return encodeDueAt(next, timeZone: timeZone)
}

/// #712: a task's action menu, for every place a task is drawn as a row, a card or a
/// calendar entry. The task list provides it in the environment; a view that finds none
/// simply has no long-press menu.
///
/// It is a host rather than a pile of parameters because the list, the board and the
/// calendar are each a screen deep and would otherwise carry the same callbacks only to
/// hand them to one menu.
struct TaskMenuHost {
    let actions: (TaskItem) -> [RecordAction]
    let perform: @MainActor (_ task: TaskItem, _ actionId: String, _ subId: String?) -> Void
}

private struct TaskMenuHostKey: EnvironmentKey {
    static let defaultValue: TaskMenuHost? = nil
}

extension EnvironmentValues {
    var taskMenuHost: TaskMenuHost? {
        get { self[TaskMenuHostKey.self] }
        set { self[TaskMenuHostKey.self] = newValue }
    }
}

private struct TaskContextMenuModifier: ViewModifier {
    let task: TaskItem
    @Environment(\.taskMenuHost) private var host

    func body(content: Content) -> some View {
        if let host {
            content.recordContextMenu(host.actions(task)) { actionId, subId in
                host.perform(task, actionId, subId)
            }
        } else {
            content
        }
    }
}

extension View {
    /// #712: long-press / right-click opens the task's one action menu.
    func taskContextMenu(_ task: TaskItem) -> some View {
        modifier(TaskContextMenuModifier(task: task))
    }
}

/// The task menu's writes and its delete confirmation, owned once so every view that
/// draws a task runs the same ones.
///
/// Delete asks first with a plain confirmation, because a row does not carry the notes
/// and files the detail screen weighs before it asks. A repeating job deletes only the
/// occurrence that was pointed at, the same as the web row menu.
@MainActor
@Observable
final class TaskMenuController {
    /// The task awaiting a delete confirmation.
    var confirmingDelete: TaskItem?

    private let api: TasksApi
    private let companyId: String
    private let canDelete: Bool
    private let onOpen: @MainActor (String) -> Void
    private let onToggleDone: @MainActor (TaskItem, Bool) -> Void
    private let onChanged: @MainActor () -> Void
    private let onError: @MainActor (String) -> Void

    init(
        api: TasksApi,
        companyId: String,
        canDelete: Bool,
        onOpen: @escaping @MainActor (String) -> Void,
        onToggleDone: @escaping @MainActor (TaskItem, Bool) -> Void,
        onChanged: @escaping @MainActor () -> Void,
        onError: @escaping @MainActor (String) -> Void
    ) {
        self.api = api
        self.companyId = companyId
        self.canDelete = canDelete
        self.onOpen = onOpen
        self.onToggleDone = onToggleDone
        self.onChanged = onChanged
        self.onError = onError
    }

    /// The task's action list. A list row does not carry the viewer's level, so access to
    /// the source conversation is assumed; the server refuses what is not theirs.
    func actions(for task: TaskItem) -> [RecordAction] {
        taskActions(
            TaskActionsInput(
                done: task.done,
                hasAccess: true,
                canDelete: canDelete,
                canOpen: true,
                canCopyLink: true
            )
        )
    }

    func perform(_ task: TaskItem, actionId: String, subId: String?) {
        switch actionId {
        case TaskActionId.open:
            onOpen(task.id)
        case TaskActionId.copyLink:
            Haptics.tap()
            UIPasteboard.general.string = taskLink(origin: AppConfig.appOrigin, taskId: task.id)
        case TaskActionId.done:
            onToggleDone(task, !task.done)
        case TaskActionId.due:
            guard let days = subId.flatMap({ Int($0) }) else { return }
            Haptics.tap()
            let next = movedDueAt(task.due_at, days: days)
            let scope = taskNeedsScope(task.repeatRule) ? "this" : nil
            Task {
                do {
                    _ = try await api.setDue(
                        companyId: companyId,
                        taskId: task.id,
                        dueAt: next,
                        scope: scope
                    )
                    onChanged()
                } catch {
                    onError(error.userMessage)
                }
            }
        case TaskActionId.delete:
            confirmingDelete = task
        default:
            break
        }
    }

    func confirmDelete(_ task: TaskItem) {
        confirmingDelete = nil
        Haptics.reject()
        let scope = taskNeedsScope(task.repeatRule) ? "this" : nil
        Task {
            do {
                try await api.delete(companyId: companyId, taskId: task.id, scope: scope)
                onChanged()
            } catch {
                onError(error.userMessage)
            }
        }
    }
}

extension View {
    /// The delete confirmation for `TaskMenuController`, mounted once outside any menu: a
    /// dialog mounted inside menu content unmounts the moment the menu closes.
    func taskMenuDeleteDialog(_ controller: TaskMenuController) -> some View {
        modifier(TaskMenuDeleteDialog(controller: controller))
    }
}

private struct TaskMenuDeleteDialog: ViewModifier {
    @Bindable var controller: TaskMenuController
    @Environment(\.appLocale) private var appLocale

    func body(content: Content) -> some View {
        content.alert(
            AppStrings.translate(appLocale, "contactsTasks.deleteTaskTitle"),
            isPresented: Binding(
                get: { controller.confirmingDelete != nil },
                set: { if !$0 { controller.confirmingDelete = nil } }
            ),
            presenting: controller.confirmingDelete
        ) { task in
            Button(AppStrings.translate(appLocale, "contactsTasks.deleteTask"), role: .destructive) {
                controller.confirmDelete(task)
            }
            Button(AppStrings.translate(appLocale, "common.cancel"), role: .cancel) {}
        } message: { _ in
            Text(AppStrings.translate(appLocale, "contactsTasks.deleteTaskBody"))
        }
    }
}

/// Puts the task menu in the environment and mounts its delete confirmation, once the
/// controller exists.
struct TaskMenuInstaller: ViewModifier {
    let controller: TaskMenuController?

    func body(content: Content) -> some View {
        if let controller {
            content
                .environment(
                    \.taskMenuHost,
                    TaskMenuHost(
                        actions: { controller.actions(for: $0) },
                        perform: { task, actionId, subId in
                            controller.perform(task, actionId: actionId, subId: subId)
                        }
                    )
                )
                .taskMenuDeleteDialog(controller)
        } else {
            content
        }
    }
}
