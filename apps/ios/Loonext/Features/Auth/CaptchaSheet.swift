import SwiftUI
import WebKit

/// The native side of the #166 captcha bridge. Production Supabase Auth has
/// Turnstile enabled, and Turnstile validates the widget's HOSTNAME — so the
/// widget lives on app.loonext.com (`/native-captcha`, shipped with the web
/// app) and this sheet hosts that page in a WKWebView. The page posts the
/// minted token to `webkit.messageHandlers.loonextCaptcha`.
///
/// Contract: `onResult` fires with a token when the widget solves, or nil on
/// cancel. Tokens are SINGLE-USE — callers re-present the sheet to mint a
/// fresh one for every retry. The PRESENTER owns visibility (this view never
/// dismisses itself), so a swipe-down dismissal routes through the
/// presenter's `onDismiss` as a nil result.
@MainActor
struct CaptchaSheet: View {
    let onResult: @MainActor (String?) -> Void

    @State private var loading = true
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ZStack {
                if failed {
                    VStack(spacing: 16) {
                        Text("Couldn't load the security check. Check your connection.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                        Button("Try again") {
                            // Leaving and re-entering the else branch below
                            // rebuilds the web view from scratch.
                            failed = false
                            loading = true
                        }
                        .buttonStyle(.bordered)
                    }
                } else {
                    CaptchaWebView(
                        onToken: { onResult($0) },
                        onLoaded: { loading = false },
                        onFailed: {
                            loading = false
                            failed = true
                        }
                    )
                    .ignoresSafeArea(edges: .bottom)
                    if loading {
                        ProgressView()
                            .controlSize(.large)
                    }
                }
            }
            .navigationTitle("Quick security check")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onResult(nil) }
                }
            }
        }
    }
}

/// The WKWebView host: loads the bridge page, fences MAIN-FRAME navigation to
/// the app origin (the Turnstile challenge itself runs in a
/// challenges.cloudflare.com SUBFRAME, which must stay allowed), and receives
/// the token via the `loonextCaptcha` script message handler.
private struct CaptchaWebView: UIViewRepresentable {
    static let pageURL = URL(string: "https://app.loonext.com/native-captcha")!
    static let messageHandlerName = "loonextCaptcha"

    let onToken: @MainActor (String) -> Void
    let onLoaded: @MainActor () -> Void
    let onFailed: @MainActor () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onToken: onToken, onLoaded: onLoaded, onFailed: onFailed)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(
            context.coordinator,
            name: Self.messageHandlerName
        )
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.load(URLRequest(url: Self.pageURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        // WKUserContentController retains its handlers — detach on teardown.
        webView.configuration.userContentController
            .removeScriptMessageHandler(forName: messageHandlerName)
        webView.navigationDelegate = nil
        webView.stopLoading()
    }

    @MainActor
    final class Coordinator: NSObject {
        private let onToken: @MainActor (String) -> Void
        private let onLoaded: @MainActor () -> Void
        private let onFailed: @MainActor () -> Void
        /// The bridge page can re-post on widget refreshes; deliver only once.
        private var delivered = false

        init(
            onToken: @escaping @MainActor (String) -> Void,
            onLoaded: @escaping @MainActor () -> Void,
            onFailed: @escaping @MainActor () -> Void
        ) {
            self.onToken = onToken
            self.onLoaded = onLoaded
            self.onFailed = onFailed
        }

        fileprivate func deliver(_ token: String) {
            guard !delivered else { return }
            delivered = true
            onToken(token)
        }

        fileprivate func loaded() { onLoaded() }
        fileprivate func failed() { onFailed() }
    }
}

/// WebKit calls both delegate protocols on the main thread, so the
/// `@preconcurrency` conformances' main-actor assumption always holds (the
/// CallKitBridge pattern from CI run 6).
extension CaptchaWebView.Coordinator: @preconcurrency WKScriptMessageHandler {
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard message.name == CaptchaWebView.messageHandlerName,
              let token = message.body as? String,
              !token.isEmpty
        else { return }
        deliver(token)
    }
}

extension CaptchaWebView.Coordinator: @preconcurrency WKNavigationDelegate {
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction
    ) async -> WKNavigationActionPolicy {
        // Subframes host the Turnstile challenge — only the main frame is
        // fenced. A nil targetFrame is a new-window attempt: fence that too.
        let isMainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        guard isMainFrame else { return .allow }
        guard let url = navigationAction.request.url else { return .cancel }
        if url.scheme == "about" { return .allow }
        let sameOrigin = url.scheme == "https"
            && url.host()?.lowercased() == CaptchaWebView.pageURL.host()
        return sameOrigin ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded()
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: Error
    ) {
        failed()
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        failed()
    }
}
