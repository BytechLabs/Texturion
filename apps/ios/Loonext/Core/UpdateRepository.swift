import Foundation
import Observation

/// What the app knows about its own currency, and why.
struct UpdateState: Sendable {
    var requirement: UpdateRequirement = .none
    var policy: AppReleasePolicy?
}

/// #339 — reads the public update policy.
///
/// DELIBERATELY NOT THROUGH `ApiClient`. That client attaches a bearer token
/// and refreshes it on the way; this endpoint is public precisely because the
/// reason to demand an update may be that auth is broken in this very build
/// (#268 signs the user out on a transient refresh failure). A policy only a
/// working session can fetch cannot reach the builds that need it.
///
/// EVERY failure resolves to "no policy", which resolves to `.none`. A blip on
/// the network must never become an update wall on somebody's business phone.
@MainActor
@Observable
final class UpdateRepository {
    private(set) var state = UpdateState()

    private let baseURL: String
    private let session: URLSession

    init(baseURL: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.session = session
    }

    /// Ask once per launch, and on foreground — which is when a store update
    /// would have landed. Cheap: the endpoint is edge-cached for five minutes.
    func refresh() async {
        let policy = await fetch()
        state = UpdateState(
            requirement: updateRequirement(AppVersion.current, policy),
            policy: policy
        )
    }

    private func fetch() async -> AppReleasePolicy? {
        var trimmed = baseURL
        while trimmed.hasSuffix("/") { trimmed.removeLast() }
        guard let url = URL(string: "\(trimmed)/app-release?platform=ios") else { return nil }

        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
            else { return nil }
            return try JSONDecoder().decode(AppReleasePolicy.self, from: data)
        } catch {
            // Unreachable, or a body we cannot read. Same conclusion either
            // way: ask nothing of anybody.
            return nil
        }
    }
}
