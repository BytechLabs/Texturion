import Combine
import SwiftUI

/// Destinations the shell can show. The pill nav exposes four slots
/// (For you · Inbox · Calls · Tasks); `contacts` is a nav-less destination
/// reached from the account sheet / router (Android MainShell parity).
enum ShellTab: Hashable {
    case forYou
    case inbox
    case calls
    case tasks
    case contacts
}

/// A full-screen surface pushed ABOVE the tab shell (#186). The pill nav lives
/// only on the four tab roots; ANYTHING pushed (thread, task, contact) renders
/// through the root `NavigationStack` as one of these routes, so a pushed
/// surface with a visible pill is not constructible — the pushed route covers
/// the whole tab shell (pill included). The iOS twin of Android's `routeStack`.
enum ShellRoute: Hashable {
    /// A thread; `highlightMessageId` is the search-result jump target (scroll
    /// to + flash that message).
    case thread(conversationId: String, highlightMessageId: String?, findQuery: String? = nil)
    case task(taskId: String)
    case contact(contactId: String)
    /// #734: one call's own page, by carrier session id.
    case call(sessionId: String)
}

/// Live nav counts. The numeric counts feed screen headers and the app-icon
/// badge — no numeral badges in the nav (docs/MOBILE-DESIGN.md). The avatar's
/// coral dot is NOT here (#201): it reads the shared `CompanyReadState` the
/// notifications screen maintains, never a parallel count that a mark-read in
/// the feed can't reach.
struct ShellCounts: Equatable, Sendable {
    var forYou = 0
    var unreadConversations = 0
    var openTasks = 0

    mutating func apply(forYou: Int?, unread: Int?, openTasks: Int?) {
        self.forYou = forYou ?? self.forYou
        self.unreadConversations = unread ?? self.unreadConversations
        self.openTasks = openTasks ?? self.openTasks
    }
}

/// Surfaces the shell presents over the tabs — the Android ReadyShell
/// Overlay twin, hosted in one swappable sheet (account entries swap the
/// presented item in place instead of dismiss-then-present). These are modal
/// sheets (they cover the pill natively), distinct from the pushed
/// `ShellRoute` surfaces.
private enum ShellSheet: Identifiable {
    case account
    case notifications
    case settings
    case trash
    case compose(prefillContactId: String?, prefillPhone: String?)

    var id: String {
        switch self {
        case .account: "account"
        case .notifications: "notifications"
        case .settings: "settings"
        case .trash: "trash"
        case .compose(let contactId, let phone):
            "compose:\(contactId ?? "")|\(phone ?? "")"
        }
    }
}

/// The mobile shell (Paper & Olive, docs/MOBILE-DESIGN.md): content runs
/// edge-to-edge and the FLOATING INK PILL nav sits over it — a fixed-ink
/// capsule (dark in BOTH themes), 66pt tall, 14pt inset, four icon slots
/// (For you · Inbox · Calls · Tasks) + the 34pt avatar. The active slot is a
/// paper circle; a coral dot on the avatar means unread notifications; a
/// canvas gradient fades content out behind the pill. No labels, no numeral
/// badges. Tapping the avatar opens the account sheet; Contacts is a
/// nav-less destination reached from there.
///
/// #186: the tab shell is the ROOT of a single `NavigationStack`. Thread /
/// task / contact opens push a `ShellRoute` onto that stack — the pushed
/// surface covers the whole shell (pill included), so the pill exists ONLY on
/// the tab roots and is structurally absent on every pushed page. The shell
/// also mounts the app-wide layers (call chip, inbound toast), consumes
/// `AppRouter` commands, and wires the session-scoped device plumbing (push
/// registration, deep-link router, call-wake hook) — the Android
/// MainActivity ReadyShell's twin.
@MainActor
struct ShellView: View {
    let graph: AppGraph
    let companyId: String
    let root: RootViewModel

    @ObservedObject private var router = AppRouter.shared
    @State private var hydratedMe: Me
    @State private var tab: ShellTab = .forYou
    @State private var path: [ShellRoute] = []
    @State private var activeSheet: ShellSheet?
    /// The section the settings sheet opens at, set by a router command.
    @State private var pendingSettingsSection: SettingsSection?
    @State private var counts = ShellCounts()
    @State private var countsKey = 0
    /// #286: has this member been through the joining orientation. Nil until
    /// the read lands, which is what keeps four screens from flashing at
    /// somebody who has been here for months.
    @State private var oriented: Bool?
    /// #521: what the person who added them said, or nil for the ordinary case
    /// where nobody said anything.
    @State private var joiningNote: JoiningNote?
    @State private var notificationAsk = NotificationAsk()
    @State private var primerDismissed = false
    @State private var contactDeletionNotice: ThreadNotice?
    @State private var contactNoticeId: Int64 = 0

    /// #180: the shell is where the window's horizontal size class is known.
    /// Regular width (iPad, or an iPad-style split) caps the floating pill so it
    /// reads as a centered control instead of stretching the full width; the
    /// tab roots and the sheets they present read their own vertical size class
    /// (AccountSheet, InCallView) for compact-height rhythm.
    @Environment(\.horizontalSizeClass) private var hSizeClass
    @Environment(\.appLocale) private var appLocale

    /// The pill's max width — capped and centered on a regular-width window,
    /// full-bleed (minus its inset) on a compact phone.
    private var pillMaxWidth: CGFloat { hSizeClass == .regular ? 460 : .infinity }

    /// The shared unread state (#201) — the SAME instance the notifications
    /// screen and the account sheet read, so the avatar dot clears the frame a
    /// mark-read lands, and an in-flight server count can't resurrect it.
    private let notifReadState: CompanyReadState

    init(graph: AppGraph, me: Me, companyId: String, root: RootViewModel) {
        self.graph = graph
        self.companyId = companyId
        self.root = root
        self.notifReadState = NotificationsReadState.shared.forCompany(companyId)
        _hydratedMe = State(initialValue: me)
    }

    var body: some View {
        // #315: every one of the four tabs is a conversation surface, so a role
        // without `conversations.read` — the bookkeeper preset, which holds
        // billing and nothing else — would find a pager where each page answers
        // 403. They get the one screen they can work instead, as the ROOT
        // rather than a sheet: a sheet can be swiped away, and there is nothing
        // underneath it for them.
        //
        // Replacing the whole NavigationStack, not its content: SettingsHome
        // brings its own, and nesting two would break its back button. The
        // router's push commands below are still consumed — they simply have
        // nothing to push onto, which is correct, because every route they name
        // is a conversation surface.
        Group {
            if hasInbox {
                NavigationStack(path: $path) {
                    tabShell
                        .safeAreaInset(edge: .top, spacing: 0) { twoFactorDeadlineBanner }
                        .navigationBarBackButtonHidden(true)
                        .toolbar(.hidden, for: .navigationBar)
                        .navigationDestination(for: ShellRoute.self) { route in
                            routeView(route)
                        }
                }
            } else {
                billingOnlyRoot
                    .safeAreaInset(edge: .top, spacing: 0) { twoFactorDeadlineBanner }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if ConnectionWatch.shared.offline || root.usingCachedWorkspace {
                Text(AppStrings.translate(appLocale, "shell.offline"))
                    .font(.footnote)
                    .foregroundStyle(BrandColor.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(BrandColor.amberBg)
            }
        }
        .tint(BrandColor.olive)
        .overlay(alignment: .bottom) {
            if let notice = contactDeletionNotice {
                ToastView(notice: notice) { contactDeletionNotice = nil }
                    .padding(.bottom, path.isEmpty ? 74 : 12)
                    .task(id: notice.id) {
                        do {
                            try await Task.sleep(for: .seconds(notice.seconds))
                        } catch {
                            return
                        }
                        if contactDeletionNotice?.id == notice.id {
                            contactDeletionNotice = nil
                        }
                    }
            }
        }
        .sheet(item: $activeSheet, onDismiss: refreshTwoFactorDeadline) { sheet in
            sheetContent(sheet)
        }
        // AppRouter commands: an open pushes the matching route ABOVE the tab
        // shell (the pill is covered — structurally absent on pushed pages).
        // Each command is consumed then cleared (deferred — never republish
        // inside the publish). A live account/notifications sheet is dismissed
        // so the pushed surface is revealed beneath it.
        .onReceive(router.$openConversationId) { id in
            guard let id else { return }
            let highlight = router.pendingHighlightMessageId
            let findQuery = router.pendingFindQuery
            router.pendingFindQuery = nil
            activeSheet = nil
            path.append(.thread(conversationId: id, highlightMessageId: highlight, findQuery: findQuery))
            Task { @MainActor in
                router.openConversationId = nil
                router.pendingHighlightMessageId = nil
            }
        }
        .onReceive(router.$openTaskId) { id in
            guard let id else { return }
            activeSheet = nil
            path.append(.task(taskId: id))
            Task { @MainActor in router.openTaskId = nil }
        }
        .onReceive(router.$openContactId) { id in
            guard let id else { return }
            activeSheet = nil
            path.append(.contact(contactId: id))
            Task { @MainActor in router.openContactId = nil }
        }
        .onReceive(router.$openCallSessionId) { id in
            guard let id else { return }
            activeSheet = nil
            path.append(.call(sessionId: id))
            Task { @MainActor in router.openCallSessionId = nil }
        }
        .onReceive(router.$openSettingsSection) { section in
            guard let section else { return }
            pendingSettingsSection = section
            activeSheet = .settings
            router.openSettingsSection = nil
        }
        .onReceive(router.$openSettings) { open in
            guard open else { return }
            router.openSettings = false
            pendingSettingsSection = nil
            activeSheet = .settings
        }
        .onReceive(router.$openCalls) { open in
            guard open else { return }
            router.openCalls = false
            activeSheet = nil
            path.removeAll()
            tab = .calls
        }
        .onReceive(router.$openForYou) { open in
            guard open else { return }
            router.openForYou = false
            activeSheet = nil
            path.removeAll()
            tab = .forYou
        }
        // #459: the dialer's Text action. Opens compose seeded with the number
        // rather than pushing a thread, because a number we have never texted
        // has no thread to push.
        .onReceive(router.$composeTo) { number in
            guard let number else { return }
            router.composeTo = nil
            activeSheet = .compose(prefillContactId: nil, prefillPhone: number)
        }
        // #735: the native Trash, from the account sheet, a thread and a delete toast.
        .onReceive(router.$openTrash) { open in
            guard open else { return }
            router.openTrash = false
            activeSheet = .trash
        }
        .onReceive(router.$openContacts) { open in
            guard open else { return }
            router.openContacts = false
            activeSheet = nil
            path.removeAll()
            tab = .contacts
        }
        // #508: the response-time card's unanswered row. The SHELL switches the
        // tab; the inbox applies `router.inboxDestination` itself, so neither
        // one clears the other's half.
        .onReceive(router.$openInbox) { open in
            guard open else { return }
            router.openInbox = false
            activeSheet = nil
            path.removeAll()
            tab = .inbox
        }
        // The viewed thread (#165) is always the TOP route when it is a thread —
        // the Android `routeStack.lastOrNull() as Thread` twin. Global surfaces
        // (inbound toast, foreground push banners) stay quiet for it.
        .onChange(of: path) { _, next in
            if case .thread(let id, _, _)? = next.last {
                router.viewedConversationId = id
                PushCoordinator.clearConversationNotifications(id)
            } else {
                router.viewedConversationId = nil
            }
        }
        .task(id: countsKey) {
            if countsKey > 0 { try? await Task.sleep(for: .milliseconds(750)) }
            guard !Task.isCancelled else { return }
            await reloadCounts()
        }
        .task(id: companyId) {
            for await event in await graph.realtime.events() {
                let myRead = event.event.hasPrefix("read.") &&
                    event.payload["user_id"]?.stringValue == hydratedMe.user_id
                if myRead || ["message.", "conversation.", "task.", "call."].contains(where: {
                    event.event.hasPrefix($0)
                }) {
                    countsKey &+= 1
                }
                if myRead, event.event == "read.conversation",
                   event.payload["is_read"]?.boolValue == true,
                   let id = event.payload["conversation_id"]?.stringValue {
                    PushCoordinator.clearConversationNotifications(id)
                }
            }
        }
        // #215: reload the nav counts + avatar dot on a socket re-JOIN and on
        // foreground return, so a badge derived from a missed frame corrects.
        .task(id: companyId) {
            for await _ in await graph.realtime.reconnected() {
                countsKey &+= 1
            }
        }
        .resyncOnForeground { countsKey &+= 1 }
        .task(id: companyId) { await wireSessionDevice() }
        .task(id: companyId) { await warmDefaultReads() }
        // #289: one process-wide path observation, started once. NWPathMonitor
        // is a system resource with a real cost to start and stop, and the
        // answer is the same for every screen.
        .task { ConnectionWatch.shared.start() }
        // #286: asked only of roles the joining flow could ever be for, so
        // nobody else pays a round trip on app start. A failure leaves it nil,
        // i.e. shows nothing.
        .task(id: companyId) {
            // #521: a joining note belongs to ONE membership, and this view's
            // state survives a workspace switch. Cleared FIRST, ahead of the
            // guard, because every path out of this block that does not reach
            // the read below would otherwise leave the previous workspace's
            // private sentence sitting on this workspace's screen.
            joiningNote = nil
            guard shouldShowOrientation(role, false) else { return }
            // Both reads start together. Awaited one after the other they cost
            // the SUM of two round trips before the sheet may open, which every
            // member about to be oriented pays, including the majority whose
            // answer is "nobody wrote one"; started together they cost the
            // slower of the two. `ApiClient` sets no timeout, so the serial
            // form could hold the sheet off screen for twice URLSession's
            // default minute.
            //
            // The note read is therefore speculative: it is issued before we
            // know whether the sheet will open at all, which costs one extra
            // row read on the launches where it does not. That buys the sheet
            // opening whole, which is the alternative to it resizing under a
            // thumb when a late note arrives and changes its detents.
            //
            // Hoisted into locals because the graph is main-actor state: the
            // API values are Sendable, the object holding them is not, and a
            // child task cannot reach through it.
            let meApi = graph.meApi
            let company = companyId
            async let firsts = meApi.firsts(companyId: company)
            async let note = meApi.joiningNote(companyId: company)
            let answer = (try? await firsts)?.oriented
            // #521: assigned BEFORE `oriented` opens the sheet, so the first
            // screen arrives with the note on it instead of pushing the
            // product's copy down a beat later. A failure leaves it nil, i.e.
            // the flow exactly as it was.
            joiningNote = try? await note
            oriented = answer
        }
        // #286: the four screens a new tech gets on their first sign-in.
        // Presented from the shell because they belong to the SESSION rather
        // than to whichever tab happens to be selected.
        .sheet(
            isPresented: Binding(
                get: { shouldShowOrientation(role, oriented) },
                // A swipe down IS the skip. #286 promises a skippable flow,
                // and a gesture that closes the sheet without recording the
                // skip would re-present it on the next sign-in — which is the
                // definition of a skip that did not work.
                set: { if !$0 { finishOrientation() } }
            )
        ) {
            MemberOrientationSheet(joining: joiningNote, onFinished: finishOrientation)
        }
        // #286: and for everybody the orientation is not for — the owner who
        // just finished setup, anybody already here when it shipped. One
        // screen saying what we will buzz about, then the real prompt.
        // Suppressed while the orientation is up: that flow ends on the same
        // ask with three screens of reason in front of it, and two sheets
        // about one permission is the cold ask with extra steps.
        .sheet(
            isPresented: Binding(
                get: {
                    notificationAsk.askable
                        && !primerDismissed
                        && !shouldShowOrientation(role, oriented)
                },
                // Closing without answering is NOT a refusal, so nothing is
                // recorded and the sheet is simply gone for this launch. The
                // next one asks again — unlike the system prompt, this is ours
                // to repeat, and repeating it is cheaper than losing the
                // permission for good.
                set: { if !$0 { primerDismissed = true } }
            )
        ) {
            NotificationPrimerSheet(ask: notificationAsk) { primerDismissed = true }
        }
        .task(id: companyId) { await notificationAsk.refresh() }
    }

    /// #286: finished, or skipped — the same call either way, because a skip
    /// that comes back tomorrow is not a skip.
    ///
    /// Marked locally first so closing the sheet cannot re-present it on the
    /// next body evaluation while the write is still in flight; a failed write
    /// costs somebody a repeat on their next sign-in rather than the app.
    private func finishOrientation() {
        oriented = true
        Task { try? await graph.meApi.markOriented(companyId: companyId) }
    }

    /// This viewer's role in the company the shell was hydrated for.
    private var role: String? {
        hydratedMe.memberships.first { $0.company_id == companyId }?.role
    }

    // MARK: - Roles with no inbox (#315)

    /// Whether this viewer can open a conversation surface at all, read off the
    /// membership the shell was hydrated with. Fails closed: an unknown role,
    /// or a hydration that no longer contains this company, reads as NO.
    private var hasInbox: Bool {
        MemberRole.canReadConversations(role)
    }

    /// The whole app for a bookkeeper: billing, and the settings sections their
    /// role can actually open (SettingsHome does that filtering itself, from
    /// the same shared table the sidebar uses on web). No pill, no FAB, no
    /// call chip — none of them lead anywhere they may go.
    private var billingOnlyRoot: some View {
        SettingsHome(
            graph: graph,
            companyId: companyId,
            me: hydratedMe,
            onSignOut: { root.signOut() },
            initialSection: .billing
        )
    }

    @ViewBuilder
    private var twoFactorDeadlineBanner: some View {
        if let company = hydratedMe.company, let setup = company.mfa_setup,
           let graceUntil = setup.grace_until, !setup.enrolled {
            let deadline = TimestampFormat.exact(
                graceUntil, locale: appLocale, timeZone: TimeZone(identifier: company.timezone) ?? .current
            )
            VStack(alignment: .leading, spacing: 4) {
                Text(AppStrings.translate(appLocale, "shell.mfaSetupDeadline", ["when": deadline]))
                    .font(.footnote)
                Button(AppStrings.translate(appLocale, "shell.mfaSetupAction")) {
                    pendingSettingsSection = .profile
                    activeSheet = .settings
                }
                .font(.subheadline)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(BrandColor.canvas)
        }
    }

    private func refreshTwoFactorDeadline() {
        guard hydratedMe.company?.mfa_setup?.enrolled == false else { return }
        Task {
            if let me = try? await graph.meApi.me(companyId: companyId) {
                hydratedMe = me
            }
        }
    }

    // MARK: - The tab shell (root of the navigation stack)

    /// The four tab roots + the floating pill and the app-wide overlays. This
    /// is the NavigationStack root; a pushed `ShellRoute` renders over ALL of
    /// it (pill, FAB, call chip, toast included) — the Android `Box` where the
    /// route host draws above the shell.
    private var tabShell: some View {
        // #228: the five `Tab` titles below are deliberately NOT extracted.
        // Every one of them carries `.toolbar(.hidden, for: .tabBar)`, so the
        // system tab bar never draws and these strings never reach a reader —
        // the labels somebody actually sees and hears are the pill nav's
        // `.accessibilityLabel`s, which ARE translated. Leaving them English
        // costs nothing; reaching for a `Tab` initializer overload that cannot
        // be compiled on this machine costs a red `Gate / iOS`.
        TabView(selection: $tab) {
            Tab("For you", systemImage: "bolt", value: ShellTab.forYou) {
                ForYouTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    // #556: the same instance the account sheet reads, so the
                    // bell's dot and the sheet's count can never disagree.
                    readState: notifReadState,
                    onOpenNotifications: { activeSheet = .notifications },
                    onOpenCalls: { AppRouter.shared.openCalls = true }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                .toolbar(.hidden, for: .tabBar)
            }
            Tab("Inbox", systemImage: "tray", value: ShellTab.inbox) {
                InboxTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                    .toolbar(.hidden, for: .tabBar)
            }
            Tab("Calls", systemImage: "phone", value: ShellTab.calls) {
                CallsView(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    openConversation: { AppRouter.shared.openConversationId = $0 }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                .toolbar(.hidden, for: .tabBar)
            }
            Tab("Tasks", systemImage: "checklist", value: ShellTab.tasks) {
                TasksTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                    .toolbar(.hidden, for: .tabBar)
            }
            Tab("Contacts", systemImage: "person.2", value: ShellTab.contacts) {
                ContactsTab(graph: graph, companyId: companyId, me: hydratedMe, onContactDeleted: showContactDeletion)
                    .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                    .toolbar(.hidden, for: .tabBar)
            }
        }
        .tint(BrandColor.olive)
        .overlay { bottomFade }
        .overlay(alignment: .bottom) { pillNav.ignoresSafeArea(.keyboard, edges: .bottom) }
        .overlay(alignment: .bottomTrailing) {
            // #732: Inbox, Calls, Tasks and Contacts each carry their own main
            // action (the shared button, in this corner) — the shell's compose
            // entry is For you's alone, so two ink circles never stack.
            if tab == .forYou {
                composeButton.ignoresSafeArea(.keyboard, edges: .bottom)
            }
        }
        .overlay(alignment: .bottom) { globalLayers }
    }

    // MARK: - Pushed routes (above the shell — no pill)

    @ViewBuilder
    private func routeView(_ route: ShellRoute) -> some View {
        switch route {
        case .thread(let conversationId, let highlightMessageId, let findQuery):
            ThreadView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                conversationId: conversationId,
                highlightMessageId: highlightMessageId,
                findQuery: findQuery,
                onBack: { popRoute() }
            )
        case .task(let taskId):
            TaskDetailView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                taskId: taskId,
                // #217: "View in conversation" opens the source thread anchored
                // to the promoted message — set the highlight before the open so
                // the shell scrolls to + flashes it (the search-hit idiom).
                onOpenConversation: { conversationId, messageId in
                    AppRouter.shared.pendingHighlightMessageId = messageId
                    AppRouter.shared.openConversationId = conversationId
                }
            )
        case .contact(let contactId):
            ContactDetailView(
                graph: graph,
                companyId: companyId,
                contactId: contactId,
                onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                onComposeNew: {
                    activeSheet = .compose(prefillContactId: $0, prefillPhone: nil)
                },
                onMergedContact: { survivorId in
                    guard path.last == .contact(contactId: contactId) else { return }
                    path[path.count - 1] = .contact(contactId: survivorId)
                },
                callerIdName: hydratedMe.display_name,
                // #695: Unmerge is gated like merge, which the server holds to
                // settings.manage (owner and admin).
                canUnmerge: MemberRole.atLeast(role, required: MemberRole.admin),
                canDelete: RecordDeletion.canDelete(role: role),
                canBlock: MemberRole.has(role, Capability.conversationsNote),
                onContactDeleted: showContactDeletion,
                onComposeNumber: { contactId, number in
                    activeSheet = .compose(prefillContactId: contactId, prefillPhone: number)
                }
            )
            // Edits/opt-outs/deletes made in the detail show on return to the
            // contacts list (no realtime for contact mutations on iOS).
            .onDisappear { AppRouter.shared.contactsRevision &+= 1 }
        case .call(let sessionId):
            CallDetailView(
                graph: graph,
                companyId: companyId,
                sessionId: sessionId,
                onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                onOpenContact: { AppRouter.shared.openContactId = $0 }
            )
        }
    }

    private func showContactDeletion(_ contactId: String) {
        contactNoticeId += 1
        contactDeletionNotice = Toast.undoable(
            id: contactNoticeId,
            text: AppStrings.translate(appLocale, "trash.contactDeleted"),
            locale: appLocale,
            trashLabel: AppStrings.translate(appLocale, "trash.viewTrash")
        ) {
            Task {
                do {
                    try await RecordDeletionRepository(api: graph.api).restore(
                        companyId: companyId, kind: .contact, id: contactId
                    )
                    router.contactsRevision &+= 1
                } catch {
                    contactNoticeId += 1
                    contactDeletionNotice = ThreadNotice(id: contactNoticeId, text: error.userMessage)
                }
            }
        }
    }

    /// Pop the top pushed route. The thread's custom header calls this (it
    /// hides the system bar); task/contact use the system back button, which
    /// keeps `path` in sync on its own.
    private func popRoute() {
        if !path.isEmpty { path.removeLast() }
    }

    // MARK: - The floating ink pill nav (the signature element)

    /// Clear spacer that keeps scrollable content reachable above the
    /// floating pill (content still draws edge-to-edge underneath it).
    private var navClearance: some View {
        Color.clear
            .frame(height: 88)
            .allowsHitTesting(false)
    }

    /// Canvas gradient that fades content out behind the pill
    /// (spec: 130pt tall, opaque from 72%).
    private var bottomFade: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            LinearGradient(
                stops: [
                    .init(color: BrandColor.canvas.opacity(0), location: 0),
                    .init(color: BrandColor.canvas, location: 0.72),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 130)
        }
        .ignoresSafeArea(edges: .bottom)
        .allowsHitTesting(false)
    }

    /// The 66pt ink capsule — fixed dark in BOTH themes, 14pt inset above
    /// the safe area. Four 46pt slots + the avatar; no labels, no numerals.
    private var pillNav: some View {
        HStack(spacing: 0) {
            navSlot(
                .forYou,
                icon: "bolt",
                label: AppStrings.translate(appLocale, "shell.navForYou")
            )
            navSlot(
                .inbox,
                icon: "tray",
                label: AppStrings.translate(appLocale, "shell.navInbox")
            )
            navSlot(
                .calls,
                icon: "phone",
                label: AppStrings.translate(appLocale, "shell.navCalls")
            )
            navSlot(
                .tasks,
                icon: "checklist",
                label: AppStrings.translate(appLocale, "shell.navTasks")
            )
            avatarButton
                .padding(.horizontal, 6)
        }
        .padding(.horizontal, 8)
        .frame(height: 66)
        // #556: the capsule needs an EDGE in either theme — see `navPill`.
        .background(BrandColor.navPill, in: Capsule())
        .overlay(Capsule().strokeBorder(BrandColor.navPillEdge, lineWidth: 1))
        .shadow(color: BrandColor.inkFixed.opacity(0.28), radius: 20, x: 0, y: 9)
        // Cap + center on regular width (iPad); full-bleed on a phone (#180).
        .frame(maxWidth: pillMaxWidth)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 14)
        .padding(.bottom, 14)
    }

    /// One 46pt nav slot: active = paper circle with ink icon, idle = paper
    /// glyph at 52%.
    private func navSlot(_ value: ShellTab, icon: String, label: String) -> some View {
        Button {
            // Only on an actual MOVE. A tap on the tab you are already on
            // scrolls to top and changes nothing else; buzzing for it would
            // teach the hand that the buzz means nothing.
            if tab != value { Haptics.tap() }
            tab = value
        } label: {
            ZStack {
                if tab == value {
                    Circle().fill(BrandColor.paperFixed)
                }
                Image(systemName: icon)
                    .font(.scaled(IconSize.large, weight: .regular))
                    .foregroundStyle(
                        tab == value
                            ? BrandColor.inkFixed
                            : BrandColor.paperFixed.opacity(0.52)
                    )
            }
            .frame(width: 46, height: 46)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .accessibilityLabel(label)
        .accessibilityAddTraits(tab == value ? .isSelected : [])
    }

    /// The 34pt avatar slot — opens the account sheet; the coral dot means
    /// unread notifications (never a numeral).
    private var avatarButton: some View {
        Button {
            Haptics.tap()
            activeSheet = .account
        } label: {
            InitialsAvatar(
                name: hydratedMe.display_name.isBlank ? nil : hydratedMe.display_name,
                size: 34
            )
            .overlay(alignment: .topTrailing) {
                if notifReadState.unreadCount > 0 {
                    Circle()
                        .fill(BrandColor.coral)
                        // The ring is the CAPSULE showing through, so it has to
                        // be the capsule's colour rather than a fixed ink that
                        // merely used to equal it. Once the capsule lightened in
                        // dark (#556) an `inkFixed` ring stopped being a cutout
                        // and became a dark halo around the dot.
                        .overlay(Circle().stroke(BrandColor.navPill, lineWidth: 2))
                        .frame(width: 9, height: 9)
                        .offset(x: 2, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        // Surface the unread-notification dot to VoiceOver (it was a purely
        // visual coral dot before).
        .accessibilityLabel(
            notifReadState.unreadCount > 0
                ? AppStrings.translate(
                    appLocale,
                    "shell.youUnread",
                    ["count": "\(notifReadState.unreadCount)"]
                )
                : AppStrings.translate(appLocale, "shell.you")
        )
    }

    // MARK: - Overlays above the nav

    /// The persistent call chip + global inbound toast ride ABOVE the pill
    /// nav (Android MainActivity parity). Mounting `CallsOverlay` is what
    /// registers the softphone on app open — the member is ring-eligible even
    /// before ever visiting the calls surface.
    private var globalLayers: some View {
        VStack(spacing: 10) {
            CallsOverlay(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                openConversation: { AppRouter.shared.openConversationId = $0 }
            )
            InboundToastHost(
                graph: graph,
                companyId: companyId,
                onView: { AppRouter.shared.openConversationId = $0 }
            )
        }
        .padding(.bottom, 94)
    }

    /// The single app-wide compose entry (#100/G11) — a 54pt ink circle FAB
    /// with the pencil glyph, riding 18pt from the trailing edge above the
    /// pill nav.
    private var composeButton: some View {
        MainActionButton(
            systemImage: "pencil",
            label: AppStrings.translate(appLocale, "shell.newMessage")
        ) {
            activeSheet = .compose(prefillContactId: nil, prefillPhone: nil)
        }
        .padding(.trailing, MainAction.trailing)
        .padding(.bottom, 96)
    }

    @ViewBuilder
    private func sheetContent(_ sheet: ShellSheet) -> some View {
        switch sheet {
        case .account:
            AccountSheet(
                prefs: graph.prefs,
                me: hydratedMe,
                companyId: companyId,
                readState: notifReadState,
                onOpenContacts: {
                    activeSheet = nil
                    tab = .contacts
                },
                onOpenNotifications: { activeSheet = .notifications },
                onOpenSettings: {
                    // Cleared so the hub opens at the index, not wherever a
                    // previous router command sent it.
                    pendingSettingsSection = nil
                    activeSheet = .settings
                },
                onSwitchWorkspace: { root.switchWorkspace($0) },
                onSignOut: { root.signOut() }
            )
        case .notifications:
            NotificationsView(
                graph: graph,
                companyId: companyId,
                meUserId: hydratedMe.user_id,
                onOpenConversation: { conversationId, messageId in
                    AppRouter.shared.pendingHighlightMessageId = messageId
                    AppRouter.shared.openConversationId = conversationId
                },
                onOpenTask: { AppRouter.shared.openTaskId = $0 }
            )
        case .settings:
            SettingsHome(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                onSignOut: { root.signOut() },
                initialSection: pendingSettingsSection
            )
        case .trash:
            TrashView(
                graph: graph,
                companyId: companyId,
                meUserId: hydratedMe.user_id
            )
        case .compose(let prefillContactId, let prefillPhone):
            NewConversationView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                prefillContactId: prefillContactId,
                prefillPhone: prefillPhone,
                onCreated: { AppRouter.shared.openConversationId = $0 },
                onBack: { activeSheet = nil }
            )
        }
    }

    /// Session-scoped device wiring — the Android ReadyShell LaunchedEffect
    /// twin: push activation + token registration (a quiet no-op without
    /// Firebase config), the notification/universal-link router, and the
    /// degraded foreground call-wake hook.
    private func wireSessionDevice() async {
        PushCoordinator.shared.activate(api: graph.api)
        PushHooks.router = { route in
            switch route {
            case .thread(let conversationId, let taskId, let messageId):
                AppRouter.shared.pendingHighlightMessageId = messageId
                AppRouter.shared.openConversationId = conversationId
                if let taskId { AppRouter.shared.openTaskId = taskId }
            case .task(let taskId):
                AppRouter.shared.openTaskId = taskId
            case .calls(let sessionId, let transferId):
                AppRouter.shared.openCalls = true
                if let sessionId {
                    // Push-to-wake part 2 (#135): the softphone ensures its
                    // registration, then POSTs ring-me exactly once
                    // (conflict/not_found swallowed by contract; best-effort
                    // like the Android twin).
                    let manager = CallsManager.get(graph: graph)
                    Task { try? await manager.onIncomingCallPush(sessionId: sessionId, transferId: transferId) }
                }
            case .callback(let number, let workspace, let member):
                guard workspace == companyId, member == hydratedMe.user_id else { return }
                AppRouter.shared.openCalls = true
                AppRouter.shared.dialTo = number
            case .settings(let section):
                if let section {
                    AppRouter.shared.openSettingsSection = section
                } else {
                    AppRouter.shared.openSettings = true
                }
            case .forYou:
                AppRouter.shared.openForYou = true
            }
        }
        PushHooks.callWakeHandler = { content in
            guard let sessionId = content.callSessionId else { return }
            let manager = CallsManager.get(graph: graph)
            Task { try? await manager.onIncomingCallPush(sessionId: sessionId, transferId: content.transferId) }
        }
        await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
    }

    private func warmDefaultReads() async {
        let inbox = graph.inboxApi
        let tasks = graph.tasksApi
        let workspace = companyId
        let filters = taskListArms(tab: .open, assigneeUserId: nil, unassigned: false, due: nil, q: nil)
            .first ?? TaskListFilters()
        async let rows = try? await inbox.conversations(companyId: workspace, status: "open", pinned: "exclude")
        async let pins = try? await inbox.conversations(companyId: workspace, status: "open", pinned: "only", limit: 100)
        async let openTasks = try? await tasks.list(companyId: workspace, filters: filters)
        _ = await (rows, pins, openTasks)
    }

    /// Hydrate the company view (numbers etc.) + live nav counts. The numeric
    /// counts feed screen headers; the avatar dot reads the shared
    /// `CompanyReadState` (#201), primed here through its guard. Each read is
    /// quiet — a failure leaves the previous value rather than an error state.
    private func reloadCounts() async {
        let me = try? await graph.meApi.me(companyId: companyId)
        let forYou = try? await graph.forYouApi.forYou(companyId: companyId)
        let openTasks = try? await graph.tasksApi.list(
            companyId: companyId, limit: 100
        ).data.count
        let badges = try? await graph.notificationsApi.unreadCount(companyId: companyId)
        guard !Task.isCancelled else { return }
        if let me { hydratedMe = me }
        // The avatar dot reads the shared CompanyReadState, not `counts`: route
        // the server count through the guard so a fetch landing mid-mark can't
        // resurrect a just-cleared dot (#201).
        if let badges { notifReadState.offerServerCount(badges.count) }
        counts.apply(
            forYou: forYou.map { $0.waiting_on_you.count + $0.my_tasks.count + $0.unread.count },
            unread: badges?.unread_conversations,
            openTasks: openTasks
        )
        if let unread = badges?.unread_conversations { PushCoordinator.setAppBadge(unread) }
    }
}
