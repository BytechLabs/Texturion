import SwiftUI

enum TrashSource: String {
    case message = "trash.deleteMessage"
    case note = "trash.deleteNote"
    case call = "trash.deleteCall"
}

@MainActor
struct TrashSourceSheet: View {
    let source: TrashSource
    var sentTextNotice: String? = nil
    let loadTasks: @MainActor () async throws -> [TrashLinkedTask]
    let onDismiss: @MainActor () -> Void
    let onConfirm: @MainActor (Bool) -> Void

    @Environment(\.appLocale) private var appLocale
    @State private var tasks: [TrashLinkedTask]?
    @State private var failed = false
    @State private var attempt = 0
    @State private var includeTasks = false

    var body: some View {
        let linked = tasks ?? []
        let explanation = summary(linked)
        ConfirmSheet(
            title: t(source.rawValue),
            message: [sentTextNotice, explanation].compactMap { $0 }.joined(separator: "\n\n"),
            confirmLabel: t("trash.moveToTrash"),
            destructive: true,
            confirmEnabled: tasks != nil,
            onConfirm: { onConfirm(!linked.isEmpty && includeTasks) },
            onDismiss: onDismiss
        ) {
            if failed {
                Button(t("common.retry")) { attempt += 1 }
                    .buttonStyle(.bordered)
                    .padding(.top, 8)
            }
            if !linked.isEmpty {
                ChoiceCards(
                    options: [
                        ChoiceOption(false, title: t(source.rawValue + "Only")),
                        ChoiceOption(true, title: t(source.rawValue + "AndJob")),
                    ],
                    selected: includeTasks
                ) { includeTasks = $0 }
            }
        }
        .task(id: attempt) {
            failed = false
            do {
                let preview = try await loadTasks()
                if !Task.isCancelled { tasks = preview }
            } catch {
                if !Task.isCancelled { failed = true }
            }
        }
    }

    private func summary(_ linked: [TrashLinkedTask]) -> String {
        if failed { return t("trash.linkedJobLoadFailed") }
        if tasks == nil { return t("trash.loadingMore") }
        if linked.isEmpty { return t("trash.sourceDeleteBody") }
        let numbers = linked.map { String($0.number) }.joined(separator: ", #")
        return AppStrings.translate(appLocale, "trash.linkedJobErase", ["number": numbers])
    }

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }
}
