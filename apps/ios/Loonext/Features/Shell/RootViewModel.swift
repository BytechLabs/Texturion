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

/// #483: the waits before each retry of a bootstrap number list that failed.
///
/// GET /v1/numbers is the only source of the access-filtered list that decides
/// which per-number realtime topics this client joins, and when it fails the
/// socket opens with an EMPTY one — the company topic, and not a single
/// per-number topic. The reconnect observer in `start()` heals that on the next
/// re-JOIN, which on a healthy socket can be hours away, and since #484's
/// contract step those are hours of an inbox that never updates. Three tries
/// across ~17s turn one transient failure into a blink; going longer would only
/// race the re-JOIN heal that already exists. (Android's ladder, same numbers.)
let numberListRetryDelays: [Duration] = [.seconds(1), .seconds(4), .seconds(12)]

/// Run `attempt` after each wait in `delays` until one reports success.
///
/// Waits FIRST: a read that just failed fails the same way if it is repeated in
/// the same millisecond. `Task.isCancelled` is then checked explicitly because
/// `try?` swallows the cancellation error out of `Task.sleep` — without that
/// check a cancelled ladder would run its remaining attempts back to back,
/// reading /v1/numbers for a company the app has already moved off.
///
/// `delays` is a parameter, defaulted to the production ladder, so a test can
/// describe this schedule in milliseconds: XCTest has no virtual clock to skip
/// the seventeen seconds the way kotlinx-coroutines-test does for Android's twin.
func retryNumberList(
    delays: [Duration] = numberListRetryDelays,
    attempt: @Sendable () async -> Bool
) async -> Bool {
    for delay in delays {
        try? await Task.sleep(for: delay)
        if Task.isCancelled { return false }
        if await attempt() { return true }
    }
    return false
}

@MainActor
@Observable
final class RootViewModel {
    private(set) var state: RootState = .loading

    private let graph: AppGraph
    private var started = false

    /// Bumped by every realtime number re-derive; see `resubscribeNumbers`.
    private var numbersGeneration = 0

    /// #483: the in-flight `retryNumberList`, so bootstraps cannot stack them.
    private var numberListRetry: Task<Void, Never>?

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
        // This is also the LAST resort for a number list that failed to load at
        // bootstrap: it heals that too, but a re-JOIN can be hours away on a
        // healthy socket, which is why `numberListRetry` gets there first (#483).
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
            // #483: only ever true when the read was actually attempted AND failed.
            // An empty list is a real answer — a member restricted out of every
            // number joins the company topic alone and works — so it must not be
            // retried at; a failure wears the same shape by accident and must be.
            var numberListFailed = false
            if realtimeAllowed, let session = graph.sessionStore.current() {
                // #480: the per-number topics are joined with the company one, so
                // the list is awaited here rather than filled in afterwards — a
                // socket that opens with an incomplete subscription set has a gap
                // in it, and one small GET is the honest price of not having one.
                let numberIds = await visibleNumberIds(membership.company_id)
                numberListFailed = numberIds == nil
                await graph.realtime.connect(
                    companyId: membership.company_id,
                    numberIds: numberIds ?? [],
                    accessToken: session.accessToken
                )
            }
            state = .ready(me, companyId: membership.company_id)

            // #483: one transient failure of that GET must not cost a whole session
            // of per-number realtime. Retried OFF the bootstrap path — the shell is
            // already `.ready` above, so nothing here is waited on — and through
            // `resubscribeNumbers`, which is exactly the work the `access.changed`
            // and reconnect observers do.
            //
            // A ladder still pending from an earlier bootstrap is stale whatever
            // happened here: this pass has just read for the company it would have
            // read for.
            numberListRetry?.cancel()
            numberListRetry = nil
            if numberListFailed {
                numberListRetry = Task { [weak self] in
                    guard let self else { return }
                    // Strong `self` from here down: Swift 6 forbids referencing the
                    // captured weak var from the nested @Sendable closure (see the
                    // same upgrade in `start()`).
                    _ = await retryNumberList { await self.resubscribeNumbers() }
                }
            }
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
    /// `nil` is a FAILED read, and telling it apart from an empty list is the
    /// whole point (#483): an empty list is a real answer for a member restricted
    /// out of every number, who joins the company topic alone and works normally,
    /// while a failure produces that same shape by accident. The caller degrades
    /// either way — the company topic alone is exactly how this behaved before
    /// per-number topics existed — but only the failure is worth retrying.
    private func visibleNumberIds(_ companyId: String) async -> [String]? {
        let page: Page<PhoneNumberSummary>? = try? await graph.api.get(
            "/v1/numbers",
            companyId: companyId
        )
        return page?.data.map(\.id)
    }

    /// Re-derive the number list and move the realtime subscription onto it.
    /// Only in `.ready`: any other state has no socket to reconcile.
    ///
    /// Two signals drive this and access can change twice in a row, so a slow
    /// response must not land after a newer one and re-subscribe to a set that
    /// has already been superseded — which, for a revoked number, would mean
    /// staying on its channel with nothing left to correct it.
    ///
    /// Reports whether a fresh list was actually applied, which is what the #483
    /// bootstrap ladder needs to know when it is standing in for a GET that
    /// failed. A superseded answer reports `false` too: a newer read owns the
    /// subscription set now, and if the ladder has rungs left, one more cheap GET
    /// beats betting the heal on a result we just discarded. The two observers in
    /// `start()` ignore it — they fire off a signal that will come again, so there
    /// is nothing for them to do about a `false`.
    @discardableResult
    private func resubscribeNumbers() async -> Bool {
        guard case .ready(_, let companyId) = state else { return false }
        numbersGeneration += 1
        let generation = numbersGeneration
        guard let numberIds = await visibleNumberIds(companyId) else { return false }
        guard generation == numbersGeneration else { return false }
        await graph.realtime.setNumbers(numberIds)
        return true
    }
}
