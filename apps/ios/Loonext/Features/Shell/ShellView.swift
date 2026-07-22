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

/// Live nav counts. The pill nav shows only the avatar's coral dot (unread
/// notifications); the numeric counts feed screen headers and the app-icon
/// badge — no numeral badges in the nav (docs/MOBILE-DESIGN.md).
struct ShellCounts: Equatable, Sendable {
    var forYou = 0
    var unreadConversations = 0
    var openTasks = 0
    var unreadNotifications = 0
}

/// Surfaces the shell presents over the tabs — the Android ReadyShell
/// Overlay twin, hosted in one swappable sheet (account entries swap the
/// presented item in place instead of dismiss-then-present).
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
/// nav-less destination reached from there. The shell also mounts the
/// app-wide layers (call chip, inbound toast), consumes `AppRouter`
/// commands, and wires the session-scoped device plumbing (push
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
    @State private var activeSheet: ShellSheet?
    @State private var counts = ShellCounts()
    @State private var countsKey = 0

    init(graph: AppGraph, me: Me, companyId: String, root: RootViewModel) {
        self.graph = graph
        self.companyId = companyId
        self.root = root
        _hydratedMe = State(initialValue: me)
    }

    var body: some View {
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
                TasksTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    onOpenConversation: { conversationId, _ in
                        AppRouter.shared.openConversationId = conversationId
                    }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                .toolbar(.hidden, for: .tabBar)
            }
            Tab("Contacts", systemImage: "person.2", value: ShellTab.contacts) {
                ContactsTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                    onComposeNew: { activeSheet = .compose(prefillContactId: $0) }
                )
                .safeAreaInset(edge: .bottom, spacing: 0) { navClearance }
                .toolbar(.hidden, for: .tabBar)
            }
        }
        .tint(BrandColor.olive)
        .sheet(item: $activeSheet) { sheet in
            sheetContent(sheet)
        }
        .overlay { bottomFade }
        .overlay(alignment: .bottom) { pillNav }
        .overlay(alignment: .bottomTrailing) {
            // Calls carries its own dial FAB in the same corner — the compose
            // entry yields there (it was never visible over the old calls
            // sheet either).
            if tab != .calls { composeButton }
        }
        .overlay(alignment: .bottom) { globalLayers }
        // AppRouter commands: a conversation open lands on the Inbox tab (the
        // inbox consumes + clears the id); calls/contacts commands select
        // their destinations (consumed + cleared here).
        .onReceive(router.$openConversationId) { id in
            guard id != nil else { return }
            activeSheet = nil
            tab = .inbox
        }
        .onReceive(router.$openCalls) { open in
            guard open else { return }
            router.openCalls = false
            activeSheet = nil
            tab = .calls
        }
        .onReceive(router.$openContacts) { open in
            guard open else { return }
            router.openContacts = false
            activeSheet = nil
            tab = .contacts
        }
        .task(id: countsKey) { await reloadCounts() }
        .task(id: companyId) {
            for await _ in await graph.realtime.events() {
                countsKey &+= 1
            }
        }
        .task(id: companyId) { await wireSessionDevice() }
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
                if counts.unreadNotifications > 0 {
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
                unreadNotifications: counts.unreadNotifications,
                onOpenCalls: {
                    activeSheet = nil
                    tab = .calls
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

    /// Hydrate the company view (numbers etc.) + live nav counts. The counts
    /// feed screen headers and the avatar dot (the pill nav shows no
    /// numerals). Each read is quiet — a failure leaves the previous value
    /// rather than an error state.
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
        let unreadNotifications =
            (try? await graph.notificationsApi.unreadCount(companyId: companyId).count) ?? 0
        counts = ShellCounts(
            forYou: forYou.map { $0.waiting_on_you.count + $0.my_tasks.count + $0.unread.count } ?? 0,
            unreadConversations: unread,
            openTasks: openTasks,
            unreadNotifications: unreadNotifications
        )
        // App icon badge = unread conversations (the web's document-title
        // unread prefix equivalent).
        PushCoordinator.setAppBadge(unread)
    }
}
