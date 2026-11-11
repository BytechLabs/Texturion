import SwiftUI

/// #735: the Trash, native. Deleted conversations, messages, calls and voicemails
/// wait here for 30 days. Each row has the two things a person can do to it:
/// Restore (the safe direction, one tap, reported by a toast) and Delete forever
/// (the one with no way back, so it asks first through the shared destructive
/// confirmation and names what will be erased).
///
/// Reached from the account sheet's Trash row, the thread's "View Trash" and the
/// delete toast, all through `AppRouter.openTrash`; the shell presents it as a sheet.
/// Host-agnostic: it carries its own header, like `NotificationsView`.
/// Web twin: `components/settings/trash-list.tsx`.
@MainActor
struct TrashView: View {
    let graph: AppGraph
    let companyId: String
    let meUserId: String

    @State private var model: TrashModel
    @State private var purging: TrashRow?
    @State private var refreshKey = 0
    @State private var notice: ThreadNotice?
    @State private var noticeSeq: Int64 = 0
    @State private var noticeDismissTask: Task<Void, Never>?

    @Environment(\.appLocale) private var appLocale

    init(graph: AppGraph, companyId: String, meUserId: String) {
        self.graph = graph
        self.companyId = companyId
        self.meUserId = meUserId
        _model = State(initialValue: TrashModel(api: graph.api, companyId: companyId))
    }

    private func t(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    var body: some View {
        let locale = appLocale
        return VStack(spacing: 0) {
            TrashHeader()
            content
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .overlay(alignment: .bottom) { noticeToast }
        .confirmDialog(
            t("trash.deleteForeverTitle"),
            item: $purging,
            message: { row in TrashText.deleteForeverBody(row, locale: locale) },
            confirmLabel: t("trash.deleteForeverConfirm"),
            cancelLabel: t("trash.keep")
        ) { row in
            purge(row)
        }
        .task(id: "\(companyId)#\(refreshKey)") { await model.refresh() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ListSkeleton(rows: 5, lines: 2)
        case .failed(let message):
            LoadError(message: message) {
                model.prepareRetry()
                refreshKey += 1
            }
        case .ready:
            if model.rows.isEmpty {
                EmptyState(
                    title: t("trash.emptyTitle"),
                    description: t("trash.emptyBody"),
                    systemImage: "trash",
                    fill: true
                )
            } else {
                TrashRowsList(
                    rows: model.rows,
                    meUserId: meUserId,
                    memberNames: model.memberNames,
                    busy: model.busy,
                    hasMore: model.nextCursor != nil,
                    loadingMore: model.loadingMore,
                    onRestore: { restore($0) },
                    onPurge: { purging = $0 },
                    onLoadMore: { loadMore() }
                )
            }
        }
    }

    private func restore(_ row: TrashRow) {
        Task {
            if let text = await model.restore(row, locale: appLocale) { show(text) }
        }
    }

    private func purge(_ row: TrashRow) {
        Task {
            if let text = await model.purge(row, locale: appLocale) { show(text) }
        }
    }

    private func loadMore() {
        Task { await model.loadMore() }
    }

    private func show(_ text: String) {
        noticeSeq += 1
        let shown = ThreadNotice(id: noticeSeq, text: text)
        notice = shown
        noticeDismissTask?.cancel()
        let shownSeq = shown.id
        noticeDismissTask = Task {
            try? await Task.sleep(for: .seconds(shown.seconds))
            if !Task.isCancelled, noticeSeq == shownSeq { notice = nil }
        }
    }

    @ViewBuilder
    private var noticeToast: some View {
        if let shown = notice {
            ToastView(notice: shown) { notice = nil }
                .padding(.bottom, 12)
        }
    }
}

/// The title and the one sentence that says how long things wait.
struct TrashHeader: View {
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(AppStrings.translate(appLocale, "trash.title"))
                .font(.display(24))
                .kerning(-0.2)
                .foregroundStyle(BrandColor.ink)
                .accessibilityAddTraits(.isHeader)
            Text(AppStrings.translate(appLocale, "trash.description"))
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted700)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .padding(.bottom, 12)
    }
}

/// The rows and the Show more button, with no network: the screen draws it from the
/// model and the #238 accessibility audit draws it from fixtures.
struct TrashRowsList: View {
    let rows: [TrashRow]
    let meUserId: String
    let memberNames: [String: String]
    let busy: Set<String>
    let hasMore: Bool
    let loadingMore: Bool
    let onRestore: @MainActor (TrashRow) -> Void
    let onPurge: @MainActor (TrashRow) -> Void
    let onLoadMore: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 13) {
                PaperCard {
                    ForEach(Array(rows.enumerated()), id: \.element.rowKey) { index, row in
                        if index > 0 { RowDivider() }
                        TrashRowView(
                            row: row,
                            meUserId: meUserId,
                            memberNames: memberNames,
                            busy: busy.contains(row.rowKey),
                            onRestore: { onRestore(row) },
                            onPurge: { onPurge(row) }
                        )
                    }
                }
                if hasMore {
                    Button {
                        onLoadMore()
                    } label: {
                        Text(AppStrings.translate(
                            appLocale,
                            loadingMore ? "trash.loadingMore" : "trash.loadMore"
                        ))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                        .frame(maxWidth: .infinity, minHeight: 44)
                        // A plain button is only as tappable as its drawn text without this.
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(loadingMore)
                }
            }
            .padding(.horizontal, 18)
            .padding(.bottom, 24)
        }
    }
}

/// One deleted item: who and what, what is inside, who deleted it and how long is
/// left, then Restore and Delete forever.
struct TrashRowView: View {
    let row: TrashRow
    let meUserId: String
    let memberNames: [String: String]
    let busy: Bool
    let onRestore: @MainActor () -> Void
    let onPurge: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let subject = TrashText.subject(row, locale: appLocale)
        return VStack(alignment: .leading, spacing: 6) {
            Text(subject)
                .font(.golos(15, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(TrashText.detailLabel(row, locale: appLocale))
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted700)
                .lineLimit(2)
            Text(TrashText.metaLine(
                row,
                locale: appLocale,
                meUserId: meUserId,
                memberNames: memberNames
            ))
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted700)
            HStack(spacing: 8) {
                Button {
                    onRestore()
                } label: {
                    Text(AppStrings.translate(appLocale, "trash.restore"))
                        .frame(minHeight: 32)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel(
                    AppStrings.translate(appLocale, "trash.restoreAria", ["what": subject])
                )
                Button {
                    onPurge()
                } label: {
                    Text(AppStrings.translate(appLocale, "trash.deleteForever"))
                        .font(.golos(13, weight: .semibold))
                        .foregroundStyle(BrandColor.destructive)
                        .frame(minHeight: 44)
                        .padding(.horizontal, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    AppStrings.translate(appLocale, "trash.deleteForeverAria", ["what": subject])
                )
            }
            .disabled(busy)
            .padding(.top, 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - #238 accessibility audit

/// The Trash with one row of each kind, for the accessibility audit and its
/// light and dark screenshots. No network, no model.
@MainActor
func trashListFixture() -> some View {
    TrashAuditScreen()
}

@MainActor
private struct TrashAuditScreen: View {
    private static func isoAfter(days: Double) -> String {
        ISO8601DateFormatter().string(from: Date().addingTimeInterval(days * 86_400))
    }

    private var rows: [TrashRow] {
        [
            TrashRow(
                id: "t1",
                kind: "conversation",
                deleted_at: Self.isoAfter(days: -1),
                deleted_by_user_id: "u-me",
                purge_after: Self.isoAfter(days: 29),
                conversation: TrashDetails(
                    contact_name: "Dana Whitcomb",
                    contact_phone: "+14165550134",
                    message_count: 12
                )
            ),
            TrashRow(
                id: "t2",
                kind: "message",
                deleted_at: Self.isoAfter(days: -3),
                deleted_by_user_id: "u-other",
                purge_after: Self.isoAfter(days: 27),
                message: TrashDetails(
                    contact_phone: "+14155550188",
                    conversation_id: "c2",
                    direction: MessageDirection.outbound,
                    snippet: "Thursday"
                )
            ),
            TrashRow(
                id: "t3",
                kind: "call",
                deleted_at: Self.isoAfter(days: -10),
                purge_after: Self.isoAfter(days: 20),
                call: TrashDetails(
                    contact_name: "Marta Reyes",
                    outcome: CallOutcome.missed,
                    has_voicemail: true
                )
            ),
            TrashRow(
                id: "t4",
                kind: "voicemail",
                deleted_at: Self.isoAfter(days: -29),
                deleted_by_user_id: "u-me",
                purge_after: Self.isoAfter(days: 0.5),
                voicemail: TrashDetails(
                    contact_phone: "+14155550134",
                    voicemail_seconds: 42
                )
            ),
        ]
    }

    var body: some View {
        VStack(spacing: 0) {
            TrashHeader()
            TrashRowsList(
                rows: rows,
                meUserId: "u-me",
                memberNames: ["u-other": "Ari Bell"],
                busy: [],
                hasMore: true,
                loadingMore: false,
                onRestore: { _ in },
                onPurge: { _ in },
                onLoadMore: {}
            )
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
    }
}
