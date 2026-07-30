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

    /// Bumped by every realtime number re-derive; see `resubscribeNumbers`.
    private var numbersGeneration = 0

    init(graph: AppGraph) {
        self.graph = graph
    }

    /// Idempotent; called once from the root view's `.task`.
    func start() {
        guard !started else { return }
        started = true

        // A dead refresh token anywhere lands back on login. Each closure
        // boundary upgrades `weak self` (a captured var) to a strong `let`
        // before the next @Sendable capture — Swift 6 forbids referencing the
        // var from nested concurrent code (CI run 6).
        Task { [weak self] in
            guard let self else { return }
            await self.graph.api.setSignedOutHandler { [weak self] in
                guard let self else { return }
                Task { @MainActor in
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

        // #480: number access changed somewhere in this company — re-derive the
        // subscription set, not just the screens' data.
        //
        // Realtime authorization is a JOIN-TIME handshake: the topic policy runs
        // on `phx_join` and on a pushed token, never per broadcast. So a member
        // who just lost a number keeps receiving that number's events for up to
        // an hour unless the client LEAVES the channel, which is what asking the
        // server for the list again and re-subscribing does. The payload names
        // only the company, so nobody can tell whether they were the subject —
        // everyone re-derives and the server's answer decides.
        Task { [weak self] in
            guard let realtime = self?.graph.realtime else { return }
            for await event in await realtime.events()
                where event.event == "access.changed" {
                guard let self else { return }
                await self.resubscribeNumbers()
            }
        }

        // Broadcasts are not replayed, so an `access.changed` that landed while
        // the socket was down is simply gone — re-derive on every re-JOIN too.
        // This is also what heals a number list that failed to load at bootstrap.
        // It overlaps the observer above (an `access.changed` also fires the
        // reconnect signal) and that is fine: the newest answer wins and an
        // unchanged set costs nothing.
        Task { [weak self] in
            guard let realtime = self?.graph.realtime else { return }
            for await _ in await realtime.reconnected() {
                guard let self else { return }
                await self.resubscribeNumbers()
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
            //
            // #283: unless the realtime kill switch is off. This is the one
            // switch the server cannot enforce — the app holds its own Supabase
            // token and opens its own socket, so there is nothing for the
            // Worker to refuse. Not connecting leaves the app on its normal
            // refresh path: slower, never wrong.
            //
            // `!= false` rather than a truthiness check: an absent flag means
            // "no statement", which must read as ON.
            let realtimeAllowed = me.flags?["kill:realtime"] != false
            if realtimeAllowed, let session = graph.sessionStore.current() {
                // #480: the per-number topics are joined with the company one, so
                // the list is awaited here rather than filled in afterwards — a
                // socket that opens with an incomplete subscription set has a gap
                // in it, and one small GET is the honest price of not having one.
                let numberIds = await visibleNumberIds(membership.company_id)
                await graph.realtime.connect(
                    companyId: membership.company_id,
                    numberIds: numberIds,
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

    /// The ids of the numbers this member may see — one realtime topic each
    /// (#480). GET /v1/numbers is ALREADY access-filtered server-side (#106), so
    /// this asks rather than reasons: a client-side reading of the access rule
    /// would be the extra implementation D88 spent an issue removing.
    ///
    /// A failure yields no numbers, which leaves the client on the company topic
    /// alone — exactly how it behaved before per-number topics existed, so a
    /// flaky call degrades instead of breaking. The list is re-derived on
    /// `access.changed` and on every re-JOIN, so it heals.
    private func visibleNumberIds(_ companyId: String) async -> [String] {
        let page: Page<PhoneNumberSummary>? = try? await graph.api.get(
            "/v1/numbers",
            companyId: companyId
        )
        return page?.data.map(\.id) ?? []
    }

    /// Re-derive the number list and move the realtime subscription onto it.
    /// Only in `.ready`: any other state has no socket to reconcile.
    ///
    /// Two signals drive this and access can change twice in a row, so a slow
    /// response must not land after a newer one and re-subscribe to a set that
    /// has already been superseded — which, for a revoked number, would mean
    /// staying on its channel with nothing left to correct it.
    private func resubscribeNumbers() async {
        guard case .ready(_, let companyId) = state else { return }
        numbersGeneration += 1
        let generation = numbersGeneration
        let numberIds = await visibleNumberIds(companyId)
        guard generation == numbersGeneration else { return }
        await graph.realtime.setNumbers(numberIds)
    }
}
