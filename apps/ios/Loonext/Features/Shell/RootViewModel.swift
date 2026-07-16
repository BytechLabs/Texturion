import Foundation
import Observation

/// Mirrors the web's CompanyProvider bootstrap (and the Android
/// RootViewModel): session → GET /v1/me → resolve active company (persisted
/// pick or first membership) → route.
enum RootState {
    case loading
    case signedOut

    /// Signed in, zero memberships — workspace creation lives on web (checkout).
    case needsWorkspace(Me)

    /// Owner/admin with subscription_status incomplete — finish checkout on web.
    case needsCheckout(Me, companyId: String)

    case ready(Me, companyId: String)

    case failed(String)
}

@MainActor
@Observable
final class RootViewModel {
    private(set) var state: RootState = .loading

    private let graph: AppGraph
    private var started = false

    init(graph: AppGraph) {
        self.graph = graph
    }

    /// Idempotent; called once from the root view's `.task`.
    func start() {
        guard !started else { return }
        started = true

        // A dead refresh token anywhere lands back on login.
        Task { [weak self] in
            guard let graph = self?.graph else { return }
            await graph.api.setSignedOutHandler {
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    await self.graph.realtime.disconnect()
                    self.state = .signedOut
                }
            }
        }

        // Session appearing/disappearing drives everything.
        Task { [weak self] in
            guard let changes = self?.graph.sessionStore.changes else { return }
            for await session in changes {
                guard let self else { return }
                if session == nil {
                    await self.graph.realtime.disconnect()
                    self.state = .signedOut
                } else if self.isSignedOutOrLoading {
                    await self.bootstrap()
                }
            }
        }

        // Initial route from the persisted session.
        Task { [weak self] in
            guard let self else { return }
            if self.graph.sessionStore.current() == nil {
                self.state = .signedOut
            } else {
                await self.bootstrap()
            }
        }
    }

    private var isSignedOutOrLoading: Bool {
        switch state {
        case .signedOut, .loading: true
        default: false
        }
    }

    func retry() {
        state = .loading
        Task { await self.bootstrap() }
    }

    func switchWorkspace(_ companyId: String) {
        graph.prefs.setActiveCompany(companyId)
        Task { await self.bootstrap() }
    }

    func signOut() {
        // The session-changes stream observes the clear and routes to login.
        Task {
            // Best-effort device push-token delete BEFORE the session clears —
            // the DELETE needs the bearer (#151); failure never blocks sign-out.
            await PushCoordinator.shared.ensureRegistrar(api: graph.api).unregister()
            await self.graph.authManager.signOut()
        }
    }

    private func bootstrap() async {
        do {
            let me = try await graph.meApi.me()
            guard !me.memberships.isEmpty else {
                state = .needsWorkspace(me)
                return
            }
            let stored = graph.prefs.activeCompanyId
            let membership = me.memberships.first { $0.company_id == stored } ?? me.memberships[0]
            graph.prefs.setActiveCompany(membership.company_id)

            let incomplete = membership.subscription_status == SubscriptionStatus.incomplete ||
                membership.subscription_status == SubscriptionStatus.incompleteExpired
            if incomplete, MemberRole.atLeast(membership.role, required: MemberRole.admin) {
                state = .needsCheckout(me, companyId: membership.company_id)
                return
            }

            // Connect realtime for the active workspace.
            if let session = graph.sessionStore.current() {
                await graph.realtime.connect(
                    companyId: membership.company_id,
                    accessToken: session.accessToken
                )
            }
            state = .ready(me, companyId: membership.company_id)
        } catch let error as ApiError {
            state = error.code == ApiErrorCode.unauthorized ? .signedOut : .failed(error.message)
        } catch {
            state = .failed("Couldn't load your workspace.")
        }
    }
}
