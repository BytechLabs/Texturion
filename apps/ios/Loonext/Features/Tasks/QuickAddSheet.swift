import SwiftUI

/// #689 A: "New task" opens one line.
///
///   Fix furnace @rehman tomorrow 9am #urgent
///
/// The line is read as the member types and the sheet shows what it understood:
/// the title, who, when, how urgent, which labels. NOTHING is saved until the
/// member taps Add task, and a word the parser is not sure of stays in the
/// title where the member can see it.
///
/// *Applying: Smart Defaults (no empty form to fill), Zen of Clarity (one
/// field; the full form is one quiet link away) and Ethical Friction (a
/// preview before anything exists).*
@MainActor
struct QuickAddSheet: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let members: [Member]
    let tags: [Tag]
    let onCreated: @MainActor () -> Void
    let onFullForm: @MainActor () -> Void
    let onClose: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var line = ""
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: Bool

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    private var context: QuickAddContext {
        QuickAddContext(
            now: Date(),
            timeZone: TimeZone.current,
            selfUserId: me.user_id,
            members: members
                .filter { $0.deactivated_at == nil && !$0.display_name.isBlank }
                .map { QuickAddMember(userId: $0.user_id, name: $0.display_name) },
            labels: tags.map { QuickAddLabel(id: $0.id, name: $0.name) }
        )
    }

    var body: some View {
        let result = parseQuickAdd(line, context)
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    field
                    preview(result)
                    if let error {
                        Text(error)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.destructive)
                    }
                    Button(t("taskRefs.quickAddFullForm")) { onFullForm() }
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                        .frame(minHeight: 44)
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(BrandColor.canvas.ignoresSafeArea())
            .navigationTitle(t("thread.newTask"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { onClose() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("taskRefs.quickAddConfirm")) { create(result) }
                        .disabled(saving || result.title.isBlank)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .onAppear { focused = true }
    }

    private var field: some View {
        TextField(t("taskRefs.quickAddPlaceholder"), text: $line)
            .font(.golos(16))
            .textInputAutocapitalization(.sentences)
            .submitLabel(.done)
            // Return puts the keyboard away. It never saves: adding is the
            // button, after the member has read the preview.
            .onSubmit { focused = false }
            .focused($focused)
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .onChange(of: line) { _, _ in error = nil }
    }

    // MARK: Preview

    @ViewBuilder
    private func preview(_ result: QuickAddResult) -> some View {
        if line.isBlank {
            Text(t("taskRefs.quickAddHint"))
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted500)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Text(t("taskRefs.quickAddPreview").uppercased())
                    .font(.golos(10.5, weight: .bold))
                    .kerning(1.2)
                    .foregroundStyle(BrandColor.muted600)
                    .padding(.bottom, 8)
                PaperCard {
                    previewRow(
                        t("taskRefs.quickAddTitle"),
                        result.title.isBlank ? t("taskRefs.quickAddNoTitle") : result.title,
                        warn: result.title.isBlank
                    )
                    if let assignee = result.assignee {
                        RowDivider()
                        previewRow(t("contactsTasks.assignee"), assignee.name)
                    }
                    if let due = dueText(result) {
                        RowDivider()
                        previewRow(t("taskRefs.quickAddDue"), due)
                    }
                    if let priority = result.priority {
                        RowDivider()
                        previewRow(
                            t("contactsTasks.priority"),
                            t(TaskPriority.from(priority.rawValue).labelKey)
                        )
                    }
                    if !result.labels.isEmpty {
                        RowDivider()
                        previewRow(
                            t("contactsTasks.label"),
                            result.labels.map { $0.name }.joined(separator: ", ")
                        )
                    }
                }
                if !result.ignored.isEmpty {
                    Text(
                        t(
                            "taskRefs.quickAddLeftInTitle",
                            ["words": result.ignored.joined(separator: " ")]
                        )
                    )
                    .font(.golos(11.5))
                    .foregroundStyle(BrandColor.muted500)
                    .padding(.top, 8)
                }
            }
        }
    }

    private func previewRow(_ label: String, _ value: String, warn: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
                .frame(width: 84, alignment: .leading)
            Text(value)
                .font(.golos(14, weight: .semibold))
                .foregroundStyle(warn ? BrandColor.overdueAmber : BrandColor.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }

    private func dueText(_ result: QuickAddResult) -> String? {
        guard let date = parseWireTimestamp(result.dueAt) else { return nil }
        return TimestampFormat.label(
            date, style: result.dueHasTime ? .long : .short, locale: appLocale)
    }

    // MARK: Add

    private func create(_ result: QuickAddResult) {
        let title = String(result.title.prefix(taskTitleMax))
        if title.isBlank { return }
        let priority: String? = {
            guard let found = result.priority, found != .normal else { return nil }
            return found.rawValue
        }()
        let assigneeIds: [String]? = result.assignee.map { [$0.userId] }
        saving = true
        Task {
            do {
                _ = try await TaskMutations(api: graph.api).createStandalone(
                    companyId: companyId,
                    title: title,
                    assignedUserId: result.assignee?.userId,
                    dueAt: result.dueAt,
                    conversationId: nil,
                    contactId: nil,
                    priority: priority,
                    labelIds: result.labels.map { $0.id },
                    assigneeIds: assigneeIds
                )
                Haptics.confirm()
                onCreated()
                onClose()
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
