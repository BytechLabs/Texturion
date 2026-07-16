import Foundation

/// Main-actor wiring points between the push stack and the rest of the app —
/// the iOS twin of Android's push/PushHooks.kt.
///
/// The integrator (shell) sets `router` once the Ready shell exists; the
/// calls pass (#161) sets `callWakeHandler`; the thread screen (#159) keeps
/// `viewedConversationId` current so foreground banners for the thread the
/// user is already reading are suppressed (realtime shows the message).
@MainActor
enum PushHooks {
    /// Deep-link seam: notification taps and universal links land here as a
    /// parsed `PushRoute` (`/inbox/{id}` → `.thread`, `/calls?call=…` →
    /// `.calls`). Setting it drains any tap buffered before the shell was
    /// ready (cold start from a notification — the Android
    /// MainActivity-intent StateFlow equivalent).
    static var router: (@MainActor (PushRoute) -> Void)? {
        didSet {
            guard let router, let pending = pendingRoute else { return }
            pendingRoute = nil
            router(pending)
        }
    }

    /// A tap that arrived before the shell installed its router.
    private(set) static var pendingRoute: PushRoute?

    /// The calls-wake seam (#135/#161). An incoming-call push (`kind:'call'`)
    /// received in the FOREGROUND is handed here instead of being shown as a
    /// banner when a handler is installed — #161's softphone should register,
    /// then POST /v1/calls/live/{sessionId}/ring-me exactly once
    /// (`PushContent.callSessionId` carries the session id). While nil, call
    /// pushes fall back to the system alert with the `/calls?call=…` deep
    /// link — never silently dropped. The BACKGROUND wake path (VoIP/PushKit)
    /// belongs entirely to #161, not this stack.
    static var callWakeHandler: (@MainActor (PushContent) -> Void)?

    /// The conversation currently on screen; nil when no thread is open.
    /// The thread screen (#159) sets it on appear and clears it on disappear.
    static var viewedConversationId: String?

    /// Route now if the shell is ready, else buffer for the router install.
    static func route(_ route: PushRoute) {
        if let router {
            router(route)
        } else {
            pendingRoute = route
        }
    }
}
