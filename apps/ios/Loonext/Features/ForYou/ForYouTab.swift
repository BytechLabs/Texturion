import SwiftUI

/// /for-you — the default landing: Triage (owner/admin), Waiting on you,
/// My tasks, Unread. Realtime events refetch the queue.
@MainActor
struct ForYouTab: View {
    let graph: AppGraph
    let companyId: String
    let me: Me

    @State private var state: LoadState<ForYou> = .loading
    @State private var refreshKey = 0

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
            case .ready(let forYou):
                ForYouList(forYou: forYou)
            }
        }
        .task(id: "\(companyId)#\(refreshKey)") { await reload() }
        .task(id: companyId) {
            // Any conversation/task/call movement can change the queue —
            // refetch quietly.
            for await event in await graph.realtime.events() {
                if event.event.hasPrefix("message.") ||
                    event.event.hasPrefix("conversation.") ||
                    event.event.hasPrefix("task.") ||
                    event.event.hasPrefix("call.") {
                    refreshKey += 1
                }
            }
        }
    }

    private func reload() async {
        if refreshKey == 0 { state = .loading }
        do {
            state = .ready(try await graph.forYouApi.forYou(companyId: companyId))
        } catch {
            state = .failed(error.userMessage)
        }
    }
}

private struct ForYouList: View {
    let forYou: ForYou

    private var total: Int {
        forYou.waiting_on_you.count + forYou.my_tasks.count + forYou.unread.count +
            (forYou.triage.map { $0.conversations.count + $0.tasks.count } ?? 0)
    }

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("For you")
                        .font(.title2.weight(.semibold))
                    Text(
                        total == 0
                            ? "You're all caught up."
                            : "\(total) \(total == 1 ? "thing needs" : "things need") you"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .listRowSeparator(.hidden)
                .padding(.vertical, 4)
            }

            if let triage = forYou.triage,
               !triage.conversations.isEmpty || !triage.tasks.isEmpty {
                Section {
                    ForEach(triage.conversations, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        )
                    }
                    ForEach(triage.tasks, id: \.task_id) { row in
                        TaskLineRow(title: row.title, overdue: row.overdue, dueAt: row.due_at)
                    }
                } header: {
                    SectionHeader("Needs an owner")
                }
            }

            if !forYou.waiting_on_you.isEmpty {
                Section {
                    ForEach(forYou.waiting_on_you, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: row.unread
                        )
                    }
                } header: {
                    SectionHeader("Waiting on you")
                }
            }

            if !forYou.my_tasks.isEmpty {
                Section {
                    ForEach(forYou.my_tasks, id: \.task_id) { row in
                        TaskLineRow(title: row.title, overdue: row.overdue, dueAt: row.due_at)
                    }
                } header: {
                    SectionHeader("Your tasks")
                }
            }

            if !forYou.unread.isEmpty {
                Section {
                    ForEach(forYou.unread, id: \.conversation_id) { row in
                        PersonRow(
                            name: row.contact?.name ?? formatPhone(row.contact?.phone_e164),
                            meta: relativeTime(row.last_message_at),
                            unread: true
                        )
                    }
                } header: {
                    SectionHeader("Unread")
                }
            }
        }
        .listStyle(.plain)
    }
}

private struct SectionHeader: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
            .textCase(nil)
    }
}

private struct PersonRow: View {
    let name: String?
    let meta: String
    let unread: Bool

    private var displayName: String {
        let trimmed = name ?? ""
        return trimmed.isEmpty ? "Unknown" : trimmed
    }

    var body: some View {
        HStack(spacing: 12) {
            InitialsAvatar(name: name)
            Text(displayName)
                .font(unread ? .body.weight(.semibold) : .body)
            Spacer()
            Text(meta)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 2)
    }
}

private struct TaskLineRow: View {
    let title: String
    let overdue: Bool
    let dueAt: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.body)
            Text(subtitle)
                .font(.caption)
                // Overdue = amber, never red (calm system).
                .foregroundStyle(
                    overdue
                        ? AnyShapeStyle(BrandColor.overdueAmber)
                        : AnyShapeStyle(Color.secondary)
                )
        }
        .padding(.vertical, 2)
    }

    private var subtitle: String {
        if overdue { return "Overdue task" }
        if let dueAt { return "Due \(relativeTime(dueAt))" }
        return "Open task"
    }
}
