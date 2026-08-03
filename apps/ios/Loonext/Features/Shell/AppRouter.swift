import Combine
import Foundation

/// The app-wide navigation seam shared by the shell, tabs, and global
/// overlays — the iOS flattening of Android's ReadyShell `overlay` state into
/// commands + one report. The shell owns a single root navigation stack; a
/// command here appends the matching surface ABOVE the tab shell (#186), so a
/// pushed surface with the pill nav is not constructible.
///
/// Commands (shell consumes, then clears):
/// - `openConversationId` — open this thread. When set alongside
///   `pendingHighlightMessageId` (search hits), the thread scrolls to and
///   flashes that message.
/// - `openTaskId` — open this task's detail surface.
/// - `openContactId` — open this contact's detail surface.
/// - `openCalls` — show the calls surface (a nav tab since the Paper & Olive
///   shell).
/// - `openContacts` — show the contacts surface (nav-less destination reached
///   from the account sheet).
/// - `openInbox` + `inboxDestination` — show the inbox landed on a filter
///   (#508, the response-time card's unanswered row). The Android twin of this
///   pair is the `InboxDestination` the shell holds and hands down.
/// - `composeTo` — open compose seeded with a raw phone number (#459, the
///   dialer's Text action).
///
/// Reports:
/// - `viewedConversationId` — the thread currently on screen (nil when none).
///   The thread route keeps it current so global surfaces (the inbound toast,
///   foreground push banners) stay quiet for the open thread.
/// - `contactsRevision` — bumped when a pushed contact detail pops, so the
///   contacts list re-fetches edits/opt-outs/deletes made inside it (the
///   Android list's realtime/cache refresh has no iOS twin, so the pop signals
///   it explicitly).
/// #508: an arrangement the inbox should land on, asked for by another surface.
///
/// The response-time card's "N leads nobody answered" row is a DESTINATION, not
/// a chip: tapping it switches tab and the inbox has to arrive already filtered.
/// The `token` is what lets a second tap re-apply the filter after the reader
/// has wandered off it — a bare case would be consumed once and then be unable
/// to say anything new.
struct InboxDestination: Equatable, Sendable {
    enum Filter: Equatable, Sendable {
        /// Threads nobody has replied to yet (the #388 lead clock).
        case awaiting
    }

    let filter: Filter
    let token: Int
}

@MainActor final class AppRouter: ObservableObject {
    static let shared = AppRouter()
    @Published var openConversationId: String?   // command: open this thread (shell pushes a thread route, then clears)
    @Published var pendingHighlightMessageId: String?  // set alongside openConversationId by search hits only
    @Published var openTaskId: String?           // command: open this task's detail (shell pushes, then clears)
    @Published var openContactId: String?        // command: open this contact's detail (shell pushes, then clears)
    @Published var openCalls: Bool = false        // command: show the calls tab
    @Published var openContacts: Bool = false     // command: show the contacts surface
    // #508 command: show the inbox landed on a filter. Two fields for the same
    // reason `openConversationId` and `pendingHighlightMessageId` are two: the
    // SHELL owns the tab switch and the INBOX owns its own filters, so each
    // consumes and clears the half it owns. `inboxDestination` is set first so
    // the inbox has it whether it was already on screen or is composed by the
    // switch — a @Published republishes its current value to a late subscriber.
    @Published var openInbox: Bool = false
    @Published var inboxDestination: InboxDestination?
    // #459 command: compose to a raw number (the dialer's Text action). A
    // number rather than a contact id, because the point of dialing a stranger
    // is that we have never met them.
    @Published var composeTo: String?
    // command: open settings AT one section, for a surface offering a specific
    // setting as the fix for what the reader is looking at (shell opens the
    // sheet seeded with it, then clears)
    @Published var openSettingsSection: SettingsSection?
    @Published var viewedConversationId: String?  // report: thread currently on screen (nil when none)
    @Published var contactsRevision: Int = 0      // report: a pushed contact detail popped — refetch the list
}
