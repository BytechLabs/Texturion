import SwiftUI

/// #690: the "Links" section of a task, and the "Linked tasks" list on a
/// conversation and on a contact.
///
/// Done stays per task. A link shows the other task's own state, and finishing
/// a sub-task never finishes its parent.

/// The sentence for a link the server refused. A second parent is a 409; a
/// loop (or a task already at its limit) is a 422. Both are said plainly
/// rather than as a bare status.
func taskLinkErrorKey(_ error: Error) -> String? {
    guard let api = error as? ApiError else { return nil }
    switch api.code {
    case ApiErrorCode.conflict: return "taskRefs.errHasParent"
    case ApiErrorCode.validationFailed: return "taskRefs.errRejected"
    default: return nil
    }
}

/// The catalogue key for one `how` a task is linked to a conversation or contact.
func linkedTaskHowKey(_ how: String) -> String? {
    switch how {
    case "anchored": return "taskRefs.howAnchored"
    case "mentioned": return "taskRefs.howMentioned"
    case "points_at": return "taskRefs.howPointsAt"
    default: return nil
    }
}

private func addKey(_ relation: String) -> String {
    switch relation {
    case TaskRelation.blockedBy: return "taskRefs.addBlockedBy"
    case TaskRelation.blocks: return "taskRefs.addBlocks"
    case TaskRelation.parent: return "taskRefs.addParent"
    default: return "taskRefs.addSubTask"
    }
}

/// "T-142", small and quiet above a task title. Nothing for a row from a server
/// that predates numbers.
struct TaskNumberTag: View {
    let number: Int?

    var body: some View {
        if let number {
            Text(taskNumberLabel(number))
                .font(.golos(11, weight: .semibold))
                .foregroundStyle(BrandColor.muted500)
        }
    }
}

private struct DoneMark: View {
    let done: Bool

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Image(systemName: done ? "checkmark.circle.fill" : "circle")
            .font(.scaled(IconSize.standard, weight: .medium))
            .foregroundStyle(done ? BrandColor.olive : BrandColor.muted500)
            .accessibilityLabel(
                AppStrings.translate(appLocale, done ? "taskRefs.stateDone" : "taskRefs.stateOpen")
            )
    }
}

@MainActor
struct TaskLinksSection: View {
    let references: TaskReferencesApi
    let search: @MainActor (String) async -> [ReferencePick]
    let companyId: String
    let taskId: String
    let canEdit: Bool
    /// Bumped by the screen when the task reloads, so the links do too.
    let refreshKey: Int
    /// Called after a link is added or removed, so the history can reload.
    let onChanged: @MainActor () -> Void

    @State private var links: [TaskLink] = []
    @State private var loaded = false
    @State private var failed = false
    @State private var pickerOpen = false
    @State private var pendingRelation = TaskRelation.blockedBy
    @State private var message: String?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(label: AppStrings.translate(appLocale, "taskRefs.linksTitle"))
            if failed && links.isEmpty {
                Text(AppStrings.translate(appLocale, "taskRefs.linksLoadFailed"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            } else if loaded && links.isEmpty {
                Text(AppStrings.translate(appLocale, "taskRefs.linksEmpty"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            }
            ForEach(TaskRelation.all, id: \.self) { relation in
                relationGroup(relation)
            }
            if let message {
                Text(message)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.destructive)
            }
            if canEdit { addMenu }
        }
        .task(id: "\(taskId)|\(refreshKey)") { await load() }
        .referencePickerSheet(
            isPresented: $pickerOpen,
            search: search,
            excludeId: taskId
        ) { pick in
            if pick.kind == .task { add(pick) }
        }
    }

    @ViewBuilder
    private func relationGroup(_ relation: String) -> some View {
        let rows = links.filter { $0.relation == relation }
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(AppStrings.translate(appLocale, TaskRelation.labelKey(relation)))
                    .font(.golos(11, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                ForEach(rows) { row in
                    linkRow(row)
                }
            }
        }
    }

    private func linkRow(_ row: TaskLink) -> some View {
        HStack(spacing: 10) {
            DoneMark(done: row.done)
            Button {
                AppRouter.shared.openTaskId = row.task_id
            } label: {
                Text("\(taskNumberLabel(row.number)) \(row.title)")
                    .font(.golos(13.5, weight: .medium))
                    .foregroundStyle(BrandColor.ink)
                    .strikethrough(row.done)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if canEdit {
                Button {
                    remove(row)
                } label: {
                    Image(systemName: "xmark")
                        .font(.scaled(IconSize.small, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    AppStrings.translate(
                        appLocale,
                        "taskRefs.removeLink",
                        ["task": "\(taskNumberLabel(row.number)) \(row.title)"]
                    )
                )
            }
        }
    }

    private var addMenu: some View {
        Menu {
            ForEach(TaskRelation.all, id: \.self) { relation in
                Button(AppStrings.translate(appLocale, addKey(relation))) {
                    pendingRelation = relation
                    message = nil
                    pickerOpen = true
                }
            }
        } label: {
            Label(
                AppStrings.translate(appLocale, "taskRefs.addLink"),
                systemImage: "link.badge.plus"
            )
            .font(.golos(13, weight: .semibold))
            .foregroundStyle(BrandColor.olive)
            .frame(minHeight: 44)
        }
    }

    private func load() async {
        do {
            links = try await references.links(companyId: companyId, taskId: taskId)
            failed = false
        } catch {
            if !(error is CancellationError) { failed = true }
        }
        loaded = true
    }

    private func add(_ pick: ReferencePick) {
        let relation = pendingRelation
        Task {
            do {
                links = try await references.addLink(
                    companyId: companyId,
                    taskId: taskId,
                    relation: relation,
                    otherTaskId: pick.targetId
                )
                message = nil
                onChanged()
            } catch {
                message = taskLinkErrorKey(error).map { AppStrings.translate(appLocale, $0) }
                    ?? error.userMessage
            }
        }
    }

    private func remove(_ row: TaskLink) {
        Task {
            do {
                try await references.removeLink(
                    companyId: companyId,
                    taskId: taskId,
                    otherTaskId: row.task_id,
                    relation: row.relation
                )
                links.removeAll { $0.id == row.id }
                message = nil
                onChanged()
            } catch {
                message = error.userMessage
            }
        }
    }
}

// MARK: - Linked tasks on a conversation or a contact

enum LinkedTasksTarget: Equatable, Sendable {
    case conversation(String)
    case contact(String)

    var key: String {
        switch self {
        case .conversation(let id): return "conversation:" + id
        case .contact(let id): return "contact:" + id
        }
    }
}

@MainActor
struct LinkedTasksSection: View {
    let references: TaskReferencesApi
    let companyId: String
    let target: LinkedTasksTarget
    let onOpenTask: @MainActor (String) -> Void
    /// #717: tasks a list beside this one already shows, so none appears
    /// twice. Passing it also means this list continues that one, so it says
    /// nothing at all rather than "none" when nothing is left.
    var shownElsewhere: Set<String>? = nil
    /// #740: show this many rows, then "Show all". Nil shows every row.
    var limit: Int? = nil

    @State private var showAll = false
    @State private var tasks: [LinkedTask] = []
    @State private var loaded = false
    @State private var failed = false

    @Environment(\.appLocale) private var appLocale

    private var visibleTasks: [LinkedTask] {
        guard let shownElsewhere else { return tasks }
        return tasks.filter { !shownElsewhere.contains($0.id) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if failed && tasks.isEmpty {
                Text(AppStrings.translate(appLocale, "taskRefs.linkedLoadFailed"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            } else if loaded && tasks.isEmpty && shownElsewhere == nil {
                Text(AppStrings.translate(appLocale, "taskRefs.linkedEmpty"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            }
            ForEach(limit == nil || showAll ? visibleTasks : Array(visibleTasks.prefix(limit ?? 0))) { task in
                Button {
                    onOpenTask(task.id)
                } label: {
                    HStack(alignment: .top, spacing: 10) {
                        DoneMark(done: task.done)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("\(taskNumberLabel(task.number)) \(task.title)")
                                .font(.golos(13.5, weight: .medium))
                                .foregroundStyle(BrandColor.ink)
                                .strikethrough(task.done)
                                .lineLimit(2)
                                .multilineTextAlignment(.leading)
                            if let detail = subtitle(task) {
                                Text(detail)
                                    .font(.golos(11.5))
                                    .foregroundStyle(BrandColor.muted500)
                                    .lineLimit(1)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if let limit, !showAll, visibleTasks.count > limit {
                Button(
                    AppStrings.translate(
                        appLocale,
                        "contactsTasks.showAll",
                        ["count": String(visibleTasks.count)]
                    )
                ) { showAll = true }
                    .font(.golos(12, weight: .semibold))
                    .foregroundStyle(BrandColor.olive)
                    .buttonStyle(.plain)
                    .frame(minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: target.key) { await load() }
    }

    private func subtitle(_ task: LinkedTask) -> String? {
        var parts: [String] = []
        if let due = task.due_at, !task.done {
            parts.append(
                AppStrings.translate(appLocale, "contactsTasks.dueWhen", ["when": formatDue(due)])
            )
        }
        for how in task.how ?? [] {
            if let key = linkedTaskHowKey(how) { parts.append(AppStrings.translate(appLocale, key)) }
        }
        return parts.isEmpty ? nil : parts.joined(separator: " \u{00B7} ")
    }

    private func load() async {
        do {
            switch target {
            case .conversation(let id):
                tasks = try await references.linkedTasks(companyId: companyId, conversationId: id)
            case .contact(let id):
                tasks = try await references.linkedTasks(companyId: companyId, contactId: id)
            }
            failed = false
        } catch {
            if !(error is CancellationError) { failed = true }
        }
        loaded = true
    }
}
