import Combine
import SwiftUI

enum ShellTab: Hashable {
    case forYou
    case inbox
    case tasks
    case contacts
    case you
}

/// Live nav counts (accent-rationed: quiet numerals capped at 9+).
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
    case calls
    case notifications
    case settings
    case compose(prefillContactId: String?)

    var id: String {
        switch self {
        case .account: "account"
        case .calls: "calls"
        case .notifications: "notifications"
        case .settings: "settings"
        case .compose(let contactId): "compose:\(contactId ?? "")"
        }
    }
}

/// The mobile shell: native Liquid Glass tab bar (For you · Inbox · Tasks ·
/// Contacts · You) + the single app-wide compose entry (#100/G11). Selecting
/// "You" opens the account sheet instead of switching tabs. The shell also
/// mounts the app-wide layers (call chip, inbound toast), consumes
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
            Tab("For you", systemImage: "bolt.fill", value: ShellTab.forYou) {
                ForYouTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    onOpenCalls: { AppRouter.shared.openCalls = true }
                )
                .badge(badgeLabel(counts.forYou))
            }
            Tab("Inbox", systemImage: "tray.fill", value: ShellTab.inbox) {
                InboxTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .badge(badgeLabel(counts.unreadConversations))
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
                .badge(badgeLabel(counts.openTasks))
            }
            Tab("Contacts", systemImage: "person.2.fill", value: ShellTab.contacts) {
                ContactsTab(
                    graph: graph,
                    companyId: companyId,
                    me: hydratedMe,
                    onOpenConversation: { AppRouter.shared.openConversationId = $0 },
                    onComposeNew: { activeSheet = .compose(prefillContactId: $0) }
                )
            }
            Tab("You", systemImage: "person.crop.circle", value: ShellTab.you) {
                // Never shown — selecting You opens the account sheet in place.
                Color.clear
                    .badge(counts.unreadNotifications > 0 ? Text("•") : nil)
            }
        }
        .tabBarMinimizeBehavior(.onScrollDown)
        .tint(BrandColor.petrol)
        .onChange(of: tab) { previous, next in
            if next == .you {
                tab = previous
                activeSheet = .account
            }
        }
        .sheet(item: $activeSheet) { sheet in
            sheetContent(sheet)
        }
        .overlay(alignment: .bottomTrailing) { composeButton }
        .overlay(alignment: .bottom) { globalLayers }
        // AppRouter commands: a conversation open lands on the Inbox tab (the
        // inbox consumes + clears the id); a calls command presents the calls
        // surface (consumed + cleared here).
        .onReceive(router.$openConversationId) { id in
            guard id != nil else { return }
            activeSheet = nil
            tab = .inbox
        }
        .onReceive(router.$openCalls) { open in
            guard open else { return }
            router.openCalls = false
            activeSheet = .calls
        }
        .task(id: countsKey) { await reloadCounts() }
        .task(id: companyId) {
            for await _ in await graph.realtime.events() {
                countsKey &+= 1
            }
        }
        .task(id: companyId) { await wireSessionDevice() }
    }

    /// The persistent call chip + global inbound toast ride ABOVE the tab bar
    /// (Android MainActivity parity). Mounting `CallsOverlay` is what
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
        .padding(.bottom, 72)
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
                onOpenCalls: { activeSheet = .calls },
                onOpenNotifications: { activeSheet = .notifications },
                onOpenSettings: { activeSheet = .settings },
                onSwitchWorkspace: { root.switchWorkspace($0) },
                onSignOut: { root.signOut() }
            )
        case .calls:
            CallsView(
                graph: graph,
                companyId: companyId,
                me: hydratedMe,
                openConversation: { AppRouter.shared.openConversationId = $0 }
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

    /// count > 0 = numeral badge capped 9+; 0 = none.
    private func badgeLabel(_ count: Int) -> Text? {
        guard count > 0 else { return nil }
        return Text(count > 9 ? "9+" : "\(count)")
    }

    /// The single app-wide compose entry (#100/G11) — opens the
    /// outbound-first compose surface.
    private var composeButton: some View {
        Button {
            activeSheet = .compose(prefillContactId: nil)
        } label: {
            Image(systemName: "square.and.pencil")
                .font(.title3.weight(.medium))
                .foregroundStyle(BrandColor.onPetrol)
                .padding(16)
        }
        .glassEffect(.regular.tint(BrandColor.petrol).interactive())
        .accessibilityLabel("New message")
        .padding(.trailing, 20)
        .padding(.bottom, 72)
    }

    /// Hydrate the company view (numbers etc.) + live nav counts. Badges cap
    /// at 9+, so one 100-row page gives an exact-up-to-cap count. Each read is
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
