import Foundation
import PostHog

/// Crash and error tracking in PostHog (D146): fatal crashes (Mach exceptions,
/// signals, uncaught NSExceptions) reach the same PostHog project as the web
/// app and the API, symbolicated from the dSYMs the release workflow uploads.
/// Nothing else is sent: no screen views, lifecycle events, push tokens,
/// session replay or person profiles (D8).
///
/// The MetricKit log in ``CrashDiagnostics`` stays: it is what a person can
/// read and share from the Diagnostics screen without us.
///
/// The project key comes from the build (`POSTHOG_PROJECT_KEY`), which only
/// the release workflow sets, so a local build sends nothing.
enum Telemetry {
    private static let host = "https://us.i.posthog.com"

    // Built once and only ever read; NSRegularExpression is safe to share.
    nonisolated(unsafe) private static let phone =
        try? NSRegularExpression(pattern: #"\+?\d[\d\s().-]{6,}\d"#)
    nonisolated(unsafe) private static let email =
        try? NSRegularExpression(pattern: #"[\w.+-]+@[\w-]+\.[\w.-]+"#)
    // The API's public links carry their secret in the path, so cutting at the
    // query string leaves it intact; the Worker's scrubber names the same four.
    nonisolated(unsafe) private static let tokenPath =
        try? NSRegularExpression(pattern: #"(?<=/(?:photos|invite|pay|q)/)[^/?#\s]+"#)
    nonisolated(unsafe) private static let urlQuery =
        try? NSRegularExpression(pattern: #"(https?://[^\s?#]*)[?#]\S*"#)

    /// Must run before ``CrashDiagnostics/start()``, so the exception handler
    /// installed there chains into PostHog's.
    static func setup(bundle: Bundle = .main) {
        guard
            let key = bundle.object(forInfoDictionaryKey: "PostHogProjectKey") as? String,
            !key.isEmpty
        else { return }
        let config = PostHogConfig(projectToken: key, host: host)
        config.captureApplicationLifecycleEvents = false
        config.captureScreenViews = false
        config.capturePushNotificationSubscriptions = false
        config.capturePushNotificationOpened = false
        config.enableSwizzling = false
        config.preloadFeatureFlags = false
        config.sendFeatureFlagEvent = false
        config.personProfiles = .never
        config.setDefaultPersonProperties = false
        config.errorTrackingConfig.autoCapture = true
        config.setBeforeSend(scrubbed)
        PostHogSDK.shared.setup(config)
        let environment = bundle.object(forInfoDictionaryKey: "LoonextTelemetryEnvironment") as? String
        PostHogSDK.shared.register([
            "environment": environment.flatMap { $0.isEmpty ? nil : $0 } ?? "local",
            "source": "ios",
        ])
    }

    /// What error text carries: the query string and fragment of a URL, the
    /// token in a public link's path, email addresses and phone-shaped digit
    /// runs. Names are not found by pattern; app code never puts one in an error.
    static func scrubText(_ raw: String) -> String {
        var text = raw
        text = replacing(tokenPath, in: text, with: "[token]")
        text = withoutQueries(text)
        text = replacing(email, in: text, with: "[email redacted]")
        return replacing(phone, in: text, with: "[phone redacted]")
    }

    /// A URL keeps its origin and path; the query string and fragment go.
    private static func withoutQueries(_ text: String) -> String {
        guard let urlQuery else { return text }
        var result = text
        let matches = urlQuery.matches(in: text, range: NSRange(text.startIndex..., in: text))
        for match in matches.reversed() {
            guard let whole = Range(match.range, in: result),
                  let kept = Range(match.range(at: 1), in: result)
            else { continue }
            result.replaceSubrange(whole, with: String(result[kept]))
        }
        return result
    }

    private static func replacing(_ regex: NSRegularExpression?, in text: String, with template: String) -> String {
        guard let regex else { return text }
        return regex.stringByReplacingMatches(
            in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    /// Every `$exception` leaves with its messages scrubbed. Frames name
    /// images and symbols, never data, so they pass as they are.
    static func scrubbed(_ event: PostHogEvent) -> PostHogEvent {
        guard event.event == "$exception",
              let list = event.properties["$exception_list"] as? [[String: Any]]
        else { return event }
        event.properties["$exception_list"] = scrubbedExceptions(list)
        return event
    }

    static func scrubbedExceptions(_ list: [[String: Any]]) -> [[String: Any]] {
        list.map { exception in
            var copy = exception
            if let value = copy["value"] as? String { copy["value"] = scrubText(value) }
            return copy
        }
    }
}
