import Observation
import SwiftUI

/// #690: reference chips and the `#` picker.
///
/// A reference is plain text in a note, a task description or a task comment
/// (`#T-142`), so anything that knows nothing about references shows it as
/// typed. These views draw it as a chip once the server says what it points at,
/// and leave it as typed when it points at nothing.
///
/// The colours are one fill and its own label (`limeChip` over `onLimeChip`,
/// `inset` over `ink`); no white is written by hand.

// MARK: - Asking the server what a token points at

/// The server's answers for the tokens on screen, asked for in one batch per
/// text and remembered, so a thread of notes is not a request per bubble.
@MainActor
@Observable
final class ReferenceResolver {
    private let api: TaskReferencesApi
    private let companyId: String
    private(set) var cache = ReferenceCache()

    init(api: TaskReferencesApi, companyId: String) {
        self.api = api
        self.companyId = companyId
    }

    /// Ask about whatever in `text` has not been asked about yet. A failed ask
    /// leaves the tokens unanswered, so they stay plain text and are asked
    /// again next time.
    func resolve(_ text: String) async {
        let missing = cache.missing(parseReferenceTokens(text))
        if missing.isEmpty { return }
        do {
            let answer = try await api.resolve(companyId: companyId, tokens: missing)
            cache.record(asking: missing, answer: answer)
        } catch {
            return
        }
    }
}

/// One resolver per workspace, so a thread, a task and its comments share what
/// the server already said.
@MainActor
final class ReferenceResolverStore {
    static let shared = ReferenceResolverStore()

    private var byCompany: [String: ReferenceResolver] = [:]

    func resolver(api: ApiClient, companyId: String) -> ReferenceResolver {
        if let existing = byCompany[companyId] { return existing }
        let made = ReferenceResolver(api: TaskReferencesApi(api: api), companyId: companyId)
        byCompany[companyId] = made
        return made
    }
}

private struct ReferenceResolverKey: EnvironmentKey {
    static var defaultValue: ReferenceResolver? { nil }
}

extension EnvironmentValues {
    /// Set by the screens that show notes, descriptions and comments. Nil leaves
    /// every `#T-142` as typed.
    var referenceResolver: ReferenceResolver? {
        get { self[ReferenceResolverKey.self] }
        set { self[ReferenceResolverKey.self] = newValue }
    }
}

// MARK: - Opening what a chip points at

enum ReferenceLink {
    static func url(kind: ReferenceKind, id: String) -> URL? {
        URL(string: "loonext-ref://\(kind.rawValue)/\(id)")
    }

    static func target(of url: URL) -> (kind: ReferenceKind, id: String)? {
        guard url.scheme == "loonext-ref",
              let host = url.host,
              let kind = ReferenceKind(rawValue: host)
        else { return nil }
        let id = url.lastPathComponent
        if id.isEmpty || id == "/" { return nil }
        return (kind, id)
    }

    /// The shell's own routes: it pushes the screen above whatever is open and
    /// clears the command.
    @MainActor
    static func open(kind: ReferenceKind, id: String) {
        switch kind {
        case .task: AppRouter.shared.openTaskId = id
        case .contact: AppRouter.shared.openContactId = id
        case .conversation: AppRouter.shared.openConversationId = id
        }
    }
}

// MARK: - Chips

/// The words a chip shows. A finished task carries a check; an open one is the
/// plain label, so a screen reader is not read a shape for every open task.
func referenceChipText(_ chip: ReferenceChipInfo) -> String {
    switch chip.kind {
    case .task: return (chip.done ? "\u{2713} " : "") + chip.label
    case .contact, .conversation: return chip.label
    }
}

private func chipFill(_ kind: ReferenceKind) -> Color {
    kind == .task ? BrandColor.limeChip : BrandColor.inset
}

private func chipLabelColor(_ kind: ReferenceKind) -> Color {
    kind == .task ? BrandColor.onLimeChip : BrandColor.ink
}

/// The text with each resolved token swapped for its chip. A token the server
/// did not answer for stays exactly as typed.
func referenceAttributedText(_ text: String, cache: ReferenceCache?) -> AttributedString {
    guard let cache else { return AttributedString(text) }
    let chars = Array(text)
    var out = AttributedString()
    var cursor = 0
    for token in parseReferenceTokens(text) {
        guard let chip = cache.chip(for: token) else { continue }
        if token.start > cursor {
            out += AttributedString(String(chars[cursor ..< token.start]))
        }
        var run = AttributedString(" " + referenceChipText(chip) + " ")
        run.backgroundColor = chipFill(chip.kind)
        run.foregroundColor = chipLabelColor(chip.kind)
        run.link = ReferenceLink.url(kind: chip.kind, id: chip.targetId)
        out += run
        cursor = token.end
    }
    if cursor < chars.count {
        out += AttributedString(String(chars[cursor...]))
    }
    return out
}

/// A note, description or comment with its references drawn as chips. Tapping
/// one opens what it points at.
struct ReferencedText: View {
    let text: String
    let font: Font
    let color: Color
    var strikethrough: Bool = false

    @Environment(\.referenceResolver) private var resolver

    var body: some View {
        Text(referenceAttributedText(text, cache: resolver?.cache))
            .strikethrough(strikethrough)
            .font(font)
            .foregroundStyle(color)
            .tint(BrandColor.onLimeChip)
            .environment(
                \.openURL,
                OpenURLAction { url in
                    guard let target = ReferenceLink.target(of: url) else {
                        return .systemAction
                    }
                    MainActor.assumeIsolated {
                        ReferenceLink.open(kind: target.kind, id: target.id)
                    }
                    return .handled
                }
            )
            .task(id: text) { await resolver?.resolve(text) }
    }
}

/// One chip per distinct reference in `text`, under a field that is being
/// edited (a task description), where the text itself stays plain to type in.
struct ReferenceChipRow: View {
    let text: String

    @Environment(\.referenceResolver) private var resolver

    private var chips: [ReferenceChipInfo] {
        guard let cache = resolver?.cache else { return [] }
        var out: [ReferenceChipInfo] = []
        for token in parseReferenceTokens(text) {
            guard let chip = cache.chip(for: token) else { continue }
            if !out.contains(chip) { out.append(chip) }
        }
        return out
    }

    var body: some View {
        let found = chips
        Group {
            if !found.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(found, id: \.targetId) { chip in
                            Button {
                                ReferenceLink.open(kind: chip.kind, id: chip.targetId)
                            } label: {
                                Text(referenceChipText(chip))
                                    .font(.golos(12, weight: .medium))
                                    .foregroundStyle(chipLabelColor(chip.kind))
                                    .lineLimit(1)
                                    .padding(.horizontal, 11)
                                    .padding(.vertical, 6)
                                    .background(chipFill(chip.kind), in: Capsule())
                                    .frame(minHeight: 44)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .task(id: text) { await resolver?.resolve(text) }
    }
}

// MARK: - The picker

/// The rows the `#` picker offers for what has been typed so far. Tasks come
/// from the list's own search (which reads "T-142" and "142" too); contacts and
/// conversations from global search. With nothing typed, the member's own open
/// tasks. `includeRecords` is false where only a task makes sense (a link).
func referenceSearch(
    tasksApi: TasksApi,
    searchApi: SearchApi,
    companyId: String,
    query: String,
    includeRecords: Bool
) async -> [ReferencePick] {
    var typed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    while typed.hasPrefix("#") { typed.removeFirst() }
    let trimmed = String(typed.prefix(taskSearchMax))
    let wantsRecords = includeRecords && !trimmed.isEmpty
    async let taskPage: Page<TaskItem>? = try? await tasksApi.list(
        companyId: companyId,
        filters: TaskListFilters(q: trimmed.isEmpty ? nil : trimmed),
        limit: 8
    )
    async let found: SearchResult? = searchRecords(
        searchApi,
        companyId: companyId,
        query: trimmed,
        wanted: wantsRecords
    )
    let tasks = await taskPage
    let records = await found
    return referencePicks(tasks: tasks?.data ?? [], search: records)
}

private func searchRecords(
    _ api: SearchApi,
    companyId: String,
    query: String,
    wanted: Bool
) async -> SearchResult? {
    if !wanted { return nil }
    return try? await api.search(companyId: companyId, q: query)
}

/// The closure the text boxes hold, built once where the graph is known.
@MainActor
func referenceSearchClosure(
    graph: AppGraph,
    companyId: String,
    includeRecords: Bool = true
) -> @MainActor (String) async -> [ReferencePick] {
    let tasksApi = graph.tasksApi
    let searchApi = graph.searchApi
    return { query in
        await referenceSearch(
            tasksApi: tasksApi,
            searchApi: searchApi,
            companyId: companyId,
            query: query,
            includeRecords: includeRecords
        )
    }
}

@MainActor
struct ReferencePickerSheet: View {
    let search: @MainActor (String) async -> [ReferencePick]
    /// A task id to leave out (a task cannot link to itself).
    var excludeId: String? = nil
    let onPick: @MainActor (ReferencePick) -> Void
    let onCancel: @MainActor () -> Void

    @State private var query = ""
    @State private var picks: [ReferencePick] = []
    @State private var loading = true

    @Environment(\.appLocale) private var appLocale

    private func icon(_ kind: ReferenceKind) -> String {
        switch kind {
        case .task: return "checklist"
        case .contact: return "person"
        case .conversation: return "bubble.left"
        }
    }

    private var shown: [ReferencePick] {
        picks.filter { $0.targetId != excludeId }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                results
            }
            .background(BrandColor.canvas.ignoresSafeArea())
            .navigationTitle(AppStrings.translate(appLocale, "taskRefs.pickerTitle"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onCancel() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .task(id: query) {
            if !query.isEmpty {
                try? await Task.sleep(for: .milliseconds(250))
                if Task.isCancelled { return }
            }
            loading = true
            let found = await search(query)
            if Task.isCancelled { return }
            picks = found
            loading = false
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(14, weight: .medium))
                .foregroundStyle(BrandColor.muted400)
            TextField(
                AppStrings.translate(appLocale, "taskRefs.pickerSearch"),
                text: $query
            )
            .font(.golos(14))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 10)
        .background(BrandColor.paper, in: Capsule())
        .padding(.horizontal, 18)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var results: some View {
        if loading && picks.isEmpty {
            CenteredLoading()
        } else if shown.isEmpty {
            Text(AppStrings.translate(appLocale, "taskRefs.pickerEmpty"))
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted500)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 24)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        } else {
            ScrollView {
                VStack(spacing: 0) {
                    ForEach(shown) { pick in
                        Button {
                            onPick(pick)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: icon(pick.kind))
                                    .font(.scaled(15, weight: .medium))
                                    .foregroundStyle(BrandColor.muted700)
                                    .frame(width: 24)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(pick.title)
                                        .font(.golos(14, weight: .semibold))
                                        .foregroundStyle(BrandColor.ink)
                                        .lineLimit(1)
                                    if let subtitle = pick.subtitle, !subtitle.isEmpty {
                                        Text(subtitle)
                                            .font(.golos(12))
                                            .foregroundStyle(BrandColor.muted500)
                                            .lineLimit(1)
                                    }
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 18)
                            .padding(.vertical, 10)
                            .frame(minHeight: 44)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        RowDivider()
                    }
                }
            }
        }
    }
}

extension View {
    /// The `#` picker as a sheet. Choosing a row closes it and hands the row back.
    func referencePickerSheet(
        isPresented: Binding<Bool>,
        search: @escaping @MainActor (String) async -> [ReferencePick],
        excludeId: String? = nil,
        onPick: @escaping @MainActor (ReferencePick) -> Void
    ) -> some View {
        sheet(isPresented: isPresented) {
            ReferencePickerSheet(
                search: search,
                excludeId: excludeId,
                onPick: { pick in
                    isPresented.wrappedValue = false
                    onPick(pick)
                },
                onCancel: { isPresented.wrappedValue = false }
            )
        }
    }
}
