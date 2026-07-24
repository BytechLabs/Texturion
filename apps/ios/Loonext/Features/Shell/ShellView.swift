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
    case thread(conversationId: String, highlightMessageId: String?)
    case task(taskId: String)
    case contact(contactId: String)
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
    case compose(prefillContactId: String?)

    var id: String {
        switch self {
        case .account: "account"
        case .notifications: "notifications"
        case .settings: "settings"
        case .compose(let contactId): "compose:\(contactId ?? "")"
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
    @State private var counts = ShellCounts()
    @State private var countsKey = 0

    /// #180: the shell is where the window's horizontal size class is known.
    /// Regular width (iPad, or an iPad-style split) caps the floating pill so it
    /// reads as a centered control instead of stretching the full width; the
    /// tab roots and the sheets they present read their own vertical size class
    /// (AccountSheet, InCallView) for compact-height rhythm.
    @Environment(\.horizontalSizeClass) private var hSizeClass

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
        NavigationStack(path: $path) {
            tabShell
                .navigationBarBackButtonHidden(true)
                .toolbar(.hidden, for: .navigationBar)
                .navigationDestination(for: ShellRoute.self) { route in
                    routeView(route)
                }
        }
        .tint(BrandColor.olive)
        .sheet(item: $activeSheet) { sheet in
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
            activeSheet = nil
            path.append(.thread(conversationId: id, highlightMessageId: highlight))
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
        .onReceive(router.$openCalls) { open in
            guard open else { return }
            router.openCalls = false
            activeSheet = nil
            path.removeAll()
            tab = .calls
        }
        .onReceive(router.$openContacts) { open in
            guard open else { return }
            router.openContacts = false
            activeSheet = nil
            path.removeAll()
            tab = .contacts
        }
        // The viewed thread (#165) is always the TOP route when it is a thread —
        // the Android `routeStack.lastOrNull() as Thread` twin. Global surfaces
        // (inbound toast, foreground push banners) stay quiet for it.
        .onChange(of: path) { _, next in
            if case .thread(let id, _)? = next.last {
                router.viewedConversationId = id
            } else {
                router.viewedConversationId = nil
            }
        }
        .task(id: countsKey) { await reloadCounts() }
        .task(id: companyId) {
            for await _ in await graph.realtime.events() {
                countsKey &+= 1
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
    }

    // MARK: - The tab shell (root of the navigation stack)

    /// The four tab roots + the floating pill and the app-wide overlays. This
    /// is the NavigationStack root; a pushed `ShellRoute` renders over ALL of
    /// it (pill, FAB, call chip, toast included) — the Android `Box` where the
    /// route host draws above the shell.
    private var tabShell: some View {
        TabView(selection: $tab) {
            Tab("For you", systemImage: "bolt", value: ShellTab.forYou) {
                ForYouTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
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
                ContactsTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                    .toolbar(.hidden, for: .tabBar)
            }
        }
        .tint(BrandColor.olive)
        .overlay { bottomFade }
        .overlay(alignment: .bottom) { pillNav.ignoresSafeArea(.keyboard, edges: .bottom) }
        .overlay(alignment: .bottomTrailing) {
            // Calls carries its own dial FAB and Inbox its own spec-20 compose
            // FAB (which hides during search) in this corner — the shell's
            // compose entry yields on both so two ink circles never stack.
            if tab != .calls && tab != .inbox {
                composeButton.ignoresSafeArea(.keyboard, edges: .bottom)
            }
        }
        .overlay(alignment: .bottom) { globalLayers }
    }

    // MARK: - Pushed routes (above the shell — no pill)

    @ViewBuilder
    private func routeView(_ route: ShellRoute) -> some View {
        switch route {
        case .thread(let conversationId, let highlightMessageId):
            ThreadView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                conversationId: conversationId,
                highlightMessageId: highlightMessageId,
                onBack: { popRoute() }
            )
        case .task(let taskId):
            TaskDetailView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                taskId: taskId,
                onOpenConversation: { conversationId, _ in
                    AppRouter.shared.openConversationId = conversationId
                }
            )
        case .contact(let contactId):
            ContactDetailView(
                graph: graph,
                companyId: companyId,
                contactId: contactId,
                onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                onComposeNew: { activeSheet = .compose(prefillContactId: $0) },
                callerIdName: hydratedMe.display_name
            )
            // Edits/opt-outs/deletes made in the detail show on return to the
            // contacts list (no realtime for contact mutations on iOS).
            .onDisappear { AppRouter.shared.contactsRevision &+= 1 }
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
            navSlot(.forYou, icon: "bolt", label: "For you")
            navSlot(.inbox, icon: "tray", label: "Inbox")
            navSlot(.calls, icon: "phone", label: "Calls")
            navSlot(.tasks, icon: "checklist", label: "Tasks")
            avatarButton
                .padding(.horizontal, 6)
        }
        .padding(.horizontal, 8)
        .frame(height: 66)
        .background(BrandColor.inkFixed, in: Capsule())
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
            tab = value
        } label: {
            ZStack {
                if tab == value {
                    Circle().fill(BrandColor.paperFixed)
                }
                Image(systemName: icon)
                    .font(.system(size: 20, weight: .regular))
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
                        .overlay(Circle().stroke(BrandColor.inkFixed, lineWidth: 2))
                        .frame(width: 9, height: 9)
                        .offset(x: 2, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("You")
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
        Button {
            activeSheet = .compose(prefillContactId: nil)
        } label: {
            Image(systemName: "pencil")
                .font(.system(size: 21, weight: .medium))
                .foregroundStyle(BrandColor.paper)
                .frame(width: 54, height: 54)
                .background(BrandColor.ink, in: Circle())
        }
        .buttonStyle(.plain)
        .shadow(color: BrandColor.inkFixed.opacity(0.3), radius: 15, x: 0, y: 7)
        .accessibilityLabel("New message")
        .padding(.trailing, 18)
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
                onOpenSettings: { activeSheet = .settings },
                onSwitchWorkspace: { root.switchWorkspace($0) },
                onSignOut: { root.signOut() }
            )
        case .notifications:
            NotificationsView(
                graph: graph,
                companyId: companyId,
                onOpenConversation: { AppRouter.shared.openConversationId = $0 }
            )
        case .settings:
            SettingsHome(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                onSignOut: { root.signOut() }
            )
        case .compose(let prefillContactId):
            NewConversationView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                prefillContactId: prefillContactId,
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
            case .thread(let conversationId):
                AppRouter.shared.openConversationId = conversationId
            case .calls(let sessionId):
                AppRouter.shared.openCalls = true
                if let sessionId {
                    // Push-to-wake part 2 (#135): the softphone ensures its
                    // registration, then POSTs ring-me exactly once
                    // (conflict/not_found swallowed by contract; best-effort
                    // like the Android twin).
                    let manager = CallsManager.get(graph: graph)
                    Task { try? await manager.onIncomingCallPush(sessionId: sessionId) }
                }
            }
        }
        PushHooks.callWakeHandler = { content in
            guard let sessionId = content.callSessionId else { return }
            let manager = CallsManager.get(graph: graph)
            Task { try? await manager.onIncomingCallPush(sessionId: sessionId) }
        }
        await PushCoordinator.shared.ensureRegistrar(api: graph.api).register()
    }

    /// Hydrate the company view (numbers etc.) + live nav counts. The numeric
    /// counts feed screen headers; the avatar dot reads the shared
    /// `CompanyReadState` (#201), primed here through its guard. Each read is
    /// quiet — a failure leaves the previous value rather than an error state.
    private func reloadCounts() async {
        if let me = try? await graph.meApi.me(companyId: companyId) {
            hydratedMe = me
        }
        let forYou = try? await graph.forYouApi.forYou(companyId: companyId)
        let unread = (try? await graph.inboxApi.conversations(
            companyId: companyId, unread: true, limit: 100
        ).data.count) ?? 0
        let openTasks = (try? await graph.tasksApi.list(
            companyId: companyId, limit: 100
        ).data.count) ?? 0
        // The avatar dot reads the shared CompanyReadState, not `counts`: route
        // the server count through the guard so a fetch landing mid-mark can't
        // resurrect a just-cleared dot (#201).
        if let notifCount = try? await graph.notificationsApi.unreadCount(companyId: companyId).count {
            notifReadState.offerServerCount(notifCount)
        }
        counts = ShellCounts(
            forYou: forYou.map { $0.waiting_on_you.count + $0.my_tasks.count + $0.unread.count } ?? 0,
            unreadConversations: unread,
            openTasks: openTasks
        )
        // App icon badge = unread conversations (the web's document-title
        // unread prefix equivalent).
        PushCoordinator.setAppBadge(unread)
    }
}
