import XCTest

@testable import Loonext

/// [#593] The handover funnel, RUN rather than read.
///
/// `HandoverGateTests` beside this reads the source text of `attemptHandover` and asserts
/// its shape. Those checks are worth keeping and they have caught real mutations — the
/// deleted `!` that inverted every destination while all ten assertions stayed green —
/// but a check over text cannot assert the one thing that matters:
///
///   **no request our own server receives ever contains the six digits.**
///
/// That is a HARD LOCKOUT, not a style question. The reprove route reads how long ago this
/// session proved a factor and never reads a code, so digits posted at it come back
/// refused to every correct code, forever, and nobody can hand over, close or release
/// anything. The property was wrong on three clients at once, twice, while every suite was
/// green.
///
/// ## Two transports, deliberately
///
/// One `HTTPClient` stands in for OUR API and one for the identity provider, and they are
/// separate objects. A single stub routing both by path would make the central assertion
/// meaningless — "our server never saw the digits" only says something when there is a
/// different server that did. The seam this needs is the one #593 asked for: the funnel
/// takes the identity client as a defaulted trailing parameter, and that client now has
/// the same transport seam `ApiClient` has always had.
///
/// ## What is real here
///
/// `attemptHandover`, `handoverProveThenRetry`, `handoverReproveFactor`, `ApiClient`,
/// `SettingsRepository`, `SettingsAuthClient`, `SessionStore`, `AppGraph` and a real
/// `SettingsScope`. Only the two transports are doubles.
@MainActor
final class HandoverFunnelRunTests: XCTestCase {
    /// The digits somebody reads off their authenticator.
    private let code = "864209"

    /// A transport that records every request it is given, and answers by path.
    ///
    /// The recording is the point: `seen` is what a server would have received, bytes and
    /// all, which is the only place the leak this file guards is visible.
    private final class Recorder: HTTPClient, @unchecked Sendable {
        /// One request, as a server would have received it.
        struct Seen {
            let path: String
            let body: String
            let bearer: String
        }

        private let route: @Sendable (String, String) -> (Int, String)
        /// `data(for:)` is a non-isolated async requirement, so this is reached off any
        /// actor. A lock behind `@unchecked Sendable` is the shape that compiles under
        /// both Swift 5 and strict concurrency; the `StubTransport` already in this suite
        /// sidesteps the question by recording nothing, which is the thing this file needs.
        private let lock = NSLock()
        private var recorded: [Seen] = []

        init(route: @escaping @Sendable (String, String) -> (Int, String)) {
            self.route = route
        }

        /// `withLock` at both sites, not `lock()`/`unlock()`.
        ///
        /// Those two are `@available(*, noasync)` — holding a lock across a suspension
        /// point is a deadlock waiting to happen, so Swift refuses them in an async
        /// function outright. `data(for:)` is async, and CI said so: "instance method
        /// 'lock' is unavailable from asynchronous contexts". The scoped form cannot span
        /// an `await` by construction, which is why it is allowed and why it is right.
        var seen: [Seen] { lock.withLock { recorded } }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            let path = request.url?.path ?? ""
            let bytes = request.httpBody ?? Data()
            let body = String(data: bytes, encoding: .utf8) ?? ""
            let bearer = request.value(forHTTPHeaderField: "Authorization") ?? ""
            lock.withLock {
                recorded.append(Seen(path: path, body: body, bearer: bearer))
            }
            let (status, payload) = route(path, bearer)
            let response = HTTPURLResponse(
                url: request.url ?? URL(string: "https://example.invalid")!,
                statusCode: status,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(payload.utf8), response)
        }

        var paths: [String] { seen.map { $0.path } }

        /// Every request whose body carried these digits.
        func requestsCarrying(_ digits: String) -> [String] {
            seen.filter { $0.body.contains(digits) }.map { $0.path }
        }
    }

    /// Our API, refusing on the rule the real route uses: THE AGE OF THE PROOF IN THE
    /// TOKEN, not a counter.
    ///
    /// A stub that refused only the first attempt and then succeeded would hide an entire
    /// arm — the second post would return 200, so the `catch` would never run and the
    /// destination re-check would never happen. That mistake was made and caught on the
    /// Android twin. This one refuses every attempt presenting the stale token and accepts
    /// any attempt presenting the fresh one, which makes both paths reachable and makes a
    /// retry that re-posted the digits fail rather than quietly pass.
    private func ourApi() -> Recorder {
        Recorder { path, bearer in
            let proved = bearer == "Bearer token-2"
            switch path {
            case "/v1/company/ownership/accept":
                return proved
                    ? (200, #"{"owner_user_id":"user-2"}"#)
                    : (
                        403,
                        #"{"error":{"code":"mfa_reprove_required","#
                            + #""message":"Confirm with your authenticator app."}}"#
                    )
            // GET /v1/mfa lists VERIFIED factors only, so the first is a real one.
            case "/v1/mfa":
                return (
                    200,
                    #"{"enrolled":true,"factors":[{"id":"factor-1","#
                        + #""friendly_name":"Phone","status":"verified"}]}"#
                )
            default:
                return (404, #"{"error":{"code":"not_found","message":"not in this test"}}"#)
            }
        }
    }

    /// The identity provider. Challenge, then verify, and verify hands back a fresh
    /// session whose token is the one our API will accept.
    private func identityProvider() -> Recorder {
        Recorder { path, _ in
            if path.hasSuffix("/challenge") {
                return (200, #"{"id":"chal-1"}"#)
            }
            if path.hasSuffix("/verify") {
                return (
                    200,
                    #"{"access_token":"token-2","refresh_token":"refresh-2","#
                        + #""expires_in":3600,"token_type":"bearer","#
                        + #""user":{"id":"user-1","email":"owner@example.com"}}"#
                )
            }
            return (404, #"{"error":"not in this test"}"#)
        }
    }

    /// One graph, one session store — which is the lesson the Android twin taught.
    ///
    /// The funnel reads the token through the repository and SAVES the fresh one through
    /// `scope.graph.sessionStore`. Handing the repository a different store makes the whole
    /// thing look signed out and it fails before reaching the provider at all. Production
    /// has one store; so does this.
    private func makeScope(ours: Recorder) -> SettingsScope {
        let graph = AppGraph()
        graph.sessionStore.save(
            Session(
                accessToken: "token-1",
                refreshToken: "refresh-1",
                expiresAt: Date().timeIntervalSince1970 + 3600,
                userId: "user-1",
                email: "owner@example.com"
            )
        )
        let api = ApiClient(
            sessionStore: graph.sessionStore,
            auth: SupabaseAuth(),
            transport: ours
        )
        return SettingsScope(
            graph: graph,
            repo: SettingsRepository(api: api, sessionStore: graph.sessionStore),
            companyId: "c1",
            me: Self.owner(),
            role: MemberRole.owner,
            showMessage: { _ in }
        )
    }

    /// An owner, DECODED rather than constructed.
    ///
    /// `Me` and `Membership` are `Codable` and carry more fields than a literal would
    /// guess at — `Membership` holds the #540 dashboard state as well as the four obvious
    /// ones. Decoding from JSON means this file cannot be broken by a field being added,
    /// which matters more than usual here: nothing on this machine compiles it, so a
    /// wrong field list costs a red build and a full CI round trip to discover.
    private static func owner() -> Me {
        let json = #"""
        {
          "user_id": "user-1",
          "display_name": "Sam",
          "memberships": [
            {
              "company_id": "c1",
              "name": "Northside Plumbing",
              "role": "owner",
              "subscription_status": "active"
            }
          ]
        }
        """#
        // A fixture that will not decode is a broken test, not a passing one.
        return try! JSONDecoder().decode(Me.self, from: Data(json.utf8))
    }

    /// The real accept, recorded — so what our stub sees is what the product sends.
    private func proof(
        _ scope: SettingsScope,
        kind: HandoverConfirmation.Kind,
        attempts: Attempts
    ) -> HandoverProof {
        HandoverProof(
            action: "accept",
            label: "You now own this workspace.",
            kind: kind
        ) { sent in
            await attempts.record(sent)
            _ = try await scope.repo.acceptOwnership(scope.companyId, code: sent)
        }
    }

    /// What the held action was called with, in order.
    @MainActor
    private final class Attempts {
        private(set) var calls: [String?] = []
        func record(_ code: String?) { calls.append(code) }
    }

    func testAStaleFactorDemandIsAnsweredAtTheProviderAndOurServerNeverSeesTheDigits() async {
        let ours = ourApi()
        let gotrue = identityProvider()
        let scope = makeScope(ours: ours)
        let attempts = Attempts()
        let auth = SettingsAuthClient(transport: gotrue)

        // First attempt, no code: our server refuses and NAMES the demand.
        let first = await attemptHandover(
            scope: scope,
            proof: proof(scope, kind: .email, attempts: attempts),
            code: nil,
            alreadyOpen: false,
            auth: auth
        )
        guard case let .needsCode(kind, _) = first else {
            return XCTFail("expected a named demand, got \(first)")
        }
        XCTAssertEqual(kind, .reprove, "the refusal should ask for the authenticator again")

        // The owner submits six digits, and the screen carries forward the kind the
        // refusal named — the property `HandoverGateTests` pins for all three screens.
        let second = await attemptHandover(
            scope: scope,
            proof: proof(scope, kind: .reprove, attempts: attempts),
            code: code,
            alreadyOpen: true,
            auth: auth
        )
        guard case .done = second else {
            return XCTFail("the handover should have gone through, got \(second)")
        }

        // THE ASSERTION THIS FILE EXISTS FOR.
        let leaked = ours.requestsCarrying(code)
        XCTAssertTrue(
            leaked.isEmpty,
            "\n\nOur own server received the authenticator digits in "
                + "\(leaked.count) request(s): \(leaked.joined(separator: ", ")). That "
                + "route reads the AGE of the last factor proof and never reads a code, "
                + "so this is the forever loop: a correct code refused every time.\n"
        )

        // They went to the identity provider instead — challenged, then verified.
        XCTAssertTrue(
            gotrue.seen.contains { $0.path.hasSuffix("/challenge") },
            "the provider was never asked to challenge the factor: \(gotrue.paths)"
        )
        let verifies = gotrue.seen.filter { $0.path.hasSuffix("/verify") }
        XCTAssertEqual(verifies.count, 1, "expected exactly one verify, got \(verifies.count)")
        XCTAssertTrue(
            verifies.first?.body.contains(code) == true,
            "the verify call did not carry the digits: \(verifies.first?.body ?? "none")"
        )

        // The fresh session was SAVED. Without this the app keeps presenting the old
        // token, the retry is refused exactly as before, and the loop closes anyway.
        XCTAssertEqual(scope.graph.sessionStore.current()?.accessToken, "token-2")

        // And the retry carried NO code — the second thing that makes it terminate.
        XCTAssertEqual(attempts.calls.count, 2)
        XCTAssertNil(attempts.calls[0])
        XCTAssertNil(attempts.calls[1], "the retry after a local proof must carry nothing")
    }

    func testAScreenCarryingTheWrongKindIsRecoveredOneRequestLate() async {
        /// Criterion 4: the re-check inside the `catch`, which iOS did not have.
        ///
        /// A screen that rebuilds its request each attempt arrives still holding the
        /// default demand. The up-front question then says "ours to check", the digits are
        /// posted, and only the refusal's own named kind reveals the mistake. The person is
        /// fine — not asked again, not locked out. But those digits DID reach our server
        /// once, which is exactly why the test above carries the kind forward rather than
        /// relying on this. Recovery, not prevention, and the count below says so.
        let ours = ourApi()
        let gotrue = identityProvider()
        let scope = makeScope(ours: ours)
        let attempts = Attempts()
        let auth = SettingsAuthClient(transport: gotrue)

        let recovered = await attemptHandover(
            scope: scope,
            // The WRONG kind — the default, not the one a refusal would have named.
            proof: proof(scope, kind: .email, attempts: attempts),
            code: code,
            alreadyOpen: true,
            auth: auth
        )

        guard case .done = recovered else {
            return XCTFail("the catch-path re-check should have recovered this, got \(recovered)")
        }
        XCTAssertTrue(
            gotrue.seen.contains { $0.path.hasSuffix("/verify") && $0.body.contains(code) },
            "the re-check never diverted to the provider: \(gotrue.paths)"
        )
        XCTAssertEqual(
            ours.requestsCarrying(code).count,
            1,
            "the digits should reach our server exactly once on this path — more means the "
                + "retry re-posted them, which is the forever loop"
        )
    }

    func testAnEmailedCodeIsOursToCheckAndGoesToOurServer() async {
        // The other arm, so neither test above can pass by sending nothing anywhere.
        let ours = ourApi()
        let gotrue = identityProvider()
        let scope = makeScope(ours: ours)
        let attempts = Attempts()

        _ = await attemptHandover(
            scope: scope,
            proof: proof(scope, kind: .email, attempts: attempts),
            code: code,
            alreadyOpen: true,
            auth: SettingsAuthClient(transport: gotrue)
        )

        XCTAssertFalse(
            ours.requestsCarrying(code).isEmpty,
            "an emailed code must reach our own server, and did not: \(ours.paths)"
        )
    }
}
