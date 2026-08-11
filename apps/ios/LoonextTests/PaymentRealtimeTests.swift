import XCTest
@testable import Loonext

// MARK: - Canned transport + fixtures (file-scope, nonisolated)
//
// Referenced from the `@Sendable` transport closure, which runs off the
// MainActor (on the `ApiClient` actor), so these must not be MainActor members.
// Named apart from `ThreadControllerResyncTests`'s twins on purpose: two
// file-private declarations of one name are legal, and a name that reads as
// shared is how somebody later "de-duplicates" a fixture into an internal one
// and collides with a private twin — a mistake only CI's iOS job can see.

private struct PaymentStubTransport: HTTPClient {
    let route: @Sendable (String) -> String

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let path = request.url?.path ?? ""
        let body = Data(route(path).utf8)
        let url = request.url ?? URL(string: "https://api.loonext.com/v1")!
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: nil,
            headerFields: nil
        )!
        return (body, response)
    }
}

private let paymentEmptyPageJSON = #"{"data":[],"next_cursor":null}"#

/// The audit row the `payment_paid` insert wrote — the timeline half of what a
/// settled payment changes on this screen.
private let paidTimelineRowId = "ev-paid"

private func paidEventsPageJSON(conversationId: String) -> String {
    #"""
    {"data":[
      {"id":"\#(paidTimelineRowId)","conversation_id":"\#(conversationId)",
       "actor_user_id":null,"type":"payment_paid",
       "payload":{"payment_request_id":"pr1"},
       "created_at":"2026-08-11T12:00:00Z"}
    ],"next_cursor":null}
    """#
}

/// Events carry the paid row; everything else is empty. Nothing in these tests
/// calls `start()`, so the detail/pinned/contact routes are never asked for —
/// an empty page is the honest answer if one ever is.
private func paymentRoute(conversationId: String) -> @Sendable (String) -> String {
    { path in
        if path.hasSuffix("/events") { return paidEventsPageJSON(conversationId: conversationId) }
        return paymentEmptyPageJSON
    }
}

// MARK: - Tests

/**
 #607 — being paid reaches the crew the moment the card clears.

 Stripe tells the server, the server writes a `payment_paid` row into
 `conversation_events`, and since migration `20260813110000` the database
 broadcasts `payment.updated` on the thread's per-number topic. Before that, the
 strip above the composer said "Paid" on the NEXT FETCH — which is to say, when
 somebody standing in a driveway gave up and pulled to refresh.

 What these guards hold, and what each of them is worth:

 1. The event reaches BOTH halves of the screen it changes — the strip, through
    the tick, and the timeline row, through the events refetch.
 2. It reaches neither of them for a payment on somebody else's thread.
 3. The wire from the controller to the strip is UNBROKEN. Nothing in the
    compiler notices a `let` the view stops reading, so the tick could go on
    ticking into a pane that ignores it and every test above would still pass.
 4. The event NAME is the one the database actually sends. `ContactTimelineSection`
    records what that costs: a draft there listened for `task.updated`, which
    nothing broadcasts, and job rows silently never revalidated.
 */
@MainActor
final class PaymentRealtimeTests: XCTestCase {
    private let companyId = "c1"
    private let conversationId = "conv1"

    // MARK: - What the broadcast moves

    /// The whole point of #607: a payment settles somewhere else entirely, and
    /// this thread updates without anybody touching the phone.
    func testAPaymentOnThisThreadReachesTheStripAndTheTimeline() async throws {
        let store = seededStore()
        defer { store.clear() }
        // An assertion where a skip would be. A test host with no keychain used
        // to skip six suites into a green report (#599); the seeding either
        // worked or nothing below tests anything.
        XCTAssertNotNil(store.current(), "the harness failed to seed a session")
        let controller = makeController(store: store)

        XCTAssertEqual(
            controller.paymentChangedTick,
            0,
            "precondition: nothing has told this thread about a payment yet"
        )
        XCTAssertTrue(controller.events.isEmpty, "precondition: no timeline rows loaded")

        controller.onRealtime(paymentUpdated(conversationId: conversationId))

        XCTAssertEqual(
            controller.paymentChangedTick,
            1,
            "payment.updated must move the strip's tick — without it the pane "
                + "waits for a foreground return, which is the refresh #607 exists "
                + "to delete"
        )
        let rowLanded = await waitUntil {
            controller.events.contains { $0.id == paidTimelineRowId }
        }
        XCTAssertTrue(
            rowLanded,
            "payment.updated must refetch the timeline — the same insert that "
                + "settled the payment wrote an audit row, and it is the second "
                + "place this screen says a deposit landed"
        )

        // ...and that row has to SAY something. This refetch was worth nothing
        // for as long as the timeline rendered `payment_paid` as "Payment paid":
        // a page fetch per payment, to redraw a machine label with no amount on
        // it, while web rendered no row at all for the same event (#607 A3).
        let landed = controller.events.first { $0.id == paidTimelineRowId }
        XCTAssertEqual(
            eventLine(
                landed ?? paidRowFallback(),
                memberNames: [:],
                contactName: "Sam"
            ),
            "They paid",
            "the refetched audit row is not narrated, so the refresh costs a "
                + "request and changes nothing a reader can act on. The fixture "
                + "payload carries only the request id, which is the no-amount "
                + "arm of paymentEventLine."
        )
    }

    /// Stands in when the row did not land, so the assertion above reports a
    /// wrong SENTENCE rather than crashing on a force-unwrap and reporting
    /// nothing at all.
    private func paidRowFallback() -> ConversationEvent {
        ConversationEvent(
            id: paidTimelineRowId,
            conversation_id: conversationId,
            actor_user_id: nil,
            type: "the row never landed",
            payload: .object([:]),
            created_at: "2026-08-11T12:00:00Z"
        )
    }

    /// The `<>`-shaped trap, in Swift: an arm that forgets to compare is an arm
    /// that fires for every thread in the workspace.
    func testAPaymentOnAnotherThreadIsIgnored() async throws {
        let store = seededStore()
        defer { store.clear() }
        XCTAssertNotNil(store.current(), "the harness failed to seed a session")
        let controller = makeController(store: store)

        controller.onRealtime(paymentUpdated(conversationId: "conv-somebody-else"))

        // The tick and the refetch sit behind ONE guard, so this single
        // assertion covers both — and it is synchronous, because a guarded arm
        // returns before it schedules anything.
        XCTAssertEqual(
            controller.paymentChangedTick,
            0,
            "a payment on another thread must not move this one's strip"
        )
    }

    // MARK: - The wire the compiler cannot see

    func testTheStripIsWiredToTheTickAndActsOnIt() throws {
        // Three links, and only the middle one is anything like type-checked.
        // A view that stops reading a `let` compiles clean and silently returns
        // this feature to "on the next fetch", which is the state it started in.
        //
        // Every needle below is matched against CODE ONLY. The first draft of
        // this scan was proved decorative the moment it was broken: commenting
        // the increment out left the line — and the needle — in the file, and the
        // scan reported the wire intact while nothing ticked.
        let controller = codeOnly(try iosSource("Features/Thread/ThreadController.swift"))
        XCTAssertTrue(
            controller.contains("paymentChangedTick += 1"),
            "the controller no longer moves the tick, so nothing downstream can "
                + "hear a payment"
        )

        let view = codeOnly(try iosSource("Features/Thread/ThreadView.swift"))
        let sites = Array(view.components(separatedBy: "ThreadPaymentsPane(").dropFirst())
        XCTAssertFalse(sites.isEmpty, "no ThreadPaymentsPane( call site found — re-point this scan")
        for (index, site) in sites.enumerated() {
            XCTAssertTrue(
                // A window rather than a brace match: the needle names the
                // SOURCE of the value, so a site passing a constant — or a
                // stale copy of the counter — fails here rather than compiling.
                String(site.prefix(900))
                    .contains("paymentChangedTick: controller.paymentChangedTick"),
                "ThreadPaymentsPane call site #\(index + 1) does not take the "
                    + "controller's tick. If a second site legitimately names its "
                    + "controller something else, re-point this scan at it."
            )
        }

        let pane = codeOnly(try iosSource("Features/Payments/ThreadPayments.swift"))
        guard let reaction = pane.range(of: ".onChange(of: paymentChangedTick)") else {
            XCTFail(
                "the strip no longer reacts to the tick. The parameter still "
                    + "compiles unread, so nothing else in the build notices."
            )
            return
        }
        XCTAssertTrue(
            String(pane[reaction.upperBound...].prefix(600)).contains("reloadRequests()"),
            "the strip hears the tick and does not refetch its list, so the rows "
                + "on screen are the ones from before the payment"
        )
    }

    // MARK: - The name on the wire

    /// The event name and the payload key, taken from BOTH sides and compared.
    ///
    /// Neither string is typed into this test. The Swift half is read out of the
    /// switch arm, the SQL half out of the migration that defines the trigger
    /// function, so a rename on either side fails here instead of shipping a
    /// client that listens for something nothing sends.
    func testTheEventNameIsTheOneTheDatabaseBroadcasts() throws {
        let source = codeOnly(try iosSource("Features/Thread/ThreadController.swift"))
        guard let armStart = source.range(of: "case \"payment.") else {
            XCTFail("no payment arm in ThreadController.onRealtime — re-point this scan")
            return
        }
        let quoted = source[armStart.lowerBound...].dropFirst("case \"".count)
        guard let close = quoted.firstIndex(of: "\"") else {
            XCTFail("the payment arm's case label is unterminated")
            return
        }
        let swiftEvent = String(quoted[..<close])

        // The key the arm reads out of the payload, from the same arm.
        let arm = String(source[armStart.lowerBound...].prefix(600))
        guard let keyStart = arm.range(of: "payloadString(event, \"") else {
            XCTFail(
                "the payment arm no longer reads a payload key, so it cannot be "
                    + "telling one thread's payment from another's"
            )
            return
        }
        let keyRest = arm[keyStart.upperBound...]
        guard let keyEnd = keyRest.firstIndex(of: "\"") else {
            XCTFail("the payment arm's payload key is unterminated")
            return
        }
        let swiftKey = String(keyRest[..<keyEnd])

        // The SQL side: the arguments of the one `broadcast_number_scoped` call
        // inside the trigger function, with `--` comments already stripped (the
        // prose above it discusses this contract at length, apostrophes and
        // all).
        let sql = try migrationDefining("broadcast_payment_change")
        guard let call = sql.range(of: "broadcast_number_scoped("),
              let end = sql.range(of: ");", range: call.upperBound..<sql.endIndex)
        else {
            XCTFail("the trigger function no longer publishes anything — re-point this scan")
            return
        }
        let literals = singleQuoted(String(sql[call.upperBound..<end.lowerBound]))

        // The event name is the one dotted literal in the call: every other one
        // is a payload key, and no key has a dot in it. Asserting there is
        // exactly ONE is what keeps this from silently picking the wrong string
        // if a second dotted literal ever appears.
        let dotted = literals.filter { $0.contains(".") }
        XCTAssertEqual(
            dotted.count,
            1,
            "expected exactly one dotted literal (the event name) in the "
                + "broadcast call, found \(dotted)"
        )
        XCTAssertEqual(
            // Defaulted rather than compared as an Optional, so the two sides of
            // this assertion are the same type and the failure prints two words
            // rather than one word and a nil.
            dotted.first ?? "",
            swiftEvent,
            "this client listens for an event the database does not send. "
                + "ContactTimelineSection has the receipt: a draft there waited "
                + "for task.updated, and nothing ever revalidated."
        )
        XCTAssertTrue(
            literals.contains(swiftKey),
            "the arm reads \"\(swiftKey)\" out of a payload built from "
                + "\(literals) — every broadcast would fail its own thread check"
        )
    }

    // MARK: - The definition that is actually running

    /**
     The SQL scan above must read the LIVE definition of the trigger function.

     Rule 5 of this repository says the only legal way to amend a shipped
     function is a SECOND `create or replace` migration — the first file is
     never rewritten, because `schema_migrations` records the statements that
     really ran. So "the migration defining X" is a set, not a row, and the one
     that matters is the LAST by filename.

     This scan took the FIRST match. While there was one definition that was the
     same thing; the moment round two added the second it silently began
     asserting against a superseded file, and it PASSED — the event name and the
     payload keys had not changed, so nothing about the answer looked wrong. A
     guard reading a file that no longer runs is a guard reporting history.

     The selection rule is asserted twice over: once against a list built here,
     so it cannot go vacuous on a tree that happens to hold a single definition,
     and once against the real one, so the rule and its caller cannot drift.
     */
    func testTheSqlScanReadsTheDefinitionThatIsActuallyRunning() throws {
        // The rule itself, against a list this test owns. Deliberately shuffled
        // — a rule that only ever sees sorted input cannot distinguish "the
        // last" from "the greatest", and `contentsOfDirectory` makes no
        // ordering promise of its own.
        let older = "20260813110000_the_deposit_lands_before_anyone_refreshes.sql"
        let newer = "20260813130000_the_payment_broadcast_enforces_its_own_contract.sql"
        // BOTH ORDERS. One order proves nothing: `.first` on a list that happens
        // to arrive newest-first is indistinguishable from "the greatest", and
        // `contentsOfDirectory` makes no ordering promise at all.
        for candidates in [[newer, older], [older, newer]] {
            XCTAssertEqual(
                // Defaulted rather than compared as an Optional, so a failure
                // prints two filenames rather than one filename and a nil.
                migrationInEffect(candidates) ?? "",
                newer,
                "a second create-or-replace is the amendment; the earlier file "
                    + "is history and reading it asserts against code that no "
                    + "longer runs. Given \(candidates)."
            )
        }
        XCTAssertNil(migrationInEffect([]), "nothing to choose from is not a choice")

        // And the real scan picks the greatest of what is on disk. The
        // right-hand side is computed HERE rather than through
        // `migrationInEffect`, so a change to the rule cannot move both sides of
        // this assertion at once and pass.
        let onDisk = migrationsDefining("broadcast_payment_change")
        XCTAssertFalse(
            onDisk.isEmpty,
            "no migration defines broadcast_payment_change — every SQL assertion "
                + "in this file is reading nothing"
        )
        // `map { $0.name }` rather than a `\.name` key path: Swift has no key
        // paths into tuple elements, and that is a compile error only CI's iOS
        // job can see.
        let names = onDisk.map { $0.name }
        let live = try latestMigrationDefining("broadcast_payment_change")
        XCTAssertEqual(
            live.name,
            names.max() ?? "",
            "the scan picked \(live.name) out of \(names)"
        )
    }

    // MARK: - Harness

    /// A store that works on a host with no keychain — which is every CI run
    /// (#599).
    private func seededStore() -> SessionStore {
        let store = SessionStore(storage: InMemorySessionStorage())
        store.save(Session(
            accessToken: "test-token",
            refreshToken: "test-refresh",
            expiresAt: Date().timeIntervalSince1970 + 3600,
            userId: "u1",
            email: "tester@loonext.test"
        ))
        return store
    }

    private func makeController(store: SessionStore) -> ThreadController {
        let api = ApiClient(
            sessionStore: store,
            auth: SupabaseAuth(),
            transport: PaymentStubTransport(route: paymentRoute(conversationId: conversationId))
        )
        let meApi = MeApi(api: api)
        return ThreadController(
            repo: MessagingRepository(api: api),
            meApi: meApi,
            uploader: NoteFileUploader(sessionStore: store, meApi: meApi),
            contacts: ContactMutations(
                api: api,
                multipart: MultipartClient(api: api, sessionStore: store)
            ),
            companyId: companyId,
            conversationId: conversationId,
            meUserId: "u1"
        )
    }

    /// One broadcast, shaped exactly as the trigger sends it: two ids and a
    /// discriminator, and no money in sight (SPEC §8).
    private func paymentUpdated(conversationId: String) -> RealtimeEvent {
        RealtimeEvent(
            event: "payment.updated",
            payload: .object([
                "conversation_id": .string(conversationId),
                "payment_request_id": .string("pr1"),
                "type": .string("payment_paid"),
            ])
        )
    }

    /// The refetch runs in a Task; poll the @Observable state until it lands.
    private func waitUntil(
        timeout: TimeInterval = 5,
        _ predicate: () -> Bool
    ) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if predicate() { return true }
            try? await Task.sleep(for: .milliseconds(20))
        }
        return predicate()
    }

    /// The repo root, walked up from this file rather than guessed from a
    /// working directory — the test bundle lives in DerivedData.
    private func repoRoot() -> URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // LoonextTests
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // apps
            .deletingLastPathComponent() // repo root
    }

    /// One iOS source file, by its path under `Loonext/`. FAILS rather than
    /// skips when it is not there — see `MissingSource`.
    private func iosSource(_ relative: String) throws -> String {
        let url = repoRoot()
            .appendingPathComponent("apps/ios/Loonext")
            .appendingPathComponent(relative)
        guard let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw missingSource(url.path)
        }
        return source
    }

    /// EVERY migration that defines a function, in filename order.
    ///
    /// Found by CONTENT rather than by filename: migration files are named for
    /// what they did on the day, and pinning the name here would turn a rename
    /// into a scan that reads nothing. Missing entirely is a failure, never a
    /// skip.
    private func migrationsDefining(_ function: String) -> [(name: String, sql: String)] {
        let directory = repoRoot().appendingPathComponent("supabase/migrations")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        var found: [(name: String, sql: String)] = []
        for name in names.sorted() where name.hasSuffix(".sql") {
            guard let sql = try? String(
                contentsOf: directory.appendingPathComponent(name),
                encoding: .utf8
            ) else { continue }
            if sql.contains("function public.\(function)") {
                found.append((name: name, sql: sql))
            }
        }
        return found
    }

    /// Which of several migrations defining one function is the one that RUNS.
    ///
    /// The last by filename, because that is the order they apply in and
    /// `create or replace` means the last definition applied is the live one.
    ///
    /// A named rule rather than a `.last` inline, so it can be asserted against
    /// a list this test builds. A selection rule exercised only against whatever
    /// the tree happens to hold reports the tree's shape rather than its own —
    /// and while the tree held exactly one definition, `.first` and `.last` were
    /// indistinguishable. That is precisely how this scan spent round two
    /// reading a SUPERSEDED file and passing: the event name and the payload
    /// keys had not changed, so it asserted, correctly, against a definition
    /// that is no longer the one running.
    private func migrationInEffect(_ names: [String]) -> String? { names.max() }

    /// The live definition of a function, with `--` comments stripped.
    private func latestMigrationDefining(
        _ function: String
    ) throws -> (name: String, sql: String) {
        let candidates = migrationsDefining(function)
        guard let name = migrationInEffect(candidates.map { $0.name }),
              let match = candidates.first(where: { $0.name == name })
        else {
            throw missingSource(
                repoRoot()
                    .appendingPathComponent("supabase/migrations")
                    .appendingPathComponent("<the migration defining \(function)>")
                    .path
            )
        }
        return (name: match.name, sql: withoutSqlComments(match.sql))
    }

    private func migrationDefining(_ function: String) throws -> String {
        try latestMigrationDefining(function).sql
    }

    /// The Swift source with comment-only lines removed.
    ///
    /// Every needle in the scans above is a line of CODE, and a needle happy to
    /// match a commented-out line is a guard that reports the wire intact while
    /// nothing runs — which is exactly what the first draft of this file did
    /// when the increment was commented out to test it.
    ///
    /// Whole lines only: a trailing `//` leaves the code before it alone, since
    /// stripping mid-line would eat the `//` in a URL. Prose inside a `/** */`
    /// block that does not begin with `*` survives, which is the same limit
    /// every source scan in this target carries — and the reason the needles are
    /// spellings no doc block in these files uses.
    private func codeOnly(_ source: String) -> String {
        source
            .split(separator: "\n", omittingEmptySubsequences: false)
            .filter { line in
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                return !trimmed.hasPrefix("//") && !trimmed.hasPrefix("*")
            }
            .joined(separator: "\n")
    }

    /// Drop `--` comments, line by line.
    ///
    /// Crude, and enough for this: the prose around the trigger quotes the
    /// contract and uses apostrophes ("to_jsonb's fallback"), so an unstripped
    /// file makes every quoted-literal reading downstream nonsense.
    private func withoutSqlComments(_ sql: String) -> String {
        sql
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                guard let marker = line.range(of: "--") else { return String(line) }
                return String(line[..<marker.lowerBound])
            }
            .joined(separator: "\n")
    }

    /// Every single-quoted literal in a fragment of SQL, in order.
    private func singleQuoted(_ sql: String) -> [String] {
        sql
            .split(separator: "'", omittingEmptySubsequences: false)
            .enumerated()
            .filter { $0.offset % 2 == 1 }
            .map { String($0.element) }
    }
}
