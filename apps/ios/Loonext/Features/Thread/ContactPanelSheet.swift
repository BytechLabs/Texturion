import SwiftUI

/// The thread's contact panel — the web sidebar as a sheet, opened by tapping
/// the header identity (the Android ContactPanelSheet.kt twin): inline
/// name/address/notes with the G6 800ms auto-save, the consent line, the
/// conversation's open-tasks checklist (T5.2 — done toggles through the
/// source message, never a task route), and prior conversations with this
/// contact (rows route through the caller into the inbox's open command).
@MainActor
struct ContactPanelSheet: View {
    let controller: ThreadController
    let members: [Member]
    /// Navigation into ANOTHER thread; rows stay un-tappable until it's wired
    /// (a row that goes nowhere would be a lie).
    let onOpenConversation: (@MainActor (String) -> Void)?
    /// Open a checklist task's detail (#217). The caller dismisses this sheet
    /// and routes the task up to the shell.
    let onOpenTask: @MainActor (String) -> Void
    /// #465: open the FULL contact screen — its history, call log and every
    /// conversation. This panel holds a copy of the fields and nothing else, so
    /// without it the panel is a dead end, which is exactly what was reported.
    /// Web has had the jump since #82. The caller dismisses this sheet first,
    /// the same way onOpenTask and onOpenConversation do.
    let onOpenContact: @MainActor (String) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Group {
            if let detail = controller.conversation {
                panelBody(detail)
            }
        }
        .presentationDetents([.medium, .large])
        .task { controller.loadContactPanel() }
    }

    private func memberName(_ userId: String?) -> String? {
        guard let userId else { return nil }
        let name = members.first { $0.user_id == userId }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    private func panelBody(_ detail: ConversationDetail) -> some View {
        let contact = controller.contact
        let displayName = detail.contact.name ?? formatPhone(detail.contact.phone_e164)
        return ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    InitialsAvatar(name: displayName, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName)
                            .font(.golos(16, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            .lineLimit(1)
                        let phone = formatPhone(detail.contact.phone_e164)
                        let optedOut = AppStrings.translate(
                            appLocale, "thread.optedOut"
                        )
                        Text(
                            contact?.opted_out == true
                                ? "\(phone) · \(optedOut)"
                                : phone
                        )
                        .font(.golos(11))
                        .foregroundStyle(BrandColor.muted500)
                    }
                    Spacer(minLength: 8)
                    Button {
                        onOpenContact(detail.contact_id)
                    } label: {
                        Image(systemName: "arrow.up.forward.square")
                            .font(.scaled(17, weight: .regular))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(
                        AppStrings.translate(appLocale, "thread.openFullContact")
                    )
                }
                .padding(.top, 18)

                // Details — the same auto-saving fields as the contact screen.
                sheetSection(
                    AppStrings.translate(appLocale, "thread.sectionDetails")
                ) {
                    PanelAutosaveField(
                        label: AppStrings.translate(appLocale, "thread.fieldName"),
                        initial: contact?.name ?? detail.contact.name ?? "",
                        maxLength: contactNameMax,
                        placeholder: AppStrings.translate(
                            appLocale, "thread.addName"
                        ),
                        multiline: false
                    ) { value in
                        try await controller.saveContactField("name", value)
                    }
                    .id("\(detail.contact_id)|name")
                    PanelAutosaveField(
                        label: AppStrings.translate(
                            appLocale, "thread.fieldAddress"
                        ),
                        initial: contact?.address ?? detail.contact.address ?? "",
                        maxLength: contactAddressMax,
                        placeholder: AppStrings.translate(
                            appLocale, "thread.addAddress"
                        ),
                        multiline: false
                    ) { value in
                        try await controller.saveContactField("address", value)
                    }
                    .id("\(detail.contact_id)|address")
                    PanelAutosaveField(
                        label: AppStrings.translate(appLocale, "thread.fieldNotes"),
                        initial: contact?.notes ?? detail.contact.notes ?? "",
                        maxLength: contactNotesMax,
                        placeholder: AppStrings.translate(
                            appLocale, "thread.notesPlaceholder"
                        ),
                        multiline: true
                    ) { value in
                        try await controller.saveContactField("notes", value)
                    }
                    .id("\(detail.contact_id)|notes")
                }

                sheetSection(
                    AppStrings.translate(appLocale, "thread.sectionConsent")
                ) {
                    Text(
                        consentLine(
                            consentSource: contact?.consent_source
                                ?? detail.contact.consent_source,
                            consentAt: contact?.consent_at ?? detail.contact.consent_at,
                            consentAttestedBy: contact?.consent_attested_by,
                            memberName: memberName,
                            locale: appLocale
                        )
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }

                // #301: where this customer came from. Above the tasks
                // because it is a question somebody ASKS in the first minute
                // of a call, while a task is what they write down afterwards —
                // and because the ask disappears the moment it is answered.
                sheetSection(
                    AppStrings.translate(appLocale, "thread.sectionLeadSource")
                ) {
                    LeadSourcePicker(controller: controller, detail: detail)
                }

                sheetSection(
                    AppStrings.translate(appLocale, "thread.sectionTasks")
                ) {
                    TasksChecklistSection(
                        state: controller.conversationTasks,
                        onToggle: { controller.toggleTaskDone($0) },
                        onOpenTask: onOpenTask
                    )
                }

                sheetSection(
                    AppStrings.translate(
                        appLocale, "thread.sectionOtherConversations"
                    )
                ) {
                    OtherConversationsSection(
                        state: controller.otherConversations,
                        onOpen: onOpenConversation
                    )
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandColor.canvas.ignoresSafeArea())
    }

    private func sheetSection(
        _ title: String,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionHeader(label: title)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Sections

/// The conversation checklist (T5.2). Done toggles ride the SOURCE MESSAGE's
/// done bit — the controller enforces the invariant.
@MainActor
private struct TasksChecklistSection: View {
    let state: LoadState<[TaskItem]>?
    let onToggle: @MainActor (TaskItem) -> Void
    /// #217: tapping the ROW (not the checkbox) opens the task's detail.
    let onOpenTask: @MainActor (String) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        switch state {
        case nil, .loading?:
            ProgressView()
        case .failed?:
            Text(AppStrings.translate(appLocale, "thread.tasksLoadFailed"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .ready(let tasks)?:
            if tasks.isEmpty {
                Text(AppStrings.translate(appLocale, "thread.noTasks"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(tasks, id: \.id) { task in
                        taskRow(task)
                    }
                }
            }
        }
    }

    /// Two separate hit targets (#217): the checkbox toggles done through the
    /// source message (never navigates), the title area opens the task detail.
    private func taskRow(_ task: TaskItem) -> some View {
        HStack(spacing: 10) {
            Button {
                onToggle(task)
            } label: {
                Image(systemName: task.done ? "checkmark.square.fill" : "square")
                    .foregroundStyle(
                        task.done
                            ? AnyShapeStyle(BrandColor.olive)
                            : AnyShapeStyle(BrandColor.muted250)
                    )
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                AppStrings.translate(
                    appLocale,
                    task.done
                        ? "thread.reopenTaskNamed"
                        : "thread.markTaskDoneNamed",
                    ["title": task.title]
                )
            )

            Button {
                onOpenTask(task.id)
            } label: {
                HStack(spacing: 0) {
                    Text(task.title)
                        .font(.subheadline)
                        .strikethrough(task.done)
                        .foregroundStyle(task.done ? .secondary : .primary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                AppStrings.translate(
                    appLocale, "thread.openTaskNamed", ["title": task.title]
                )
            )
        }
        .padding(.vertical, 6)
    }
}

/// Prior conversations with this contact (the current thread excluded).
@MainActor
private struct OtherConversationsSection: View {
    let state: LoadState<[ConversationListItem]>?
    let onOpen: (@MainActor (String) -> Void)?

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        switch state {
        case nil, .loading?:
            ProgressView()
        case .failed?:
            Text(AppStrings.translate(appLocale, "thread.priorLoadFailed"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        case .ready(let rows)?:
            if rows.isEmpty {
                Text(
                    AppStrings.translate(
                        appLocale, "thread.noOtherConversations"
                    )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(rows, id: \.id) { row in
                        let content = HStack(alignment: .center, spacing: 8) {
                            VStack(alignment: .leading, spacing: 1) {
                                Text(snippetLabel(row))
                                    .font(.subheadline)
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(statusLabel(row.status, locale: appLocale))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(relativeTime(row.last_message_at))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 8)
                        if let onOpen {
                            Button {
                                onOpen(row.id)
                            } label: {
                                content
                            }
                            .buttonStyle(.plain)
                        } else {
                            content
                        }
                        Divider()
                    }
                }
            }
        }
    }

    private func snippetLabel(_ row: ConversationListItem) -> String {
        guard let body = row.last_message?.body, !body.isBlank else {
            return AppStrings.translate(appLocale, "thread.conversationFallback")
        }
        return body
    }
}

// MARK: - Auto-save field

/// G6 auto-save, the contact detail screen's field verbatim (that one is file-
/// private to ContactDetailView.swift): writes the field 800ms after the last
/// keystroke (blank clears — an explicit null on the wire) with a quiet
/// status line. A new keystroke during a pending save restarts the clock; the
/// newest value wins.
@MainActor
private struct PanelAutosaveField: View {
    private enum SaveState {
        case idle, saving, saved, failed
    }

    let label: String
    let initial: String
    let maxLength: Int
    let placeholder: String
    let multiline: Bool
    let save: (String?) async throws -> Void

    @State private var value: String
    @State private var lastSaved: String
    @State private var saveState: SaveState = .idle

    @Environment(\.appLocale) private var appLocale

    init(
        label: String,
        initial: String,
        maxLength: Int,
        placeholder: String,
        multiline: Bool,
        save: @escaping (String?) async throws -> Void
    ) {
        self.label = label
        self.initial = initial
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.multiline = multiline
        self.save = save
        _value = State(initialValue: initial)
        _lastSaved = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            TextField(placeholder, text: $value, axis: multiline ? .vertical : .horizontal)
                .font(.subheadline)
                .lineLimit(multiline ? 3 ... 6 : 1 ... 1)
                .onChange(of: value) { _, next in
                    if next.count > maxLength {
                        value = String(next.prefix(maxLength))
                    }
                }
            Text(statusLine)
                .font(.caption)
                .foregroundStyle(
                    saveState == .failed
                        ? AnyShapeStyle(BrandColor.destructive)
                        : AnyShapeStyle(Color.secondary)
                )
                .frame(height: 14)
        }
        .task(id: value) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            let savedTrimmed = lastSaved.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed != savedTrimmed else { return }
            // The debounce: a new keystroke cancels this task and starts over.
            try? await Task.sleep(for: .milliseconds(800))
            if Task.isCancelled { return }
            saveState = .saving
            do {
                try await save(trimmed.isEmpty ? nil : trimmed)
                lastSaved = value
                saveState = .saved
            } catch {
                saveState = .failed
            }
        }
    }

    private var statusLine: String {
        switch saveState {
        case .idle: ""
        case .saving: AppStrings.translate(appLocale, "common.saving")
        case .saved: AppStrings.translate(appLocale, "common.saved")
        case .failed: AppStrings.translate(appLocale, "thread.saveFailed")
        }
    }
}

// MARK: - Previews

#Preview("Panel sections") {
    ScrollView {
        VStack(alignment: .leading, spacing: 14) {
            TasksChecklistSection(
                state: .ready([
                    TaskItem(
                        id: "t1",
                        company_id: "co",
                        message_id: "m1",
                        conversation_id: "c1",
                        title: "Send the fence quote",
                        description: "",
                        assigned_user_id: nil,
                        due_at: nil,
                        created_by_user_id: "u1",
                        created_at: "2026-07-15T12:00:00Z",
                        updated_at: "2026-07-15T12:00:00Z",
                        done: false,
                        status: "open",
                        contact: nil,
                        attachment_count: 0
                    ),
                    TaskItem(
                        id: "t2",
                        company_id: "co",
                        message_id: "m2",
                        conversation_id: "c1",
                        title: "Confirm the gate code",
                        description: "",
                        assigned_user_id: nil,
                        due_at: nil,
                        created_by_user_id: "u1",
                        created_at: "2026-07-14T12:00:00Z",
                        updated_at: "2026-07-15T12:00:00Z",
                        done: true,
                        status: "done",
                        contact: nil,
                        attachment_count: nil
                    ),
                ]),
                onToggle: { _ in },
                onOpenTask: { _ in }
            )
            Divider()
            OtherConversationsSection(
                state: .ready([
                    ConversationListItem(
                        id: "c2",
                        company_id: "co",
                        contact_id: "p1",
                        phone_number_id: "n1",
                        status: "closed",
                        is_spam: false,
                        assigned_user_id: nil,
                        pinned_at: nil,
                        pinned_by_user_id: nil,
                        last_message_at: "2026-07-10T09:00:00Z",
                        closed_at: "2026-07-11T09:00:00Z",
                        created_at: "2026-07-09T09:00:00Z",
                        updated_at: "2026-07-11T09:00:00Z",
                        contact: ContactSummary(
                            id: "p1",
                            name: "Dana Whitcomb",
                            phone_e164: "+14155550134"
                        ),
                        tags: [],
                        unread: false,
                        last_message: ConversationSnippet(
                            id: "m9",
                            direction: "outbound",
                            body: "Thanks — see you Tuesday at 9.",
                            created_at: "2026-07-10T09:00:00Z",
                            has_attachments: false
                        )
                    ),
                ]),
                onOpen: { _ in }
            )
        }
        .padding(20)
    }
}
