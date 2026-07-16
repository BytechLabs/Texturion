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

/// The mobile shell: native Liquid Glass tab bar (For you · Inbox · Tasks ·
/// Contacts · You) + the single app-wide compose entry (#100/G11). Selecting
/// "You" opens the account sheet instead of switching tabs.
@MainActor
struct ShellView: View {
    let graph: AppGraph
    let companyId: String
    let root: RootViewModel

    @State private var hydratedMe: Me
    @State private var tab: ShellTab = .forYou
    @State private var sheetOpen = false
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
                ForYouTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .badge(badgeLabel(counts.forYou))
            }
            Tab("Inbox", systemImage: "tray.fill", value: ShellTab.inbox) {
                InboxTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .badge(badgeLabel(counts.unreadConversations))
            }
            Tab("Tasks", systemImage: "checklist", value: ShellTab.tasks) {
                TasksTab(graph: graph, companyId: companyId, me: hydratedMe)
                    .badge(badgeLabel(counts.openTasks))
            }
            Tab("Contacts", systemImage: "person.2.fill", value: ShellTab.contacts) {
                ContactsTab(graph: graph, companyId: companyId)
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
                sheetOpen = true
            }
        }
        .sheet(isPresented: $sheetOpen) {
            AccountSheet(
                prefs: graph.prefs,
                me: hydratedMe,
                companyId: companyId,
                onSwitchWorkspace: { root.switchWorkspace($0) },
                onSignOut: { root.signOut() }
            )
        }
        .overlay(alignment: .bottomTrailing) { composeButton }
        .task(id: countsKey) { await reloadCounts() }
        .task(id: companyId) {
            for await _ in await graph.realtime.events() {
                countsKey &+= 1
            }
        }
    }

    /// count > 0 = numeral badge capped 9+; 0 = none.
    private func badgeLabel(_ count: Int) -> Text? {
        guard count > 0 else { return nil }
        return Text(count > 9 ? "9+" : "\(count)")
    }

    /// The single app-wide compose entry. The compose screen ships with the
    /// messaging pass (#159); until it lands the button lands on the inbox —
    /// no dead tap, no fake UI.
    private var composeButton: some View {
        Button {
            tab = .inbox
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
    }
}
