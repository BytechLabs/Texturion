import SwiftUI
import UniformTypeIdentifiers

/// Task detail: inline-editable title/description (blur save), assignee and
/// offset-ISO due pickers, derived done circle (message PATCH), quoted source
/// message, the D28 derived read-only attachments union (per-item signed
/// URLs), the merged activity+discussion timeline, and a pinned note composer
/// (notes are the only door for task files). viewer_level 'none' shows the
/// task identity plus an access notice — nothing conversation-derived.
@MainActor
struct TaskDetailView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let taskId: String
    /// Deep-link: open the source thread anchored to the promoted message.
    /// The shell wires it (#159); until wired the affordance stays hidden.
    let onOpenConversation: ((_ conversationId: String, _ messageId: String) -> Void)?

    private enum DetailState {
        case loading
        case failed(message: String, notFound: Bool)
        case ready(TaskDetail)
    }

    @State private var state: DetailState = .loading
    @State private var members: [Member] = []
    @State private var refreshKey = 0
    @State private var actionError: String?

    @State private var pickerOpen = false
    @State private var duePickerOpen = false
    @State private var confirmDelete = false
    @State private var deleting = false

    @Environment(\.dismiss) private var dismiss

    private var mutations: TaskMutations { TaskMutations(api: graph.api) }

    private var detail: TaskDetail? {
        if case .ready(let value) = state { return value }
        return nil
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message, let notFound):
                if notFound {
                    // Deleted (or never visible) — retrying would just 404 again.
                    Text(message)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(24)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                } else {
                    CenteredError(message: message) { refreshKey += 1 }
                }
            case .ready(let detail):
                readyBody(detail)
            }
        }
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
        // The tab's list screen hides the bar; the pushed detail needs it
        // back for the title, back button, and overflow menu.
        .toolbar(.visible, for: .navigationBar)
        .toolbar {
            if let detail {
                ToolbarItem(placement: .topBarTrailing) {
                    overflowMenu(detail)
                }
            }
        }
        .task(id: "\(taskId)|\(refreshKey)") { await load() }
        .task(id: companyId) {
            if let page = try? await mutations.members(companyId: companyId) {
                members = page.data
            }
        }
        .task(id: taskId) {
            // Realtime: metadata changes ride task.changed; done flips ride
            // message.status. Payloads are ID-only — match and refetch.
            for await event in await graph.realtime.events() {
                switch event.event {
                case "task.changed":
                    let conversation = event.payload["conversation_id"]?.stringValue
                    if detail == nil || conversation == nil
                        || conversation == detail?.conversation_id {
                        refreshKey += 1
                    }
                case "message.status":
                    let message = event.payload["message_id"]?.stringValue
                    if detail == nil || message == detail?.message_id {
                        refreshKey += 1
                    }
                default:
                    break
                }
            }
        }
        // #215: a socket re-JOIN (missed frames while offline) refetches the
        // task; Part A does the same on foreground return.
        .task(id: taskId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        .resyncOnForeground { refreshKey += 1 }
        .sheet(isPresented: $pickerOpen) {
            if let detail {
                MemberPickerSheet(
                    members: members,
                    meUserId: me.user_id,
                    selectedUserId: detail.assigned_user_id,
                    showUnassigned: true
                ) { userId in
                    runPatch { try await mutations.assign(
                        companyId: companyId, taskId: detail.id, userId: userId
                    ) }
                }
            }
        }
        .sheet(isPresented: $duePickerOpen) {
            if let detail {
                DuePickerSheet(
                    initial: parseWireTimestamp(detail.due_at),
                    onSet: { date in
                        // The API requires ISO 8601 WITH the local UTC offset.
                        let iso = encodeDueAt(date)
                        runPatch { try await mutations.setDue(
                            companyId: companyId, taskId: detail.id, dueAt: iso
                        ) }
                    }
                )
            }
        }
        .alert("Delete this task?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { deleteTask() }
                .disabled(deleting)
            Button("Keep task", role: .cancel) {}
        } message: {
            if let detail {
                Text(deleteWarning(detail))
            }
        }
    }

    // MARK: - Loading

    private func load() async {
        do {
            state = .ready(try await mutations.detail(companyId: companyId, taskId: taskId))
        } catch let error as ApiError where error.code == ApiErrorCode.notFound {
            // A teammate deleted it (task.changed → refetch → 404):
            // say so instead of showing a stale row forever.
            state = .failed(message: "This task doesn't exist or was removed.", notFound: true)
        } catch {
            if case .ready = state {
                // Keep data on a quiet refresh failure.
            } else {
                state = .failed(message: error.userMessage, notFound: false)
            }
        }
    }

    // MARK: - Derived

    private var noAccess: Bool { detail?.viewer_level == "none" }

    private var canDelete: Bool {
        guard let detail else { return false }
        let role = me.memberships.first { $0.company_id == companyId }?.role
        return MemberRole.atLeast(role, required: MemberRole.admin)
            || detail.created_by_user_id == me.user_id
    }

    private func memberName(_ userId: String?) -> String? {
        guard let userId else { return nil }
        let name = members.first { $0.user_id == userId }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    private func hasNotes(_ detail: TaskDetail) -> Bool {
        detail.activity.contains { $0.kind == "note" }
    }

    private func deleteWarning(_ detail: TaskDetail) -> String {
        let carried = [
            hasNotes(detail) ? "discussion notes" : nil,
            detail.attachments.isEmpty ? nil : "files",
        ].compactMap(\.self).joined(separator: " and ")
        return "It carries \(carried). The conversation and its messages stay; "
            + "the done mark on the source message is kept."
    }

    // MARK: - Mutations

    /// Metadata edits reuse the fetched detail, swapping just the task
    /// columns, then quietly refetch so activity lines catch up.
    private func runPatch(_ patch: @escaping () async throws -> TaskRowPatch) {
        Task {
            actionError = nil
            do {
                let row = try await patch()
                if let detail {
                    state = .ready(merged(detail, with: row))
                }
                refreshKey += 1
            } catch {
                actionError = error.userMessage
            }
        }
    }

    private func merged(_ detail: TaskDetail, with row: TaskRowPatch) -> TaskDetail {
        TaskDetail(
            id: detail.id,
            company_id: detail.company_id,
            message_id: detail.message_id,
            conversation_id: detail.conversation_id,
            title: row.title,
            description: row.description,
            assigned_user_id: row.assigned_user_id,
            due_at: row.due_at,
            created_by_user_id: detail.created_by_user_id,
            created_at: detail.created_at,
            updated_at: row.updated_at,
            done: detail.done,
            status: detail.status,
            assignee: detail.assignee,
            created_by: detail.created_by,
            source_message: detail.source_message,
            attachments: detail.attachments,
            activity: detail.activity,
            viewer_level: detail.viewer_level,
            // #214: the raw row (`to_jsonb(v_task)`) carries the current address
            // after ANY mutation, so re-read it here — a rename/assign/due edit
            // never drops the address, and an address save reflects the new one.
            addr_street: row.addr_street,
            addr_unit: row.addr_unit,
            addr_city: row.addr_city,
            addr_state: row.addr_state,
            addr_postal_code: row.addr_postal_code,
            addr_country: row.addr_country,
            addr_provenance: row.addr_provenance
        )
    }

    private func toggleDone() {
        guard let detail else { return }
        let next = !detail.done
        Task {
            actionError = nil
            do {
                // Derived-done invariant: the write path is the SOURCE MESSAGE.
                _ = try await mutations.setDone(
                    companyId: companyId, messageId: detail.message_id, done: next
                )
                refreshKey += 1
            } catch {
                actionError = error.userMessage
            }
        }
    }

    private func deleteTask() {
        guard let detail else { return }
        deleting = true
        Task {
            actionError = nil
            do {
                try await mutations.delete(companyId: companyId, taskId: detail.id)
                dismiss()
            } catch let error as ApiError where error.code == ApiErrorCode.forbidden {
                actionError = "Only the task's creator or an admin can delete it."
            } catch {
                actionError = error.userMessage
            }
            deleting = false
        }
    }

    // MARK: - Body

    private func overflowMenu(_ detail: TaskDetail) -> some View {
        Menu {
            if !noAccess {
                Button(detail.done ? "Mark not done" : "Mark done") { toggleDone() }
            }
            if canDelete {
                Button("Delete task", role: .destructive) {
                    // #89: confirm only when the task carries notes or files;
                    // a plain task deletes now.
                    if hasNotes(detail) || !detail.attachments.isEmpty {
                        confirmDelete = true
                    } else {
                        deleteTask()
                    }
                }
                .disabled(deleting)
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .accessibilityLabel("Task actions")
    }

    // fileprivate (not private) so the #Preview below can render the ready
    // state with inline mock data — the loaded view is otherwise unreachable
    // without a live API.
    fileprivate func readyBody(_ detail: TaskDetail) -> some View {
        VStack(spacing: 0) {
            if let actionError {
                Text(actionError)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header(detail)
                    metaChips(detail)
                    createdLine(detail)
                    if noAccess {
                        noAccessCard
                        // #214: the address is a task column (not conversation-
                        // derived), so it shows even to a no-access viewer.
                        addressSection(detail)
                    } else {
                        sourceCard(detail)
                        descriptionSection(detail)
                        addressSection(detail)
                        if !detail.attachments.isEmpty {
                            attachmentsSection(detail)
                        }
                        activitySection(detail)
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)
                .padding(.bottom, 16)
            }
            if !noAccess {
                NoteComposer(
                    mutations: mutations,
                    multipart: MultipartClient(api: graph.api, sessionStore: graph.sessionStore),
                    companyId: companyId,
                    conversationId: detail.conversation_id,
                    taskId: detail.id,
                    onPosted: { refreshKey += 1 }
                )
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
    }

    private func header(_ detail: TaskDetail) -> some View {
        HStack(alignment: .top, spacing: 13) {
            if !noAccess {
                // The big derived-done ring: 28pt outline → lime fill + ink
                // check (spec 23).
                Button {
                    toggleDone()
                } label: {
                    ZStack {
                        if detail.done {
                            Circle().fill(BrandColor.lime)
                            Image(systemName: "checkmark")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundStyle(BrandColor.onLime)
                        } else {
                            Circle().strokeBorder(BrandColor.muted250, lineWidth: 2)
                        }
                    }
                    .frame(width: 28, height: 28)
                    .padding(.top, 3)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel(detail.done ? "Mark not done" : "Mark done")
            }
            if noAccess {
                Text(detail.title)
                    .font(.golos(21, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .strikethrough(detail.done)
            } else {
                InlineEditField(
                    initial: detail.title,
                    maxLength: taskTitleMax,
                    placeholder: "Task title",
                    multiline: false,
                    allowEmpty: false,
                    font: .golos(21, weight: .semibold)
                ) { value in
                    await saveField {
                        try await mutations.rename(
                            companyId: companyId, taskId: detail.id, title: value
                        )
                    }
                }
                .id("\(detail.id)|\(detail.updated_at)|title")
            }
        }
    }

    private func metaChips(_ detail: TaskDetail) -> some View {
        let assigneeLabel: String = {
            if detail.assigned_user_id != nil && detail.assigned_user_id == me.user_id {
                return "You"
            }
            if let name = detail.assignee?.display_name, !name.isBlank { return name }
            if let name = memberName(detail.assigned_user_id) { return name }
            return detail.assigned_user_id == nil ? "Unassigned" : "Teammate"
        }()
        let overdue = !detail.done && parseWireTimestamp(detail.due_at).map { $0 < Date() } == true
        let dueLabel: String = {
            if detail.due_at == nil { return "No due date" }
            if overdue { return "Overdue · \(formatDue(detail.due_at))" }
            return "Due \(formatDue(detail.due_at))"
        }()

        // Spec 23: a paper card of Assignee / Due rows with hairlines.
        return PaperCard {
            Button {
                if !noAccess { pickerOpen = true }
            } label: {
                HStack(spacing: 11) {
                    metaRowLabel("Assignee")
                    Text(assigneeLabel)
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Spacer(minLength: 0)
                    metaRowChevron
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            RowDivider()
            HStack(spacing: 11) {
                Button {
                    if !noAccess { duePickerOpen = true }
                } label: {
                    HStack(spacing: 11) {
                        metaRowLabel("Due")
                        Text(dueLabel)
                            .font(.golos(13, weight: .semibold))
                            .foregroundStyle(overdue ? BrandColor.overdueAmber : BrandColor.ink)
                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if detail.due_at != nil && !noAccess {
                    Button {
                        runPatch { try await mutations.setDue(
                            companyId: companyId, taskId: detail.id, dueAt: nil
                        ) }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(BrandColor.muted300)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel("Clear due date")
                }
                metaRowChevron
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 11)
        }
    }

    private func metaRowLabel(_ text: String) -> some View {
        Text(text)
            .font(.golos(11, weight: .semibold))
            .foregroundStyle(BrandColor.muted500)
            .frame(width: 64, alignment: .leading)
    }

    private var metaRowChevron: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(BrandColor.muted250)
    }

    private func createdLine(_ detail: TaskDetail) -> some View {
        let creator: String? = {
            if let name = detail.created_by?.display_name, !name.isBlank { return name }
            return memberName(detail.created_by_user_id)
        }()
        let parts = [
            creator.map { "Created by \($0)" },
            relativeTime(detail.created_at),
        ].compactMap(\.self).filter { !$0.isEmpty }
        return HStack(spacing: 7) {
            DsChip(text: detail.done ? "Done" : "To do")
            Text(parts.joined(separator: " · "))
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted300)
        }
    }

    private var noAccessCard: some View {
        Text(
            "This task is linked to a number you don't have access to. "
                + "You can see the task, but not its messages, files, or "
                + "discussion. Ask an owner or admin for access."
        )
        .font(.golos(13))
        .foregroundStyle(BrandColor.muted700)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    @ViewBuilder
    private func sourceCard(_ detail: TaskDetail) -> some View {
        if let source = detail.source_message {
            VStack(alignment: .leading, spacing: 6) {
                sectionLabel("From this message")
                // Spec 23: paper well with the lime source-quote bar.
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(BrandColor.lime)
                        .frame(width: 3)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(source.body.isBlank ? "A photo" : source.body)
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.muted700)
                        if onOpenConversation != nil {
                            Button("View in conversation") {
                                onOpenConversation?(detail.conversation_id, detail.message_id)
                            }
                            .font(.golos(11, weight: .bold))
                            .foregroundStyle(BrandColor.olive)
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )
            }
        }
    }

    /// #214: the structured job address, editable inline. Keyed on updated_at
    /// so a settled save (or realtime refresh) re-seeds it from the server row —
    /// the same resync the title/description inline editors use.
    private func addressSection(_ detail: TaskDetail) -> some View {
        TaskAddressSection(detail: detail) { fields, provenance in
            saveAddress(fields, provenance: provenance)
        }
        .id("\(detail.id)|\(detail.updated_at)|address")
    }

    private func saveAddress(_ fields: AddressFieldValues, provenance: String) {
        guard let detail else { return }
        runPatch {
            try await mutations.updateAddress(
                companyId: companyId,
                taskId: detail.id,
                fields: fields,
                provenance: provenance
            )
        }
    }

    private func descriptionSection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("Description")
            InlineEditField(
                initial: detail.description,
                maxLength: taskDescriptionMax,
                placeholder: "Add details teammates should know",
                multiline: true,
                allowEmpty: true,
                font: .golos(13)
            ) { value in
                await saveField {
                    try await mutations.describe(
                        companyId: companyId, taskId: detail.id, description: value
                    )
                }
            }
            .id("\(detail.id)|\(detail.updated_at)|description")
        }
    }

    /// Run one inline-edit save; returns the error sentence (nil = saved).
    private func saveField(
        _ patch: @escaping () async throws -> TaskRowPatch
    ) async -> String? {
        do {
            let row = try await patch()
            if let detail {
                state = .ready(merged(detail, with: row))
            }
            refreshKey += 1
            return nil
        } catch {
            return error.userMessage
        }
    }

    private func attachmentsSection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("Files")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(detail.attachments, id: \.id) { item in
                        AttachmentCell(
                            item: item,
                            mutations: mutations,
                            companyId: companyId,
                            onError: { actionError = $0 }
                        )
                    }
                }
            }
        }
    }

    private func activitySection(_ detail: TaskDetail) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("Activity")
            if detail.activity.isEmpty {
                Text("No activity yet. Post a note below to start a discussion.")
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
            }
            ForEach(detail.activity, id: \.id) { item in
                if item.kind == "note" {
                    NoteCard(
                        author: authorName(item),
                        body: item.body ?? "",
                        createdAt: item.created_at
                    )
                } else if let sentence = taskEventSentence(
                    item,
                    by: actorName(item),
                    memberName: memberName
                ) {
                    // Spec 23: a muted dot bullet + quiet sentence per event.
                    HStack(alignment: .firstTextBaseline, spacing: 9) {
                        Circle()
                            .fill(BrandColor.muted250)
                            .frame(width: 6, height: 6)
                        Text("\(sentence) · \(relativeTime(item.created_at))")
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                    }
                    .padding(.leading, 4)
                }
            }
        }
    }

    private func authorName(_ item: TaskActivityItem) -> String {
        if let name = item.author?.display_name, !name.isBlank { return name }
        return memberName(item.author_user_id) ?? "Teammate"
    }

    private func actorName(_ item: TaskActivityItem) -> String {
        if let name = item.actor?.display_name, !name.isBlank { return name }
        return memberName(item.actor_user_id) ?? "Loonext"
    }

    private func sectionLabel(_ text: String) -> some View {
        SectionHeader(label: text)
    }
}

// MARK: - Inline blur-save editor

/// Blur-save inline editor: saving happens when focus leaves the field with a
/// changed value; an empty value snaps back when `allowEmpty` is false. The
/// save callback returns an error sentence (nil = saved) so failures keep the
/// user's text and show a calm line under the field.
@MainActor
private struct InlineEditField: View {
    let initial: String
    let maxLength: Int
    let placeholder: String
    let multiline: Bool
    let allowEmpty: Bool
    let font: Font
    let onSave: (String) async -> String?

    @State private var value: String
    @State private var error: String?
    @FocusState private var focused: Bool

    init(
        initial: String,
        maxLength: Int,
        placeholder: String,
        multiline: Bool,
        allowEmpty: Bool,
        font: Font,
        onSave: @escaping (String) async -> String?
    ) {
        self.initial = initial
        self.maxLength = maxLength
        self.placeholder = placeholder
        self.multiline = multiline
        self.allowEmpty = allowEmpty
        self.font = font
        self.onSave = onSave
        _value = State(initialValue: initial)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            TextField(
                placeholder,
                text: $value,
                axis: multiline ? .vertical : .horizontal
            )
            .font(font)
            .lineLimit(multiline ? 2 ... 6 : 1 ... 1)
            .focused($focused)
            .onChange(of: value) { _, next in
                error = nil
                if next.count > maxLength {
                    value = String(next.prefix(maxLength))
                }
            }
            .onChange(of: focused) { wasFocused, isFocused in
                guard wasFocused, !isFocused else { return }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed == initial.trimmingCharacters(in: .whitespacesAndNewlines) { return }
                if trimmed.isEmpty && !allowEmpty {
                    value = initial // empty snaps back
                    return
                }
                Task { error = await onSave(trimmed) }
            }
            .onSubmit { focused = false }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
            }
        }
    }
}

// MARK: - Address (#214)

/// The task's structured job address, editable inline. Enriched values (an
/// address suggested by AI at create time) carry a provenance badge; any edit
/// marks the address user-authored ("manual"). Saves the whole block when
/// focus leaves the group (never mid-field) or the section is dismissed, and
/// the RPC no-ops an unchanged address. Mirrors the web TaskAddressSection.
@MainActor
private struct TaskAddressSection: View {
    let detail: TaskDetail
    let onSave: @MainActor (AddressFieldValues, String) -> Void

    private enum AddrField: Hashable {
        case street, unit, city, state, postal, country
    }

    @State private var fields: AddressFieldValues
    @State private var provenance: String?
    @State private var open: Bool
    @FocusState private var focused: AddrField?

    init(detail: TaskDetail, onSave: @escaping @MainActor (AddressFieldValues, String) -> Void) {
        self.detail = detail
        self.onSave = onSave
        let initial = detail.addressFields
        _fields = State(initialValue: initial)
        _provenance = State(initialValue: detail.addr_provenance)
        _open = State(initialValue: !initial.isEmpty)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button {
                if open { commit() } // collapsing counts as leaving the group
                open.toggle()
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                    Text("Address")
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    if let label = addressProvenanceLabel(provenance) {
                        provenanceBadge(label)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(BrandColor.muted250)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if open {
                VStack(spacing: 8) {
                    addrField("Street", text: $fields.street, field: .street)
                    HStack(spacing: 8) {
                        addrField("Unit / suite", text: $fields.unit, field: .unit)
                        addrField("City", text: $fields.city, field: .city)
                    }
                    HStack(spacing: 8) {
                        addrField("State / province", text: $fields.state, field: .state)
                        addrField("Postal code", text: $fields.postalCode, field: .postal)
                    }
                    addrField("Country", text: $fields.country, field: .country)
                }
                // Editing any field marks the whole address user-authored.
                .onChange(of: fields) { _, _ in provenance = AddressProvenance.manual }
                // Focus leaving the whole group (keyboard dismiss / tap away) is
                // the blur-out-of-group the web saves on.
                .onChange(of: focused) { _, newValue in
                    if newValue == nil { commit() }
                }
            }
        }
        .padding(.horizontal, 4)
        // Safety net: a save-on-leave if the screen pops with the keyboard up.
        .onDisappear { commit() }
    }

    private func provenanceBadge(_ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
                .font(.system(size: 9, weight: .semibold))
            Text(label)
                .font(.golos(10.5, weight: .semibold))
        }
        .foregroundStyle(BrandColor.muted600)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(BrandColor.inset, in: Capsule())
    }

    private func addrField(
        _ placeholder: String,
        text: Binding<String>,
        field: AddrField
    ) -> some View {
        TextField(placeholder, text: text)
            .font(.golos(13))
            .foregroundStyle(BrandColor.ink)
            .textInputAutocapitalization(.words)
            .autocorrectionDisabled()
            .focused($focused, equals: field)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
    }

    /// Save the block when the edited fields differ from the SERVER's current
    /// address (the value this section was built from). Comparing against the
    /// live row — not a "last attempted" value — is what makes a failed save
    /// retryable: the server row stays stale on failure, so the next commit
    /// still differs and re-sends; a successful save recreates this section
    /// (it is keyed on updated_at) from the new server row, so it won't re-save.
    /// Mirrors the web TaskAddressSection. (If focus-leave and onDisappear both
    /// fire for one edit before the save returns, the second is an idempotent
    /// no-op the server folds away — or a free retry if the first failed.)
    private func commit() {
        guard fields.trimmed != detail.addressFields.trimmed else { return }
        onSave(fields, provenance ?? AddressProvenance.manual)
    }
}

// MARK: - Due picker

/// Date + time picker for due_at. The caller encodes the picked Date as
/// offset-bearing ISO via `encodeDueAt`.
@MainActor
private struct DuePickerSheet: View {
    let initial: Date?
    let onSet: @MainActor (Date) -> Void

    @State private var draft: Date
    @Environment(\.dismiss) private var dismiss

    init(initial: Date?, onSet: @escaping @MainActor (Date) -> Void) {
        self.initial = initial
        self.onSet = onSet
        // Default to today 9:00 like the Android picker's initial time.
        let fallback = Calendar.current.date(
            bySettingHour: 9, minute: 0, second: 0, of: Date()
        ) ?? Date()
        _draft = State(initialValue: initial ?? fallback)
    }

    var body: some View {
        VStack(spacing: 12) {
            DatePicker(
                "Due",
                selection: $draft,
                displayedComponents: [.date, .hourAndMinute]
            )
            .datePickerStyle(.graphical)
            HStack {
                Button("Cancel") { dismiss() }
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Set due date") {
                    onSet(draft)
                    dismiss()
                }
                .buttonStyle(.borderedProminent)
                .tint(BrandColor.olive)
            }
        }
        .padding(16)
        .presentationDetents([.medium, .large])
    }
}

// MARK: - Attachments

/// One derived-union attachment. URLs are short-lived and NEVER cached:
/// images mint on entering the view (per view), files mint at open time and
/// hand the signed URL to the system — the honest path without a download
/// pipeline.
@MainActor
private struct AttachmentCell: View {
    let item: TaskAttachmentItem
    let mutations: TaskMutations
    let companyId: String
    let onError: @MainActor (String?) -> Void

    @State private var url: URL?
    @State private var failed = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        if item.kind == "image" {
            imageCell
        } else {
            fileCell
        }
    }

    private var imageCell: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(BrandColor.inset)
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    case .failure:
                        couldNotLoad
                    default:
                        ProgressView()
                    }
                }
            } else if failed {
                couldNotLoad
            }
        }
        .frame(width: 96, height: 96)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture { openFresh() }
        .task(id: item.id) {
            do {
                let minted = try await mutations.attachmentUrl(
                    companyId: companyId, attachmentId: item.id
                )
                url = URL(string: minted.url)
            } catch {
                failed = true
                onError(error.userMessage)
            }
        }
        .accessibilityLabel(item.file_name ?? "Photo")
    }

    private var couldNotLoad: some View {
        Text("Couldn't load")
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var fileCell: some View {
        HStack(spacing: 8) {
            Image(systemName: "doc")
                .foregroundStyle(BrandColor.muted500)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.file_name ?? "File")
                    .font(.golos(11.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(1)
                Text(formatBytes(item.size_bytes))
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted400)
            }
        }
        .padding(10)
        .frame(width: 180, alignment: .leading)
        .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 12))
        .contentShape(Rectangle())
        .onTapGesture { openFresh() }
    }

    /// Open with a freshly minted URL — the one on screen may have expired.
    private func openFresh() {
        Task {
            do {
                let minted = try await mutations.attachmentUrl(
                    companyId: companyId, attachmentId: item.id
                )
                if let fresh = URL(string: minted.url) {
                    openURL(fresh)
                }
            } catch {
                onError(error.userMessage)
            }
        }
    }
}

// MARK: - Notes

/// A task-linked discussion note: amber card with author + time + body.
private struct NoteCard: View {
    let author: String
    let body_: String
    let createdAt: String

    init(author: String, body: String, createdAt: String) {
        self.author = author
        self.body_ = body
        self.createdAt = createdAt
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            // Spec 23: internal note = dashed inset well, lock + AUTHOR · TIME.
            HStack(spacing: 6) {
                Image(systemName: "lock")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(BrandColor.muted600)
                Text("\(author) · \(relativeTime(createdAt))".uppercased())
                    .font(.golos(10, weight: .bold))
                    .kerning(0.8)
                    .foregroundStyle(BrandColor.muted600)
            }
            if !body_.isBlank {
                Text(body_)
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.ink)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(
                    BrandColor.muted250,
                    style: StrokeStyle(lineWidth: 1.5, dash: [4, 4])
                )
        )
    }
}

// MARK: - Composer

/// One staged composer file (bytes read at post time, not at pick time).
private struct TaskStagedFile: Identifiable, Sendable {
    let id = UUID()
    let url: URL
    let name: String
    let size: Int
    let contentType: String
}

/// The pinned note composer (TASKS-V2 D-D): posts an internal note with
/// task_id, then uploads staged files against the note (owner_type='note' —
/// the only door for task files, D28). Partial upload failure keeps an honest
/// line pointing at the note in the thread.
@MainActor
private struct NoteComposer: View {
    let mutations: TaskMutations
    let multipart: MultipartClient
    let companyId: String
    let conversationId: String
    let taskId: String
    let onPosted: @MainActor () -> Void

    @State private var body_ = ""
    @State private var staged: [TaskStagedFile] = []
    @State private var posting = false
    @State private var error: String?
    @State private var pickerOpen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !staged.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(staged) { file in
                            Button {
                                staged.removeAll { $0.id == file.id }
                            } label: {
                                HStack(spacing: 4) {
                                    Text(file.name)
                                        .font(.caption)
                                        .lineLimit(1)
                                    Image(systemName: "xmark")
                                        .font(.caption2)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(BrandColor.inset, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Remove \(file.name)")
                        }
                    }
                }
            }
            if let error {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(BrandColor.destructive)
            }
            // Spec 23: paper capsule composer with the 38pt ink send circle.
            HStack(alignment: .bottom, spacing: 8) {
                Button {
                    pickerOpen = true
                } label: {
                    Image(systemName: "paperclip")
                        .foregroundStyle(BrandColor.muted500)
                }
                .buttonStyle(.borderless)
                .disabled(posting || staged.count >= noteFilesMax)
                .accessibilityLabel("Attach files")
                TextField("Add a note for your team", text: $body_, axis: .vertical)
                    .font(.golos(13))
                    .lineLimit(1 ... 4)
                    .onChange(of: body_) { _, next in
                        error = nil
                        if next.count > noteBodyMax {
                            body_ = String(next.prefix(noteBodyMax))
                        }
                    }
                Button {
                    post()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(BrandColor.paper)
                        .frame(width: 38, height: 38)
                        .background(BrandColor.ink, in: Circle())
                }
                .buttonStyle(.borderless)
                .disabled(posting || (body_.isBlank && staged.isEmpty))
                .accessibilityLabel("Post note")
            }
            .padding(.leading, 14)
            .padding(.trailing, 5)
            .padding(.vertical, 5)
            .background(BrandColor.paper, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: Color.black.opacity(0.07), radius: 4, y: 2)
        }
        .padding(.horizontal, 14)
        .padding(.top, 6)
        .padding(.bottom, 10)
        .fileImporter(
            isPresented: $pickerOpen,
            allowedContentTypes: [.item],
            allowsMultipleSelection: true
        ) { result in
            guard case .success(let urls) = result else { return }
            stage(urls)
        }
    }

    private func stage(_ urls: [URL]) {
        let room = noteFilesMax - staged.count
        var oversize = false
        var next: [TaskStagedFile] = []
        for url in urls.prefix(room) {
            let accessing = url.startAccessingSecurityScopedResource()
            defer { if accessing { url.stopAccessingSecurityScopedResource() } }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentTypeKey])
            let size = values?.fileSize ?? -1
            if size > noteFileMaxBytes {
                oversize = true
                continue
            }
            next.append(
                TaskStagedFile(
                    url: url,
                    name: url.lastPathComponent,
                    size: size,
                    contentType: values?.contentType?.preferredMIMEType
                        ?? "application/octet-stream"
                )
            )
        }
        error = {
            if urls.count > room { return "Up to \(noteFilesMax) files per note." }
            if oversize { return "Files must be 25 MB or less." }
            return nil
        }()
        staged += next
    }

    private func post() {
        posting = true
        error = nil
        let text = body_.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = staged
        Task {
            do {
                let note = try await mutations.postNote(
                    companyId: companyId,
                    conversationId: conversationId,
                    body: text,
                    taskId: taskId
                )
                var failures = 0
                for file in files {
                    let accessing = file.url.startAccessingSecurityScopedResource()
                    let bytes = try? Data(contentsOf: file.url)
                    if accessing { file.url.stopAccessingSecurityScopedResource() }
                    guard let bytes else {
                        failures += 1
                        continue
                    }
                    do {
                        try await multipart.uploadNoteFile(
                            companyId: companyId,
                            noteId: note.id,
                            fileName: file.name,
                            contentType: file.contentType,
                            bytes: bytes
                        )
                    } catch {
                        failures += 1
                    }
                }
                body_ = ""
                staged = []
                error = failures > 0
                    ? "The note posted, but \(failures) "
                        + (failures == 1 ? "file" : "files")
                        + " didn't upload. Retry from the note in the thread."
                    : nil
                onPosted()
            } catch {
                self.error = error.userMessage
            }
            posting = false
        }
    }
}

// MARK: - Previews

private let previewMe = Me(
    user_id: "u1",
    display_name: "Sam Carpenter",
    memberships: [
        Membership(
            company_id: "co1",
            name: "Carpenter Roofing",
            role: MemberRole.owner,
            subscription_status: SubscriptionStatus.active
        ),
    ],
    company: nil
)

private let previewDetail = TaskDetail(
    id: "t1",
    company_id: "co1",
    message_id: "m1",
    conversation_id: "cv1",
    title: "Send the quote for the deck repair",
    description: "Cedar boards, two tiers. They want it before the long weekend.",
    assigned_user_id: "u1",
    due_at: "2099-07-20T15:00:00Z",
    created_by_user_id: "u2",
    created_at: "2026-07-14T12:00:00Z",
    updated_at: "2026-07-15T09:00:00Z",
    done: false,
    status: "open",
    assignee: TaskProfile(user_id: "u1", display_name: "Sam Carpenter"),
    created_by: TaskProfile(user_id: "u2", display_name: "Alex Mason"),
    source_message: TaskSourceMessage(
        id: "m1",
        body: "Can you send over the quote for the deck?",
        done_at: nil,
        done_by_user_id: nil,
        created_at: "2026-07-14T11:58:00Z",
        direction: "in"
    ),
    attachments: [],
    activity: [
        TaskActivityItem(
            kind: "event",
            id: "a1",
            created_at: "2026-07-14T12:00:00Z",
            type: "task_created",
            payload: nil,
            actor_user_id: "u2",
            actor: TaskProfile(user_id: "u2", display_name: "Alex Mason"),
            body: nil,
            author_user_id: nil,
            author: nil
        ),
        TaskActivityItem(
            kind: "note",
            id: "a2",
            created_at: "2026-07-15T09:00:00Z",
            type: nil,
            payload: nil,
            actor_user_id: nil,
            actor: nil,
            body: "Measured the yard — 14x20. Drafting the quote now.",
            author_user_id: "u1",
            author: TaskProfile(user_id: "u1", display_name: "Sam Carpenter")
        ),
    ],
    viewer_level: "text"
)

#Preview("Task detail — ready") {
    NavigationStack {
        TaskDetailView(
            graph: AppGraph(),
            companyId: "co1",
            me: previewMe,
            taskId: "t1",
            onOpenConversation: { _, _ in }
        )
        .readyBody(previewDetail)
        .navigationTitle("Task")
        .navigationBarTitleDisplayMode(.inline)
    }
}
