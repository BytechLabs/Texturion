import Observation
import SwiftUI

/// #689 G / #690: the ONE Filters control on the Tasks screen, and the compact
/// switcher for saved views.
///
/// Zen of Clarity: the screen keeps a single quiet row (Filters, Sort, Views)
/// and every filter lives one tap behind Filters, so the list stays the
/// subject. A filter count on the button says something is narrowing the list
/// without drawing five chips.

// MARK: - How many filters are narrowing the list

/// Filters in force, not counting the tab, the sort or the layout.
func taskFilterCount(_ state: TaskViewState) -> Int {
    var count = 0
    if state.assigneeUserId != nil || state.unassigned { count += 1 }
    if state.due != nil || state.meta.dueAfter != nil || state.meta.dueBefore != nil { count += 1 }
    if !state.meta.priority.isEmpty { count += 1 }
    if state.meta.tagId != nil { count += 1 }
    if state.meta.contactId != nil { count += 1 }
    if state.meta.createdBy != nil { count += 1 }
    if state.meta.source != nil { count += 1 }
    if state.meta.hasAttachments { count += 1 }
    if state.meta.hasReferences { count += 1 }
    return count
}

// MARK: - Saved views for tasks

@MainActor
@Observable
final class TaskViewsController {
    private let api: SavedViewsApi
    private let companyId: String

    private(set) var views: [SavedView] = []
    private(set) var defaultViewId: String?
    private(set) var loaded = false

    init(api: SavedViewsApi, companyId: String) {
        self.api = api
        self.companyId = companyId
    }

    func load() async {
        do {
            let page = try await api.list(companyId: companyId, surface: "tasks")
            views = page.data
            defaultViewId = page.defaults.tasks
            loaded = true
        } catch {
            return
        }
    }

    /// Nil when saved; otherwise the sentence to show.
    func save(name: String, filters: [String: JSONValue], shared: Bool) async -> String? {
        do {
            _ = try await api.create(
                companyId: companyId,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                filters: filters,
                shared: shared,
                surface: "tasks"
            )
            await load()
            return nil
        } catch {
            return error.userMessage
        }
    }

    func rename(id: String, name: String) async -> String? {
        do {
            _ = try await api.rename(
                companyId: companyId,
                id: id,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            await load()
            return nil
        } catch {
            return error.userMessage
        }
    }

    func remove(id: String) async {
        try? await api.delete(companyId: companyId, id: id)
        await load()
    }

    func setDefault(_ id: String?) async {
        try? await api.setDefault(companyId: companyId, viewId: id, surface: "tasks")
        defaultViewId = id
    }

    func share(id: String, shared: Bool) async {
        _ = try? await api.share(companyId: companyId, id: id, shared: shared)
        await load()
    }
}

/// Name a view (save) or change its name (rename). The name is already
/// suggested when saving, because typing one is the whole friction between
/// arranging a useful screen and keeping it.
@MainActor
struct TaskViewNameSheet: View {
    let titleKey: String
    let note: String?
    let canShare: Bool
    let onSubmit: @MainActor (_ name: String, _ shared: Bool) async -> String?
    let onClose: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var name: String
    @State private var shared = false
    @State private var error: String?
    @State private var saving = false

    init(
        titleKey: String,
        initialName: String,
        note: String?,
        canShare: Bool,
        onSubmit: @escaping @MainActor (_ name: String, _ shared: Bool) async -> String?,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.titleKey = titleKey
        self.note = note
        self.canShare = canShare
        self.onSubmit = onSubmit
        self.onClose = onClose
        _name = State(initialValue: initialName)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(AppStrings.translate(appLocale, "inbox.viewNameLabel"), text: $name)
                } footer: {
                    if let note { Text(note) }
                }
                if canShare {
                    Section {
                        Toggle(
                            AppStrings.translate(appLocale, "inbox.viewShareToggle"),
                            isOn: $shared
                        )
                    } footer: {
                        Text(AppStrings.translate(appLocale, "inbox.viewShareNote"))
                    }
                }
                if let error {
                    Section { Text(error).foregroundStyle(BrandColor.destructive) }
                }
            }
            .navigationTitle(AppStrings.translate(appLocale, titleKey))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onClose() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "common.save")) {
                        saving = true
                        Task {
                            let failure = await onSubmit(name, shared)
                            saving = false
                            if let failure { error = failure } else { onClose() }
                        }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - The Filters sheet

/// How the due filter is chosen. The relative chips are the old ones; a range is
/// two dates.
private enum DueChoice: String, CaseIterable, Identifiable {
    case any
    case overdue
    case today
    case week
    case range

    var id: String { rawValue }

    var labelKey: String {
        switch self {
        case .any: return "taskRefs.dueAny"
        case .overdue: return "contactsTasks.dueOverdue"
        case .today: return "contactsTasks.dueToday"
        case .week: return "contactsTasks.dueThisWeek"
        case .range: return "taskRefs.dueRange"
        }
    }
}

@MainActor
struct TaskFiltersSheet: View {
    let members: [Member]
    let meUserId: String
    let tags: [Tag]
    let contactSearch: @MainActor (String) async -> [ReferencePick]
    let contactName: String?
    let onApply: @MainActor (_ state: TaskViewState, _ contactName: String?) -> Void
    let onClose: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    @State private var draft: TaskViewState
    @State private var draftContactName: String?
    @State private var contactPickerOpen = false

    init(
        initial: TaskViewState,
        contactName: String?,
        members: [Member],
        meUserId: String,
        tags: [Tag],
        contactSearch: @escaping @MainActor (String) async -> [ReferencePick],
        onApply: @escaping @MainActor (_ state: TaskViewState, _ contactName: String?) -> Void,
        onClose: @escaping @MainActor () -> Void
    ) {
        self.members = members
        self.meUserId = meUserId
        self.tags = tags
        self.contactSearch = contactSearch
        self.contactName = contactName
        self.onApply = onApply
        self.onClose = onClose
        _draft = State(initialValue: initial)
        _draftContactName = State(initialValue: contactName)
    }

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private func memberLabel(_ member: Member) -> String {
        if member.user_id == meUserId { return t("contactsTasks.you") }
        return member.display_name.isBlank ? t("contactsTasks.teammate") : member.display_name
    }

    private var activeMembers: [Member] {
        members.filter { $0.deactivated_at == nil }
    }

    var body: some View {
        NavigationStack {
            Form {
                peopleSection
                dueSection
                detailsSection
                layoutSection
            }
            .navigationTitle(t("taskRefs.filtersTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(t("common.cancel")) { onClose() }
                }
                ToolbarItem(placement: .principal) {
                    Button(t("taskRefs.filtersClear")) { clearAll() }
                        .disabled(taskFilterCount(draft) == 0)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(t("taskRefs.filtersApply")) {
                        onApply(draft, draft.meta.contactId == nil ? nil : draftContactName)
                        onClose()
                    }
                }
            }
            .referencePickerSheet(isPresented: $contactPickerOpen, search: contactSearch) { pick in
                draft.meta.contactId = pick.targetId
                draftContactName = pick.title
            }
        }
        .presentationDetents([.large])
    }

    private func clearAll() {
        draft.assigneeUserId = nil
        draft.unassigned = false
        draft.due = nil
        draft.meta = TaskMetaFilters(sort: draft.meta.sort, statusOnly: draft.meta.statusOnly)
        draftContactName = nil
    }

    // MARK: Sections

    private var peopleSection: some View {
        Section(t("taskRefs.filterPeople")) {
            Picker(t("contactsTasks.assignee"), selection: assigneeChoice) {
                Text(t("taskRefs.filterAnyone")).tag(AssigneeChoice.anyone)
                Text(t("contactsTasks.unassigned")).tag(AssigneeChoice.unassigned)
                ForEach(activeMembers, id: \.user_id) { member in
                    Text(memberLabel(member)).tag(AssigneeChoice.member(member.user_id))
                }
            }
            Picker(t("taskRefs.filterCreatedBy"), selection: createdByBinding) {
                Text(t("taskRefs.filterAnyone")).tag(String?.none)
                ForEach(activeMembers, id: \.user_id) { member in
                    Text(memberLabel(member)).tag(Optional(member.user_id))
                }
            }
            contactRow
        }
    }

    private var contactRow: some View {
        HStack {
            Button {
                contactPickerOpen = true
            } label: {
                HStack {
                    Text(t("taskRefs.filterContact"))
                        .foregroundStyle(BrandColor.ink)
                    Spacer()
                    Text(
                        draft.meta.contactId == nil
                            ? t("taskRefs.filterAnyContact")
                            : (draftContactName ?? t("taskRefs.filterContactSelected"))
                    )
                    .foregroundStyle(BrandColor.muted500)
                    .lineLimit(1)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if draft.meta.contactId != nil {
                Button {
                    draft.meta.contactId = nil
                    draftContactName = nil
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(BrandColor.muted300)
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(t("taskRefs.filterClearContact"))
            }
        }
    }

    private var dueSection: some View {
        Section(t("taskRefs.filterDue")) {
            Picker(t("taskRefs.filterDue"), selection: dueChoice) {
                ForEach(DueChoice.allCases) { choice in
                    Text(t(choice.labelKey)).tag(choice)
                }
            }
            if dueChoice.wrappedValue == .range {
                DatePicker(
                    t("taskRefs.dueFrom"),
                    selection: rangeFrom,
                    displayedComponents: .date
                )
                DatePicker(
                    t("taskRefs.dueTo"),
                    selection: rangeTo,
                    displayedComponents: .date
                )
            }
        }
    }

    private var detailsSection: some View {
        Section(t("taskRefs.filterDetails")) {
            Picker(t("taskRefs.filterSource"), selection: $draft.meta.source) {
                Text(t("taskRefs.filterAnySource")).tag(String?.none)
                ForEach(TaskSourceChoice.all, id: \.self) { source in
                    Text(t(TaskSourceChoice.labelKey(source))).tag(Optional(source))
                }
            }
            Toggle(t("taskRefs.filterHasAttachments"), isOn: $draft.meta.hasAttachments)
            Toggle(t("taskRefs.filterHasReferences"), isOn: $draft.meta.hasReferences)
            ForEach(TaskPriority.rankedForMenus) { priority in
                Toggle(t(priority.labelKey), isOn: priorityBinding(priority))
            }
            if !tags.isEmpty {
                Picker(t("contactsTasks.label"), selection: $draft.meta.tagId) {
                    Text(t("taskRefs.filterAnyLabel")).tag(String?.none)
                    ForEach(tags, id: \.id) { tag in
                        Text(tag.name).tag(Optional(tag.id))
                    }
                }
            }
        }
    }

    private var layoutSection: some View {
        Section(t("taskRefs.filterLayout")) {
            Picker(t("taskRefs.groupTitle"), selection: $draft.group) {
                ForEach(TaskGroup.all, id: \.self) { group in
                    Text(t(TaskGroup.labelKey(group))).tag(group)
                }
            }
        }
    }

    // MARK: Bindings

    private enum AssigneeChoice: Hashable {
        case anyone
        case unassigned
        case member(String)
    }

    private var assigneeChoice: Binding<AssigneeChoice> {
        Binding(
            get: {
                if draft.unassigned { return .unassigned }
                if let id = draft.assigneeUserId { return .member(id) }
                return .anyone
            },
            set: { choice in
                switch choice {
                case .anyone:
                    draft.unassigned = false
                    draft.assigneeUserId = nil
                case .unassigned:
                    draft.unassigned = true
                    draft.assigneeUserId = nil
                case .member(let id):
                    draft.unassigned = false
                    draft.assigneeUserId = id
                }
            }
        )
    }

    private var createdByBinding: Binding<String?> {
        Binding(
            get: { draft.meta.createdBy == "me" ? meUserId : draft.meta.createdBy },
            set: { draft.meta.createdBy = $0 }
        )
    }

    private func priorityBinding(_ priority: TaskPriority) -> Binding<Bool> {
        Binding(
            get: { draft.meta.priority.contains(priority.rawValue) },
            set: { on in
                if on {
                    if !draft.meta.priority.contains(priority.rawValue) {
                        draft.meta.priority.append(priority.rawValue)
                    }
                } else {
                    draft.meta.priority.removeAll { $0 == priority.rawValue }
                }
            }
        )
    }

    private var dueChoice: Binding<DueChoice> {
        Binding(
            get: {
                if draft.meta.dueAfter != nil || draft.meta.dueBefore != nil { return .range }
                switch draft.due {
                case .overdue?: return .overdue
                case .today?: return .today
                case .week?: return .week
                case nil: return .any
                }
            },
            set: { choice in
                draft.due = nil
                draft.meta.dueAfter = nil
                draft.meta.dueBefore = nil
                switch choice {
                case .any: break
                case .overdue: draft.due = .overdue
                case .today: draft.due = .today
                case .week: draft.due = .week
                case .range:
                    let calendar = Calendar.current
                    let start = calendar.startOfDay(for: Date())
                    let end = calendar.date(byAdding: .day, value: 7, to: start) ?? start
                    draft.meta.dueAfter = isoOffsetString(start, timeZone: calendar.timeZone)
                    draft.meta.dueBefore = isoOffsetString(end, timeZone: calendar.timeZone)
                }
            }
        )
    }

    /// The range is stored as a start instant and an exclusive end instant;
    /// the pickers show whole days, the last one inclusive.
    private var rangeFrom: Binding<Date> {
        Binding(
            get: { parseWireTimestamp(draft.meta.dueAfter) ?? Calendar.current.startOfDay(for: Date()) },
            set: { date in
                let calendar = Calendar.current
                draft.meta.dueAfter = isoOffsetString(
                    calendar.startOfDay(for: date),
                    timeZone: calendar.timeZone
                )
            }
        )
    }

    private var rangeTo: Binding<Date> {
        Binding(
            get: {
                let calendar = Calendar.current
                guard let end = parseWireTimestamp(draft.meta.dueBefore) else {
                    return calendar.startOfDay(for: Date())
                }
                return calendar.date(byAdding: .day, value: -1, to: end) ?? end
            },
            set: { date in
                let calendar = Calendar.current
                let day = calendar.startOfDay(for: date)
                let next = calendar.date(byAdding: .day, value: 1, to: day) ?? day
                draft.meta.dueBefore = isoOffsetString(next, timeZone: calendar.timeZone)
            }
        )
    }
}
