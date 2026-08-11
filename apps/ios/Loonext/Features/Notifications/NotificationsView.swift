import SwiftUI

/// The derived notifications feed (D24): per-type icons, unread dots, relative
/// times, cursor pagination. Tap = optimistic watermark advance (that item and
/// everything older flips read; newer stays unread) + deep link into the
/// conversation. 'Mark all read' advances the watermark to now. The unread
/// count stays live via the company realtime channel plus a 60s poll.
///
/// Host-agnostic: carries its own header row (mirrors the Android
/// NotificationsScreen), so it drops into a sheet or a pushed screen as-is.
@MainActor
struct NotificationsView: View {
    let graph: AppGraph
    let companyId: String
    /// #358: whose read state this screen cares about. The read.* events ride
    /// the company topic, so a colleague's reading must be ignored.
    let meUserId: String
    let onOpenConversation: @MainActor (String) -> Void

    @State private var model: NotificationsFeedModel
    @State private var refreshKey = 0

    @Environment(\.appLocale) private var appLocale

    init(
        graph: AppGraph,
        companyId: String,
        meUserId: String,
        onOpenConversation: @escaping @MainActor (String) -> Void
    ) {
        self.graph = graph
        self.companyId = companyId
        self.meUserId = meUserId
        self.onOpenConversation = onOpenConversation
        _model = State(initialValue: NotificationsFeedModel(
            api: NotificationsFeedApi(api: graph.api),
            companyId: companyId
        ))
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                CenteredLoading()

            case .failed(let message):
                CenteredError(message: message) {
                    model.prepareRetry()
                    refreshKey += 1
                }

            case .ready:
                feed
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .overlay(alignment: .bottom) { toastNotice }
        .animation(.default, value: model.toastKey)
        .task(id: "\(companyId)#\(refreshKey)") { await model.refresh() }
        // The feed is derived from messages/conversations/tasks/calls — any of
        // those moving can add an item or change the badge.
        .task(id: companyId) {
            for await event in await graph.realtime.events() {
                // #358: `read.` is this person's own read state moving,
                // probably on another device. Filtered to them: the event
                // rides the company topic, so without the check every member
                // would refetch whenever anybody opened a thread.
                let mine = event.event.hasPrefix("read.")
                    && readEventUserId(event.payload) == meUserId
                if mine
                    || event.event.hasPrefix("message.")
                    || event.event.hasPrefix("conversation.")
                    || event.event.hasPrefix("task.")
                    || event.event.hasPrefix("call.")
                {
                    refreshKey += 1
                }
            }
        }
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                refreshKey += 1
            }
        }
        // #215 Part A: rebuild the feed on foreground so an item derived from a
        // frame missed while backgrounded appears (and the badge corrects).
        .resyncOnForeground { refreshKey += 1 }
        // 60s badge poll — the backstop when realtime is quiet or degraded.
        .task(id: companyId) {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if Task.isCancelled { return }
                await model.pollUnread()
            }
        }
    }

    private var feed: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(AppStrings.translate(appLocale, "inbox.notificationsHeading"))
                    .font(.display(24))
                    .kerning(-0.2)
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                Button {
                    model.markAllRead()
                } label: {
                    Text(AppStrings.translate(appLocale, "inbox.notifReadAll"))
                        .font(.golos(11.5, weight: .bold))
                        .foregroundStyle(model.hasUnread ? BrandColor.olive : BrandColor.muted300)
                }
                .buttonStyle(.plain)
                .disabled(!model.hasUnread)
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 12)

            // #343: before the list AND before the caught-up line — "all
            // caught up" is the exact wrong thing to read when alerts have
            // been switched off underneath you.
            NotificationPauseNotice(pause: model.alertPause)

            if model.items.isEmpty {
                Text(AppStrings.translate(appLocale, "inbox.notifCaughtUp"))
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 13) {
                        PaperCard {
                            ForEach(Array(model.items.enumerated()), id: \.element.feedKey) { index, row in
                                if index > 0 { RowDivider() }
                                NotificationRow(row: row) {
                                    model.markItemRead(row)
                                    if let conversationId = row.conversation_id {
                                        onOpenConversation(conversationId)
                                    }
                                }
                            }
                        }
                        if model.nextCursor != nil {
                            Button {
                                model.loadOlder()
                            } label: {
                                Text(
                                    AppStrings.translate(
                                        appLocale,
                                        model.loadingMore
                                            ? "inbox.notifLoadingOlder"
                                            : "inbox.notifShowOlder"
                                    )
                                )
                                    .font(.golos(12, weight: .semibold))
                                    .foregroundStyle(BrandColor.olive)
                            }
                            .buttonStyle(.plain)
                            .disabled(model.loadingMore)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 4)
                        }
                        Text(AppStrings.translate(appLocale, "inbox.notifMirrorHint"))
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted700)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 7)
                            .background(BrandColor.insetDeep, in: Capsule())
                            .frame(maxWidth: .infinity)
                    }
                    .padding(.horizontal, 18)
                    .padding(.bottom, 24)
                }
                // Pull to refresh, matching Android. Awaiting the real refresh
                // settles the spinner when the feed lands.
                .refreshable { await model.refresh() }
            }
        }
    }

    @ViewBuilder
    private var toastNotice: some View {
        if let toastKey = model.toastKey {
            Text(AppStrings.translate(appLocale, toastKey))
                .font(.subheadline)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect()
                .padding(.bottom, 16)
                .transition(.opacity)
        }
    }
}

private struct NotificationRow: View {
    let row: NotificationItem
    let onTap: @MainActor () -> Void

    // Read from the environment rather than taken as a parameter: this row is
    // built by two `#Preview` blocks, and a new required argument breaks a
    // preview in a way only CI's `Gate / iOS` can see.
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        // Every derived type today links to its conversation; a future type
        // without one renders disabled instead of dead-tapping.
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: iconFor(row.type))
                    .font(.scaled(15))
                    .foregroundStyle(iconTint(row.type))
                    .frame(width: 38, height: 38)
                    .background(iconWell(row.type), in: Circle())
                Text(summaryFor(row, appLocale))
                    .font(.golos(13, weight: row.unread ? .bold : .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .padding(.top, 3)
                Spacer(minLength: 8)
                Text(relativeTime(row.created_at))
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted300)
                    .padding(.top, 5)
                if row.unread {
                    AttentionDot()
                        .padding(.top, 8)
                }
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 13)
            .contentShape(Rectangle())
            .opacity(row.unread ? 1 : 0.7)
        }
        .buttonStyle(.plain)
        .disabled(row.conversation_id == nil)
        // Announce read/unread to VoiceOver — the visual AttentionDot + bold
        // weight that convey it to sighted users aren't otherwise exposed.
        .accessibilityValue(
            row.unread ? AppStrings.translate(appLocale, "inbox.notifStateUnread") : ""
        )
    }
}

/// Tinted icon-circle wells (spec 06): cream for texts, inset for tasks,
/// warm-brick container for missed calls, avatar tint for assignments.
private func iconWell(_ type: String) -> Color {
    switch type {
    case NotificationType.inboundMessage: BrandColor.cream
    case NotificationType.assigned: BrandColor.avatarTint
    case NotificationType.taskAssigned: BrandColor.inset
    case NotificationType.missedCall: BrandColor.destructiveContainer
    // A mention is aimed at THIS reader, so it reads warmer than an assignment.
    case NotificationType.mention: BrandColor.cream
    default: BrandColor.inset
    }
}

private func iconTint(_ type: String) -> Color {
    switch type {
    case NotificationType.missedCall: BrandColor.destructive
    case NotificationType.taskAssigned: BrandColor.olive
    case NotificationType.mention: BrandColor.olive
    default: BrandColor.muted900
    }
}

/// One-line summaries, mirroring the web bell popover copy exactly.
///
/// #228: the locale is a PARAMETER because this is a plain function rather than
/// a view. Its single call site is the row above, which reads it once from the
/// environment. Two keys per type, not one with an optional name spliced in: a
/// language that reorders "de {who}" cannot be served by concatenation.
private func summaryFor(_ row: NotificationItem, _ locale: String) -> String {
    let who: String? = row.contact.map { $0.name ?? formatPhone($0.phone_e164) }

    func say(_ named: String, _ bare: String) -> String {
        guard let who else { return AppStrings.translate(locale, bare) }
        return AppStrings.translate(locale, named, ["who": who])
    }

    switch row.type {
    case NotificationType.inboundMessage:
        return say("inbox.notifNewMessageFrom", "inbox.notifNewMessage")
    case NotificationType.assigned:
        return say("inbox.notifAssignedFrom", "inbox.notifAssigned")
    case NotificationType.taskAssigned:
        return say("inbox.notifTaskAssignedFrom", "inbox.notifTaskAssigned")
    case NotificationType.missedCall:
        return say("inbox.notifMissedCallFrom", "inbox.notifMissedCall")
    case NotificationType.mention:
        return say("inbox.notifMentionFrom", "inbox.notifMention")
    default:
        // A type added server-side after this build shipped — show something
        // honest instead of crashing or hiding it.
        return say("inbox.notifUpdateFrom", "inbox.notifUpdate")
    }
}

private func iconFor(_ type: String) -> String {
    switch type {
    case NotificationType.inboundMessage: "bubble.left"
    case NotificationType.assigned: "person.crop.circle.badge.checkmark"
    case NotificationType.taskAssigned: "checklist"
    case NotificationType.missedCall: "phone.arrow.down.left"
    case NotificationType.mention: "at"
    default: "bell"
    }
}

#Preview("Feed rows") {
    List {
        NotificationRow(
            row: NotificationItem(
                id: "1",
                type: NotificationType.inboundMessage,
                conversation_id: "c1",
                message_id: "m1",
                task_id: nil,
                contact: ContactSummary(id: "p1", name: "Dana Whitcomb", phone_e164: "+14155550134"),
                created_at: "2026-07-15T12:00:00Z",
                unread: true
            ),
            onTap: {}
        )
        NotificationRow(
            row: NotificationItem(
                id: "2",
                type: NotificationType.missedCall,
                conversation_id: "c2",
                message_id: nil,
                task_id: nil,
                contact: ContactSummary(id: "p2", name: nil, phone_e164: "+14155550188"),
                created_at: "2026-07-15T09:30:00Z",
                unread: false
            ),
            onTap: {}
        )
    }
    .listStyle(.plain)
}

/// #343 — "your notifications are paused", said to the crew rather than only to
/// the owner.
///
/// At the workspace's daily ceiling, alerts stop reaching every member while an
/// email goes to the owner alone. A tech's phone simply goes quiet, and the
/// reasonable inference from that side is that the business had a slow
/// afternoon. Same failure shape as a spam thread absorbing messages (#342) and
/// a queue count that stopped at the page size (#306).
///
/// Renders nothing on almost every day. A notice, not an alarm.
private struct NotificationPauseNotice: View {
    let pause: AlertPause?

    @Environment(\.appLocale) private var appLocale

    private var headline: String {
        guard let pause else { return "" }
        let key: String = {
            if pause.email_paused && pause.push_paused { return "inbox.notifPausedBoth" }
            return pause.email_paused
                ? "inbox.notifPausedEmail"
                : "inbox.notifPausedPush"
        }()
        return AppStrings.translate(appLocale, key)
    }

    /// When only one channel is spent, saying which is the difference between
    /// "we are broken" and "you are still covered".
    private var stillCovered: String {
        guard let pause, pause.email_paused, !pause.push_paused else { return "" }
        return AppStrings.translate(appLocale, "inbox.notifPausedStillPush")
    }

    private var resumes: String {
        guard let at = pause?.resets_at else { return "" }
        return AppStrings.translate(
            appLocale,
            "inbox.notifPausedResumes",
            ["when": relativeTime(at)]
        )
    }

    var body: some View {
        if let pause, pause.anyPaused {
            Text(
                AppStrings.translate(
                    appLocale,
                    "inbox.notifPausedBody",
                    [
                        "what": headline,
                        "still": stillCovered,
                        "resumes": resumes,
                    ]
                )
            )
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.coral)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(BrandColor.cream, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .padding(.horizontal, 18)
            .padding(.bottom, 10)
        }
    }
}

/// #358: the `user_id` on a `read.*` broadcast, or nil when the payload is not
/// the shape we expect. Nil never matches, so an unreadable event is ignored
/// rather than treated as everybody's.
private func readEventUserId(_ payload: JSONValue) -> String? {
    payload["user_id"]?.stringValue
}
