import Combine
import Foundation

/// The app-wide navigation seam shared by the shell, tabs, and global
/// overlays — the iOS flattening of Android's ReadyShell `overlay` state into
/// commands + one report:
///
/// - `openConversationId` — command: open this thread. The shell switches to
///   the Inbox tab; the inbox tab consumes the id and clears it.
/// - `openCalls` — command: present the calls surface. The shell consumes and
///   clears it.
/// - `viewedConversationId` — report: the thread currently on screen (nil
///   when none). The thread screen keeps it current so global surfaces (the
///   inbound toast, foreground push banners) stay quiet for the open thread.
@MainActor final class AppRouter: ObservableObject {
    static let shared = AppRouter()
    @Published var openConversationId: String?   // command: open this thread (inbox tab consumes then clears)
    @Published var openCalls: Bool = false        // command: present the calls surface
    @Published var viewedConversationId: String?  // report: thread currently on screen (nil when none)
}
