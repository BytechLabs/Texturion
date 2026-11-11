import SwiftUI

/// The thread's contact panel — the web sidebar as a sheet, opened by tapping
/// the header identity (the Android ContactPanelSheet.kt twin): a header
/// (inline name, number, how long they have been a customer) over an action row
/// (call, copy, open the contact), then one section style for the auto-saving
/// address/notes (G6 800ms), the consent line, the conversation's open-tasks
/// checklist (T5.2 — done toggles through the source message, never a task
/// route) and prior conversations with this contact (rows route through the
/// caller into the inbox's open command), with the rarely-changed settings
/// folded into Preferences (#717).
@MainActor
struct ContactPanelSheet: View {
    let graph: AppGraph
    let companyId: String
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
    /// The caller dismisses this sheet first, the same way onOpenTask and
    /// onOpenConversation do. #717: it is the header's labelled "Open contact"
    /// link, never an icon in a corner.
    let onOpenContact: @MainActor (String) -> Void
    /// Places a call to this contact. Nil hides the Call action.
    let onCall: (@MainActor () -> Void)?
    /// A call is being placed, so Call waits.
    let calling: Bool
    /// #726: opens where lead sources are managed. Nil hides it from whoever
    /// cannot add one.
    var onAddLeadSource: (@MainActor () -> Void)? = nil

    @State private var copied = false
    @State private var leadSources: [LeadSource] = []

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

    /// The timeline hands back the message too; this sheet only opens the thread.
    private var activityOpenConversation: (@MainActor (String, String?) -> Void)? {
        guard let go = onOpenConversation else { return nil }
        return { conversationId, _ in go(conversationId) }
    }

    private func memberName(_ userId: String?) -> String? {
        guard let userId else { return nil }
        let name = members.first { $0.user_id == userId }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    /// Tasks the checklist already shows, so the linked list does not repeat
    /// them (#717).
    private var shownTaskIds: Set<String> {
        if case .ready(let tasks)? = controller.conversationTasks {
            return Set(tasks.map(\.id))
        }
        return []
    }

    private func panelBody(_ detail: ConversationDetail) -> some View {
        let contact = controller.contact
        let displayName = detail.contact.name ?? formatPhone(detail.contact.phone_e164)
        let phone = formatPhone(detail.contact.phone_e164)
        let optedOut = AppStrings.translate(appLocale, "thread.optedOut")
        // #301: an unanswered source stays out in the open as the one-tap ask;
        // once answered it is a setting, and joins Preferences.
        let asksForSource =
            leadSources.contains { $0.archived_at == nil } && detail.lead_source_id == nil
        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                // #717: the header says who, their number and how long they
                // have been a customer; the action row calls, copies and opens
                // the contact as a labelled link, never a corner icon.
                RecordHeader {
                    InitialsAvatar(name: displayName, size: 44)
                } content: {
                    PanelAutosaveField(
                        label: AppStrings.translate(appLocale, "thread.fieldName"),
                        initial: contact?.name ?? detail.contact.name ?? "",
                        maxLength: contactNameMax,
                        placeholder: AppStrings.translate(
                            appLocale, "thread.addName"
                        ),
                        multiline: false,
                        quiet: true,
                        large: true
                    ) { value in
                        try await controller.saveContactField("name", value)
                    }
                    .id("\(detail.contact_id)|name")
                    Text(contact?.opted_out == true ? "\(phone) · \(optedOut)" : phone)
                        .font(.golos(13))
                        .monospacedDigit()
                        .foregroundStyle(BrandColor.muted500)
                    // #410: how long they have been a customer, and how often.
                    if let line = contactRelationshipLine(
                        contact?.conversation_count,
                        contact?.first_conversation_at,
                        locale: appLocale
                    ) {
                        Text(line)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted500)
                    }
                } trailing: {
                    EmptyView()
                } actions: {
                    if let onCall {
                        Button {
                            onCall()
                        } label: {
                            Label(
                                AppStrings.translate(appLocale, "contactsTasks.call"),
                                systemImage: "phone"
                            )
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .disabled(calling)
                    }
                    Button {
                        UIPasteboard.general.string = detail.contact.phone_e164
                        copied = true
                    } label: {
                        Label(
                            AppStrings.translate(
                                appLocale,
                                copied ? "thread.numberCopied" : "contactsTasks.copyNumber"
                            ),
                            systemImage: copied ? "checkmark" : "doc.on.doc"
                        )
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    RecordOpenLink(
                        label: AppStrings.translate(appLocale, "thread.openContact")
                    ) {
                        onOpenContact(detail.contact_id)
                    }
                }

                // Details — the same auto-saving fields as the contact screen.
                RecordSection(
                    label: AppStrings.translate(appLocale, "thread.sectionDetails")
                ) {
                    PanelAutosaveField(
                        label: AppStrings.translate(
                            appLocale, "thread.fieldAddress"
                        ),
                        initial: contact?.address ?? detail.contact.address ?? "",
                        maxLength: contactAddressMax,
                        placeholder: AppStrings.translate(
                            appLocale, "thread.addAddress"
                        ),
                        multiline: false,
                        quiet: true
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
                        multiline: true,
                        quiet: true
                    ) { value in
                        try await controller.saveContactField("notes", value)
                    }
                    .id("\(detail.contact_id)|notes")
                }

                RecordSection(
                    label: AppStrings.translate(appLocale, "thread.sectionConsent")
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

                RecordSection(
                    label: AppStrings.translate(appLocale, "thread.sectionTasks")
                ) {
                    TasksChecklistSection(
                        state: controller.conversationTasks,
                        onToggle: { controller.toggleTaskDone($0) },
                        onOpenTask: onOpenTask
                    )
                    // #690: tasks that point at this conversation or are
                    // anchored to it, continuing the checklist above; one the
                    // checklist already shows is not repeated.
                    LinkedTasksSection(
                        references: TaskReferencesApi(api: controller.repo.api),
                        companyId: detail.company_id,
                        target: .conversation(detail.id),
                        onOpenTask: onOpenTask,
                        shownElsewhere: shownTaskIds
                    )
                }

                // #301: where this customer came from, only while it is a
                // question somebody ASKS in the first minute of a call.
                if asksForSource {
                    RecordSection(
                        label: AppStrings.translate(
                            appLocale, "thread.sectionLeadSource"
                        )
                    ) {
                        LeadSourcePicker(
                            controller: controller,
                            detail: detail,
                            onAddSource: onAddLeadSource
                        )
                    }
                }

                RecordSection(
                    label: AppStrings.translate(
                        appLocale, "thread.sectionOtherConversations"
                    )
                ) {
                    OtherConversationsSection(
                        state: controller.otherConversations,
                        onOpen: onOpenConversation
                    )
                }

                // #714: this thread's own activity: texts, calls, assignments,
                // tags, status, opt-outs and scheduled texts. Read only while
                // the sheet is open.
                RecordSection(label: AppStrings.translate(appLocale, "activity.heading")) {
                    ActivityTimelineView(
                        graph: graph,
                        companyId: companyId,
                        recordType: .conversation,
                        recordId: detail.id,
                        onOpenConversation: activityOpenConversation,
                        onOpenTask: onOpenTask,
                        onOpenContact: onOpenContact
                    )
                }

                PreferencesSection(
                    controller: controller,
                    detail: detail,
                    withSource: !asksForSource,
                    leadSources: leadSources,
                    onAddLeadSource: onAddLeadSource
                )
            }
            .padding(.horizontal, 20)
            .padding(.top, 18)
            .padding(.bottom, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .task(id: detail.id) {
            leadSources = (try? await controller.leadSources()) ?? []
        }
    }
}

// MARK: - Preferences

/// #717: the settings a crew sets once per customer, if ever, folded into one
/// row that says what they are set to and opens on demand.
@MainActor
private struct PreferencesSection: View {
    let controller: ThreadController
    let detail: ConversationDetail
    /// The source is answered, so it is a setting rather than an ask.
    let withSource: Bool
    let leadSources: [LeadSource]
    var onAddLeadSource: (@MainActor () -> Void)? = nil

    @State private var open = false
    @State private var saving = false

    @Environment(\.appLocale) private var appLocale

    private var contactLocale: String? { controller.contact?.locale }
    private var companyLocale: String? { controller.company?.locale }

    private var inheritLabel: String {
        inheritedLocaleLabel(companyLocale: companyLocale, locale: appLocale)
    }

    private var summary: String {
        let language = contactLocale.map { MessageLocale.label($0) } ?? inheritLabel
        let source = withSource
            ? leadSources.first { $0.id == detail.lead_source_id }?.name
            : nil
        return [language, source].compactMap { $0 }.joined(separator: " \u{00B7} ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                open.toggle()
            } label: {
                HStack(spacing: 8) {
                    SectionLabel(AppStrings.translate(appLocale, "thread.sectionPreferences"))
                    Text(summary)
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                    Image(systemName: open ? "chevron.up" : "chevron.down")
                        .font(.scaled(IconSize.small, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(AppStrings.translate(appLocale, "thread.sectionLanguage"))
                            .font(.subheadline.weight(.medium))
                        // #717: the workspace's own language is the inherit
                        // choice's answer, so it is a second row only when this
                        // contact is already set to it.
                        // #726: chips, so the chosen language is filled and checked
                        // and every other one is a plain outline.
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 6) {
                                ChoiceChip(
                                    label: inheritLabel,
                                    chosen: contactLocale == nil,
                                    disabled: saving
                                ) { chooseLanguage(nil) }
                                ForEach(
                                    choicesBesideDefault(
                                        MessageLocale.all,
                                        default: companyLocale.flatMap {
                                            MessageLocale.all.contains($0) ? $0 : nil
                                        },
                                        stored: contactLocale
                                    ),
                                    id: \.self
                                ) { candidate in
                                    ChoiceChip(
                                        label: MessageLocale.label(candidate),
                                        chosen: contactLocale == candidate,
                                        disabled: saving
                                    ) { chooseLanguage(candidate) }
                                }
                            }
                        }
                        Text(
                            AppStrings.translate(
                                appLocale, "contactsTasks.localeContactScopeNote"
                            )
                        )
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                    if withSource && leadSources.contains(where: { $0.archived_at == nil }) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(
                                AppStrings.translate(
                                    appLocale, "thread.sectionLeadSource"
                                )
                            )
                            .font(.subheadline.weight(.medium))
                            LeadSourcePicker(
                                controller: controller,
                                detail: detail,
                                onAddSource: onAddLeadSource
                            )
                        }
                    }
                }
                .padding(.horizontal, 6)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chooseLanguage(_ next: String?) {
        saving = true
        Task { @MainActor in
            defer { saving = false }
            try? await controller.saveContactField("locale", next)
        }
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
            // #722: the checkbox is inert where the server will not take the flip.
            .disabled(!task.doneToggleAllowed)
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
                                .exactTime(row.last_message_at)
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
    /// #717: no caption above the field; the label still names it to
    /// VoiceOver. For a field that sits in a record header or section.
    let quiet: Bool
    /// The field is a title, so it reads at title size.
    let large: Bool
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
        quiet: Bool = false,
        large: Bool = false,
        save: @escaping (String?) async throws -> Void
    ) {
        self.label = label
        self.initial = initial
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.multiline = multiline
        self.quiet = quiet
        self.large = large
        self.save = save
        _value = State(initialValue: initial)
        _lastSaved = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if !quiet {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            TextField(placeholder, text: $value, axis: multiline ? .vertical : .horizontal)
                .font(fieldFont)
                .accessibilityLabel(label)
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

    private var fieldFont: Font {
        large ? Font.golos(17, weight: .semibold) : Font.subheadline
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
