import SwiftUI

/// The root router: one screen per `RootState`. External steps (workspace
/// creation, checkout) hand off to the web app in external Safari — the app
/// never fakes those flows.
@MainActor
struct RootView: View {
    let graph: AppGraph
    @State private var model: RootViewModel
    /// #339: owned here rather than in the shell, because the update gate
    /// outranks every routed state including signed-out.
    @State private var updates: UpdateRepository
    @Environment(\.scenePhase) private var scenePhase

    /// #228: the language this app draws itself in, resolved once here and
    /// published to every screen below.
    ///
    /// Read from the store rather than from `me` because the router has four
    /// states that hold no `me` at all — signed out, the two-factor wall, both
    /// web hand-offs — and every one of them is a screen somebody reads. The
    /// store answers for all of them: the member's own setting once `/v1/me`
    /// has landed, and the phone's own language before that.
    private var appLocale: String { UiLocaleStore.shared.resolved }

    init(graph: AppGraph) {
        self.graph = graph
        _model = State(initialValue: RootViewModel(graph: graph))
        _updates = State(initialValue: graph.updates)
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                CenteredLoading()

            case .signedOut:
                AuthFlow(authManager: graph.authManager)

            // #496/#314: the two-factor wall. The whole screen rather than an
            // overlay on the shell — there is no shell yet, because every
            // company-scoped read behind it is being refused.
            case .needsMfa(let enrolmentRequired):
                MfaGateView(
                    graph: graph,
                    enrolmentRequired: enrolmentRequired,
                    onSatisfied: model.retry,
                    onSignOut: model.signOut
                )

            case .needsWorkspace:
                ExternalStepView(
                    headline: AppStrings.translate(appLocale, "shell.needsWorkspaceTitle"),
                    body: AppStrings.translate(appLocale, "shell.needsWorkspaceBody"),
                    cta: AppStrings.translate(appLocale, "shell.needsWorkspaceCta"),
                    url: ExternalStepView.onboardingURL,
                    onRefresh: model.retry,
                    onSignOut: model.signOut
                )

            case .needsCheckout:
                ExternalStepView(
                    headline: AppStrings.translate(appLocale, "shell.needsCheckoutTitle"),
                    body: AppStrings.translate(appLocale, "shell.needsCheckoutBody"),
                    cta: AppStrings.translate(appLocale, "shell.needsCheckoutCta"),
                    url: ExternalStepView.planURL,
                    onRefresh: model.retry,
                    onSignOut: model.signOut
                )

            case .failed(let message):
                CenteredError(message: message, onRetry: model.retry)

            case .ready(let me, let companyId):
                ShellView(graph: graph, me: me, companyId: companyId, root: model)
                    .id(companyId) // workspace switch = fresh shell state
            }
        }
        // #218: the adaptive Paper & Olive canvas sits behind EVERY gate state,
        // so the loading spinner and the error retry (which draw no surface of
        // their own) are legible in both themes instead of falling back to the
        // bare system background. AuthFlow / ExternalStepView paint their own
        // canvas; the ready shell draws edge-to-edge over this.
        .background(BrandColor.canvas.ignoresSafeArea())
        // #228: the one place the app's language is published. Everything below
        // this line — the auth screens, the gates, the whole shell — reads it
        // out of the environment rather than resolving it again.
        //
        // NOT the whole app: `AppLockGate` and the app-switcher cover are
        // MOUNTED ABOVE this view (a locked app must not build the inbox at
        // all), so they read `UiLocaleStore` directly. Same store, same answer.
        .environment(\.appLocale, appLocale)
        // #339: ambient when an update is merely available; a full stop only
        // below the server-set floor (D71). An overlay on the ROUTER, not on
        // the shell, so the block also covers the signed-out and interstitial
        // states — a build below the floor is below it before anyone signs in.
        .overlay { UpdatePrompt(state: updates.state) }
        .task { model.start() }
        .task { await updates.refresh() }
        // #289: the realtime socket follows the app, not the session.
        //
        // Both apps connected on sign-in and disconnected on sign-out, so a
        // phone in a pocket held a WebSocket and sent a heartbeat every 25
        // seconds all day. iOS suspends a backgrounded process within seconds
        // anyway, which sounds like it makes this moot and does the opposite:
        // the socket dies without the app ever saying so, and it resumes into a
        // reconnect it did not schedule. Saying it out loud is what makes the
        // behaviour a decision rather than a side effect.
        //
        // On the ROUTER rather than the shell so it also covers the states that
        // hold a session without a shell — the MFA gate, checkout — where a
        // socket is just as connected and just as unwatched.
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active: model.appDidBecomeActive()
            case .background: model.appDidEnterBackground()
            // .inactive is a transition — the app switcher, a notification
            // shade, an incoming call banner. Acting on it would drop the
            // socket every time somebody pulled down Control Centre.
            default: break
            }
        }
    }
}

/// A signed-in interstitial that hands off to the web app in external Safari.
@MainActor
struct ExternalStepView: View {
    // Static hand-off targets — the web owns onboarding + checkout.
    static let onboardingURL = URL(string: "https://app.loonext.com/onboarding")!
    static let planURL = URL(string: "https://app.loonext.com/onboarding/plan")!

    let headline: String
    let message: String
    let cta: String
    let url: URL
    let onRefresh: @MainActor () -> Void
    let onSignOut: @MainActor () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    init(
        headline: String,
        body: String,
        cta: String,
        url: URL,
        onRefresh: @escaping @MainActor () -> Void,
        onSignOut: @escaping @MainActor () -> Void
    ) {
        self.headline = headline
        self.message = body
        self.cta = cta
        self.url = url
        self.onRefresh = onRefresh
        self.onSignOut = onSignOut
    }

    var body: some View {
        // #180: centered on tall viewports, but scrolls the instant the copy +
        // three actions can't fit a short/square window — Sign out stays
        // reachable. The 440 cap keeps the column from stretching on iPad.
        GeometryReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    Text(headline)
                        .font(.display(24))
                        .foregroundStyle(BrandColor.ink)
                        .multilineTextAlignment(.center)
                    Text(message)
                        .font(.golos(13.5))
                        .foregroundStyle(BrandColor.muted600)
                        .multilineTextAlignment(.center)
                        .padding(.top, 8)
                        .padding(.bottom, 20)
                    PrimaryButton(title: cta, enabled: true) {
                        openURL(url)
                    }
                    Button(
                        AppStrings.translate(appLocale, "shell.externalRefresh"),
                        action: onRefresh
                    )
                    .font(.golos(13, weight: .medium))
                    .padding(.top, 12)
                    Button(
                        AppStrings.translate(appLocale, "shell.signOut"),
                        action: onSignOut
                    )
                    .font(.golos(13, weight: .medium))
                    .padding(.top, 8)
                }
                .frame(maxWidth: 440)
                .padding(.horizontal, 28)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .tint(BrandColor.olive)
    }
}
