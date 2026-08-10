import Foundation
import XCTest

@testable import Loonext

/// #595 — the usage export on iOS: the request, the collect, and the negative.
///
/// The negative is the one that matters and the one that is easiest to write
/// decoratively. `UsageExport.isAvailable` is asserted against every role in the
/// capability table rather than against the two that are convenient, and the
/// card's whole `body` is pinned by shape — because a pure predicate nothing
/// calls is a guard that has never been anywhere near the screen it protects.
///
/// ## What is REAL in the run tests below
///
/// `SettingsRepository`, `ApiClient`, `SessionStore` and the encoder. Only the
/// transport is a double, and it RECORDS — the period on the wire is the thing
/// this feature can silently get wrong, and it is only visible in the bytes. A
/// client that sent bare midnight for `to` would export a month one day short of
/// the one on screen, and every assertion over the view model would still pass.
///
/// The session store is in-memory (#599): the simulator host has no keychain, so
/// the keychain-backed store keeps nothing and every request reads as signed out.
@MainActor
final class UsageExportCardTests: XCTestCase {

    // MARK: - Fixtures

    /// A transport that records what a server would have received, and answers
    /// by path.
    private final class Recorder: HTTPClient, @unchecked Sendable {
        struct Seen {
            let path: String
            let method: String
            let body: String
            let companyId: String?
        }

        private let route: @Sendable (String) -> (Int, String)
        /// `data(for:)` is a nonisolated async requirement, so this is reached
        /// off any actor. `withLock` at every site: `lock()`/`unlock()` are
        /// `@available(*, noasync)`, because holding a lock across a suspension
        /// point is a deadlock waiting to happen.
        private let lock = NSLock()
        private var recorded: [Seen] = []

        init(route: @escaping @Sendable (String) -> (Int, String)) {
            self.route = route
        }

        var seen: [Seen] { lock.withLock { recorded } }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            let path = request.url?.path ?? ""
            let bytes = request.httpBody ?? Data()
            lock.withLock {
                recorded.append(
                    Seen(
                        path: path,
                        method: request.httpMethod ?? "",
                        body: String(data: bytes, encoding: .utf8) ?? "",
                        companyId: request.value(forHTTPHeaderField: "X-Company-Id")
                    )
                )
            }
            let (status, payload) = route(path)
            let response = HTTPURLResponse(
                url: request.url ?? URL(string: "https://example.invalid")!,
                statusCode: status,
                httpVersion: nil,
                headerFields: nil
            )!
            return (Data(payload.utf8), response)
        }
    }

    private func repository(_ transport: Recorder) -> SettingsRepository {
        let store = SessionStore(storage: InMemorySessionStorage())
        store.save(
            Session(
                accessToken: "token-1",
                refreshToken: "refresh-1",
                expiresAt: Date().timeIntervalSince1970 + 3600,
                userId: "user-1",
                email: "books@example.com"
            )
        )
        // A harness that failed to seed a session would make every case below
        // fail as "signed out", which is not what any of them is about.
        XCTAssertNotNil(store.current(), "the harness failed to seed a session")
        return SettingsRepository(
            api: ApiClient(sessionStore: store, auth: SupabaseAuth(), transport: transport),
            sessionStore: store
        )
    }

    /// A Gregorian calendar pinned to one zone, so nothing here depends on where
    /// the machine running it happens to be.
    private func calendar(_ name: String) throws -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(identifier: name), "no zone named \(name)")
        return calendar
    }

    private func instant(
        _ calendar: Calendar,
        _ year: Int,
        _ month: Int,
        _ day: Int
    ) throws -> Date {
        try XCTUnwrap(
            calendar.date(from: DateComponents(year: year, month: month, day: day, hour: 9)),
            "could not build \(year)-\(month)-\(day)"
        )
    }

    /// A repo file, found by walking UP from this source rather than by counting
    /// directories — the test bundle lives in DerivedData.
    ///
    /// FAILS rather than skips when the file is not there (see `MissingSource`):
    /// a scan that cannot read its subject has verified nothing, and every
    /// assertion downstream would "pass" by never running.
    ///
    /// Line endings normalised, because every needle below is written with LF and
    /// a checkout on a Windows machine hands back CRLF.
    private func repoFile(_ relative: String) throws -> String {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while dir.path != "/" {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) {
                return try String(contentsOf: candidate, encoding: .utf8)
                    .replacingOccurrences(of: "\r\n", with: "\n")
            }
            dir = dir.deletingLastPathComponent()
        }
        throw missingSource(relative)
    }

    private func collapsingWhitespace(_ source: String) -> String {
        source.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    }

    // MARK: - The period the request carries

    func testTheFormOpensOnTheLastCompleteMonthAndSendsTheWholeOfIt() throws {
        // Smart Defaults: the pickers are seeded, and what they are seeded with
        // is what goes on the wire. Asserted together, because the two halves
        // being individually right and jointly wrong is the failure this feature
        // has: a default of "July" that posts a request for June-30-to-July-30.
        let toronto = try calendar("America/Toronto")
        let today = try instant(toronto, 2026, 8, 10)
        let period = UsageExport.defaultPeriod(now: today, calendar: toronto)
        let wire = UsageExport.instants(from: period.from, to: period.to, calendar: toronto)

        XCTAssertEqual(wire.from, "2026-07-01T04:00:00.000Z", "the first moment of July 1st")
        // The LAST millisecond of July 31st, which in Toronto is already August
        // in UTC. A client that sent bare midnight here would export a month a
        // day short of the one on screen.
        XCTAssertEqual(wire.to, "2026-08-01T03:59:59.999Z", "the last moment of July 31st")
    }

    func testADeviceOnUtcSendsTheSameDaysWithoutAnOffset() throws {
        let utc = try calendar("UTC")
        let today = try instant(utc, 2026, 8, 10)
        let period = UsageExport.defaultPeriod(now: today, calendar: utc)
        let wire = UsageExport.instants(from: period.from, to: period.to, calendar: utc)

        XCTAssertEqual(wire.from, "2026-07-01T00:00:00.000Z")
        XCTAssertEqual(wire.to, "2026-07-31T23:59:59.999Z")
    }

    func testAPeriodSpanningTheClockChangeIsStillTwoWholeDays() throws {
        // THE CASE THE SHARED MODULE WAS REWRITTEN FOR. March 1st 2026 is EST and
        // March 31st is EDT — the offset changes in between — so an implementation
        // that resolved one offset and reused it, or that subtracted a literal
        // 86_400_000 milliseconds, is an hour wrong at one end. Both edges are
        // resolved through the calendar, one day at a time.
        let toronto = try calendar("America/Toronto")
        let today = try instant(toronto, 2026, 4, 5)
        let period = UsageExport.defaultPeriod(now: today, calendar: toronto)
        let wire = UsageExport.instants(from: period.from, to: period.to, calendar: toronto)

        XCTAssertEqual(wire.from, "2026-03-01T05:00:00.000Z", "March 1st opens on EST")
        XCTAssertEqual(wire.to, "2026-04-01T03:59:59.999Z", "March 31st closes on EDT")
    }

    func testJanuaryRollsBackToDecemberOfThePreviousYear() throws {
        let utc = try calendar("UTC")
        let today = try instant(utc, 2026, 1, 9)
        let period = UsageExport.defaultPeriod(now: today, calendar: utc)
        let wire = UsageExport.instants(from: period.from, to: period.to, calendar: utc)

        XCTAssertEqual(wire.from, "2025-12-01T00:00:00.000Z")
        XCTAssertEqual(wire.to, "2025-12-31T23:59:59.999Z")
    }

    func testTheDayStringsAreTheOnesTheSharedModuleReturns() {
        // The `yyyy-mm-dd` half, stated on its own so a failure says which side
        // moved: the strings, or their conversion into instants. The full set of
        // cases — century leap rules included — lives in `ParityVectorsTests`.
        XCTAssertEqual(
            UsageExport.lastCompleteMonth(year: 2026, month: 8),
            UsageExportPeriod(from: "2026-07-01", to: "2026-07-31")
        )
        XCTAssertEqual(
            UsageExport.lastCompleteMonth(year: 2024, month: 3),
            UsageExportPeriod(from: "2024-02-01", to: "2024-02-29")
        )
    }

    // MARK: - The negative: who never sees this

    func testOnlyARoleHoldingBillingManageIsOfferedTheExport() {
        // Every role in the table, not the two that are convenient. The
        // bookkeeper is the point of the whole feature — billing without the
        // inbox — and a rank check would refuse them, because `bookkeeper` is a
        // capability SET and is deliberately off the owner ⊃ admin ⊃ member line.
        XCTAssertTrue(UsageExport.isAvailable(to: MemberRole.owner), "owner")
        XCTAssertTrue(UsageExport.isAvailable(to: MemberRole.admin), "admin")
        XCTAssertTrue(UsageExport.isAvailable(to: MemberRole.bookkeeper), "bookkeeper")

        XCTAssertFalse(UsageExport.isAvailable(to: MemberRole.member), "member")
        XCTAssertFalse(UsageExport.isAvailable(to: MemberRole.readOnly), "read_only")
        XCTAssertFalse(UsageExport.isAvailable(to: nil), "signed in, no membership")
        // Fail closed: a build that has not heard of a newer preset refuses
        // rather than guesses, which is the answer the server gives too.
        XCTAssertFalse(UsageExport.isAvailable(to: "estimator"), "a role from a newer server")
    }

    func testTheGateIsTheBillingCapabilityAndNotTheBulkCustomerOne() {
        XCTAssertEqual(UsageExport.capability, "billing.manage")
        // `contacts.bulk` guards the exports carrying customer correspondence.
        // This document names nobody, and gating it that way would lock out the
        // one role it was built for.
        XCTAssertNotEqual(UsageExport.capability, "contacts.bulk")
    }

    func testTheCardCanRenderNothingExceptBehindThatCheck() throws {
        // The predicate above is only worth something if the view cannot draw
        // around it. `body` is three lines for exactly this reason: it is small
        // enough to pin whole, so deleting the check changes it.
        let source = try repoFile("apps/ios/Loonext/Features/Settings/UsageExportCard.swift")
        XCTAssertTrue(
            collapsingWhitespace(source).contains(
                "var body: some View { if UsageExport.isAvailable(to: scope.role) { card } }"
            ),
            "UsageExportCard.body must be nothing but the capability gate"
        )
        // One card, so there is no second rendering path to forget.
        let cards = source.components(separatedBy: "SettingsCard(").count - 1
        XCTAssertEqual(cards, 1, "exactly one SettingsCard, inside the gate")
    }

    func testTheUsageSectionActuallyMountsTheCard() throws {
        // A gate on a card nobody mounts protects nothing. This is the other
        // half: the surface exists on the screen it was written for.
        let source = try repoFile("apps/ios/Loonext/Features/Settings/UsageSection.swift")
        XCTAssertTrue(
            collapsingWhitespace(source).contains("UsageExportCard(scope: scope)"),
            "UsageSectionView must mount UsageExportCard"
        )
    }

    func testTheSourceScansAreActuallyReadingTheirSubjects() throws {
        // A scan that matches nothing passes forever. These three read real
        // files off disk, and the three assertions above are worth exactly as
        // much as the reads underneath them.
        let card = try repoFile("apps/ios/Loonext/Features/Settings/UsageExportCard.swift")
        XCTAssertTrue(card.contains("struct UsageExportCard: View"), "not reading the card")
        XCTAssertGreaterThan(card.count, 2000, "expected the whole card, saw \(card.count) bytes")

        let section = try repoFile("apps/ios/Loonext/Features/Settings/UsageSection.swift")
        XCTAssertTrue(
            section.contains("struct UsageSectionView: View"), "not reading the usage section"
        )

        let module = try repoFile("packages/shared/src/usage-export.ts")
        XCTAssertTrue(
            module.contains("export function lastCompleteMonth"),
            "not reading the shared module the words and the rule come from"
        )
    }

    // MARK: - The words, held to the module that owns them

    func testTheWordsAreTheOnesTheSharedModuleWrote() throws {
        // Two of the four clients import `usage-export.ts`; this one cannot, so
        // the sentences are retyped here — and a retyped sentence drifts. The
        // TypeScript is read and compared rather than trusted.
        let module = try repoFile("packages/shared/src/usage-export.ts")

        XCTAssertEqual(
            sharedConstant("EXPORT_USAGE_ACTION", in: module), UsageExport.action
        )
        XCTAssertEqual(
            sharedConstant("EXPORT_USAGE_BLURB", in: module), UsageExport.blurb
        )
        // The caveat, which is the one a customer is entitled to read the same
        // way on every client: it counts what we measured, and it is not the
        // invoice.
        XCTAssertEqual(
            sharedConstant("EXPORT_USAGE_NOTE", in: module), UsageExport.note
        )
        XCTAssertEqual(
            sharedConstant("USAGE_EXPORT_CAPABILITY", in: module), UsageExport.capability
        )
    }

    func testTheNoteNamesTheHeadingThisScreenActuallyShows() throws {
        // `EXPORT_USAGE_NOTE` promises the file "appears under Data export". On
        // the web that names a different card; on the phone there was no export
        // surface at all, so this card had to become the place the sentence
        // points at. If the promise moves, the heading has to move with it.
        let source = try repoFile("apps/ios/Loonext/Features/Settings/UsageExportCard.swift")
        XCTAssertTrue(
            UsageExport.note.contains("under Data export"),
            "the shared note no longer names a heading — retitle the list to match"
        )
        XCTAssertTrue(
            source.contains("SettingsCard(title: \"Data export\""),
            "the card must be headed with the words the note promises"
        )
    }

    /// The declaration up to its `;`, with every double-quoted literal joined —
    /// which is how the module writes a sentence too long for one line.
    private func sharedConstant(_ name: String, in source: String) -> String? {
        guard let start = source.range(of: "export const \(name)"),
              let end = source.range(of: ";", range: start.lowerBound ..< source.endIndex)
        else { return nil }
        let declaration = String(source[start.lowerBound ..< end.lowerBound])
        let parts = declaration.components(separatedBy: "\"")
        var joined = ""
        var index = 1
        while index < parts.count {
            joined += parts[index]
            index += 2
        }
        return joined
    }

    // MARK: - The request, on the wire

    func testTheRequestPostsThePeriodTheFormIsShowing() async throws {
        let transport = Recorder { _ in
            (202, #"{"export_id":"exp-1","already_building":false}"#)
        }
        let repo = repository(transport)
        let toronto = try calendar("America/Toronto")
        let today = try instant(toronto, 2026, 8, 10)
        let period = UsageExport.defaultPeriod(now: today, calendar: toronto)
        let wire = UsageExport.instants(from: period.from, to: period.to, calendar: toronto)

        let result = try await repo.requestUsageExport("c1", from: wire.from, to: wire.to)

        XCTAssertEqual(result.export_id, "exp-1")
        XCTAssertFalse(result.already_building)

        let sent = try XCTUnwrap(transport.seen.first, "nothing was sent")
        XCTAssertEqual(sent.path, "/v1/exports/usage")
        XCTAssertEqual(sent.method, "POST")
        // Tenancy: without the header the server answers for no workspace at all.
        XCTAssertEqual(sent.companyId, "c1")
        // The BYTES, not the arguments. Asserted as whole `"key":"value"` pairs so
        // the order the encoder happens to emit them in does not matter.
        XCTAssertTrue(
            sent.body.contains(#""from":"2026-07-01T04:00:00.000Z""#),
            "body was \(sent.body)"
        )
        XCTAssertTrue(
            sent.body.contains(#""to":"2026-08-01T03:59:59.999Z""#),
            "body was \(sent.body)"
        )
    }

    func testAnOpenEndedPeriodOmitsTheEndRatherThanSendingNull() async throws {
        // The route reads `to` as `.optional()`. An explicit null is a different
        // wire value and would fail validation, and the difference is invisible
        // anywhere but the encoded body.
        let transport = Recorder { _ in
            (202, #"{"export_id":"exp-2","already_building":false}"#)
        }
        let repo = repository(transport)

        _ = try await repo.requestUsageExport("c1", from: "2026-07-01T00:00:00.000Z", to: nil)

        let sent = try XCTUnwrap(transport.seen.first)
        XCTAssertTrue(sent.body.contains(#""from":"2026-07-01T00:00:00.000Z""#))
        XCTAssertFalse(sent.body.contains(#""to""#), "body was \(sent.body)")
    }

    func testASecondRequestIsToldAboutTheFirstRatherThanMakingAnother() async throws {
        // The cost guard: an export reads every row it covers and writes a copy.
        let transport = Recorder { _ in
            (200, #"{"export_id":"exp-1","already_building":true}"#)
        }
        let repo = repository(transport)

        let result = try await repo.requestUsageExport(
            "c1", from: "2026-07-01T00:00:00.000Z", to: "2026-07-31T23:59:59.999Z"
        )

        XCTAssertTrue(result.already_building)
        XCTAssertEqual(result.export_id, "exp-1")
    }

    func testAServerThatOmitsTheFlagIsReadAsANewExport() async throws {
        let transport = Recorder { _ in (202, #"{"export_id":"exp-3"}"#) }
        let repo = repository(transport)

        let result = try await repo.requestUsageExport(
            "c1", from: "2026-07-01T00:00:00.000Z", to: nil
        )

        XCTAssertFalse(result.already_building, "an absent flag defaults to false")
    }

    // MARK: - The collect

    func testTheListRendersWhateverTheServerSaysThisCallerMayCollect() async throws {
        let transport = Recorder { path in
            guard path == "/v1/exports" else { return (404, #"{"error":{"code":"not_found"}}"#) }
            return (
                200,
                #"""
                {"data":[
                  {"id":"exp-1","status":"ready","row_counts":{"usage":31},"error":null,
                   "requested_at":"2026-08-01T00:00:00Z","completed_at":"2026-08-01T00:02:00Z",
                   "expires_at":"2026-08-08T00:00:00Z",
                   "files":[{"name":"usage.csv","url":"https://files.test/usage.csv?sig=abc"}]},
                  {"id":"exp-2","status":"running","row_counts":{},"error":null,
                   "requested_at":"2026-08-02T00:00:00Z","completed_at":null,"expires_at":null,
                   "files":[]}
                ],"next_cursor":null}
                """#
            )
        }
        let repo = repository(transport)

        let page = try await repo.dataExports("c1")

        XCTAssertEqual(transport.seen.first?.path, "/v1/exports")
        XCTAssertEqual(transport.seen.first?.method, "GET")
        XCTAssertEqual(transport.seen.first?.companyId, "c1")
        XCTAssertEqual(page.data.count, 2)

        let ready = try XCTUnwrap(page.data.first)
        XCTAssertEqual(UsageExport.statusLabel(ready.status), "Ready")
        XCTAssertEqual(ready.files.count, 1)
        XCTAssertEqual(ready.files.first?.name, "usage.csv")
        XCTAssertEqual(ready.files.first?.url, "https://files.test/usage.csv?sig=abc")
        // `row_counts` is in the payload and not in the model. A decoder that
        // choked on a field it was not asked about would blank the screen.
        XCTAssertEqual(page.data.last?.id, "exp-2")
    }

    func testAnExpiredExportOffersNoLinkAtAll() throws {
        // Ready, and the objects are gone. The server mints no URL rather than
        // one that 404s, so the row has to be able to say so.
        let json = #"""
        {"id":"exp-9","status":"ready","error":null,
         "requested_at":"2026-06-01T00:00:00Z","completed_at":"2026-06-01T00:01:00Z",
         "expires_at":"2026-06-08T00:00:00Z","files":[]}
        """#
        let export = try JSONDecoder().decode(DataExport.self, from: Data(json.utf8))

        XCTAssertEqual(export.status, DataExportStatus.ready)
        XCTAssertTrue(export.files.isEmpty)
        XCTAssertFalse(UsageExport.isBuilding(export.status))
    }

    func testAFailedExportCarriesTheServersOwnReason() throws {
        let json = #"""
        {"id":"exp-8","status":"failed","error":"The period had no usage in it.",
         "requested_at":"2026-06-01T00:00:00Z","completed_at":null,"expires_at":null,
         "files":[]}
        """#
        let export = try JSONDecoder().decode(DataExport.self, from: Data(json.utf8))

        XCTAssertEqual(UsageExport.statusLabel(export.status), "Didn't finish")
        XCTAssertEqual(export.error, "The period had no usage in it.")
        XCTAssertFalse(UsageExport.isBuilding(export.status))
    }

    // MARK: - Polling, and when it stops

    func testPollingRunsOnlyWhileSomethingIsBeingBuilt() throws {
        let building = try exports(statuses: ["ready", "running"])
        let settled = try exports(statuses: ["ready", "failed"])

        XCTAssertTrue(UsageExport.isBuilding(building), "a running export keeps the poll alive")
        XCTAssertFalse(UsageExport.isBuilding(settled), "nothing left to wait for")
        XCTAssertFalse(UsageExport.isBuilding([]), "an empty list is not a reason to poll")
    }

    func testAStatusThisBuildHasNeverHeardOfCountsAsStillBuilding() throws {
        // The generous direction, on purpose: a newer server's status name would
        // otherwise leave a row spinning forever on an older phone, because
        // nothing would ever ask again. It costs at most `maxPolls` requests.
        let unknown = try exports(statuses: ["assembling"])

        XCTAssertTrue(UsageExport.isBuilding(unknown))
        XCTAssertEqual(
            UsageExport.statusLabel("assembling"), "Being put together",
            "and it reads as the calm state rather than a raw wire value"
        )
    }

    func testTheWatcherStopsWhenEverythingHasSettled() throws {
        // `isBuilding` alone was tested before this, and `isBuilding` is not the
        // decision — the loop's own condition is. Replacing the view's check
        // with `true` left every assertion green while the poll ran its full
        // three minutes over rows that were all finished.
        let settled = try exports(statuses: ["ready", "failed"])
        XCTAssertFalse(
            UsageExport.shouldAskAgain(polls: 0, exports: settled),
            "nothing is being built, so asking again buys nothing and costs a signed URL per row"
        )
        XCTAssertFalse(
            UsageExport.shouldAskAgain(polls: 0, exports: []),
            "an empty list is not a reason to poll"
        )
        XCTAssertTrue(
            UsageExport.shouldAskAgain(polls: 0, exports: try exports(statuses: ["running"])),
            "and it does keep watching something that is actually building"
        )
    }

    func testTheWatcherStopsAtTheCapEvenIfNothingEverFinishes() throws {
        // The other half, and the one that protects against a server that never
        // settles a row. Deleting the cap left the suite green because the cap
        // was asserted as a NUMBER rather than as a thing the loop obeys.
        let stuck = try exports(statuses: ["running"])
        XCTAssertTrue(
            UsageExport.shouldAskAgain(polls: UsageExport.maxPolls - 1, exports: stuck),
            "the last permitted ask still goes out"
        )
        XCTAssertFalse(
            UsageExport.shouldAskAgain(polls: UsageExport.maxPolls, exports: stuck),
            "a screen left open on a desk must not ask forever"
        )
    }

    func testThePollGivesUpRatherThanRunningForever() {
        // Cost protection: a screen left open on a desk must not ask forever.
        XCTAssertGreaterThan(UsageExport.maxPolls, 0)
        XCTAssertLessThanOrEqual(
            UsageExport.pollInterval * UsageExport.maxPolls,
            Duration.seconds(180),
            "a poll that outlives three minutes of watching is a loop, not a wait"
        )
    }

    private func exports(statuses: [String]) throws -> [DataExport] {
        try statuses.enumerated().map { index, status in
            let json = """
            {"id":"exp-\(index)","status":"\(status)","error":null,
             "requested_at":"2026-08-01T00:00:00Z","completed_at":null,
             "expires_at":null,"files":[]}
            """
            return try JSONDecoder().decode(DataExport.self, from: Data(json.utf8))
        }
    }
}
