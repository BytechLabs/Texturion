import SwiftUI

/// The root router: one screen per `RootState`. External steps (workspace
/// creation, checkout) hand off to the web app in external Safari — the app
/// never fakes those flows.
@MainActor
struct RootView: View {
    let graph: AppGraph
    @State private var model: RootViewModel

    init(graph: AppGraph) {
        self.graph = graph
        _model = State(initialValue: RootViewModel(graph: graph))
    }

    var body: some View {
        Group {
            switch model.state {
            case .loading:
                CenteredLoading()

            case .signedOut:
                AuthFlow(authManager: graph.authManager)

            case .needsWorkspace:
                ExternalStepView(
                    headline: "Let's set up your workspace",
                    body: "Workspace creation and checkout live on the web for now. "
                        + "Create yours at app.loonext.com, then come back and refresh.",
                    cta: "Open app.loonext.com",
                    url: ExternalStepView.onboardingURL,
                    onRefresh: model.retry,
                    onSignOut: model.signOut
                )

            case .needsCheckout:
                ExternalStepView(
                    headline: "Finish setting up",
                    body: "Your workspace hasn't completed checkout yet. Finish on the web "
                        + "and your number, texting, and calling light up here.",
                    cta: "Finish checkout",
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
        .task { model.start() }
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
                    Button("I've done this — refresh", action: onRefresh)
                        .font(.golos(13, weight: .medium))
                        .padding(.top, 12)
                    Button("Sign out", action: onSignOut)
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
