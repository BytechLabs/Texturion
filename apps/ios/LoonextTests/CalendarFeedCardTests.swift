import Foundation
import XCTest

@testable import Loonext

/// #245 — the schedule feed on iOS: the three calls, the two states it can be
/// in, the copy, and the two decisions that are only visible in the source.
///
/// ## What is REAL below
///
/// `SettingsRepository`, `ApiClient`, `SessionStore` and the decoder. Only the
/// transport is a double, and it RECORDS — the method and the path are the whole
/// contract of a feature with no request body, and a client that asked for
/// `/v1/calendar/feed` with the wrong verb would rotate somebody's credential
/// when it meant to read its status. That is invisible anywhere but the wire.
///
/// The session store is in-memory (#599): the simulator host has no keychain, so
/// the keychain-backed store keeps nothing and every request reads as signed out.
///
/// ## Why three of these read the source file
///
/// Two of this card's decisions have no runtime surface a unit test can reach.
/// "The URL is never kept" is the ABSENCE of a store, and "the second press says
/// what breaks rather than asking are you sure" is the absence of a question —
/// neither can be asserted by calling anything. They are pinned by shape, the
/// same way `UsageExportCardTests` pins its capability gate, and
/// `testTheSourceScansAreActuallyReadingTheirSubjects` is what stops those pins
/// passing vacuously against a file that has moved.
@MainActor
final class CalendarFeedCardTests: XCTestCase {

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

        private let route: @Sendable (String, String) -> (Int, String)
        /// `data(for:)` is a nonisolated async requirement, so this is reached
        /// off any actor. `withLock` at every site: `lock()`/`unlock()` are
        /// `@available(*, noasync)`.
        private let lock = NSLock()
        private var recorded: [Seen] = []

        init(route: @escaping @Sendable (String, String) -> (Int, String)) {
            self.route = route
        }

        var seen: [Seen] { lock.withLock { recorded } }

        func data(for request: URLRequest) async throws -> (Data, URLResponse) {
            let path = request.url?.path ?? ""
            let method = request.httpMethod ?? ""
            let bytes = request.httpBody ?? Data()
            lock.withLock {
                recorded.append(
                    Seen(
                        path: path,
                        method: method,
                        body: String(data: bytes, encoding: .utf8) ?? "",
                        companyId: request.value(forHTTPHeaderField: "X-Company-Id")
                    )
                )
            }
            let (status, payload) = route(path, method)
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
                email: "tech@example.com"
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

    /// A repo file, found by walking UP from this source rather than by counting
    /// directories — the test bundle lives in DerivedData. FAILS rather than
    /// skips when the file is not there: a scan that cannot read its subject has
    /// verified nothing.
    ///
    /// Line endings normalised, because every needle below is written with LF
    /// and a checkout on a Windows machine hands back CRLF.
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

    /// A plain throwing function rather than a `get throws` property: this file
    /// is only ever compiled by CI, so nothing here reaches for a spelling the
    /// rest of the suite does not already use.
    private func cardSource() throws -> String {
        try repoFile("apps/ios/Loonext/Features/Settings/CalendarFeedCard.swift")
    }

    // MARK: - The three calls, on the wire

    func testTheStatusCallReadsTheCallersOwnFeedAndCarriesTheTenancy() async throws {
        let transport = Recorder { _, _ in
            (200, #"{"active":true,"created_at":"2026-08-01T00:00:00Z","last_read_at":"2026-08-16T12:00:00Z"}"#)
        }
        let repo = repository(transport)

        let status = try await repo.calendarFeed("c1")

        XCTAssertTrue(status.active)
        XCTAssertEqual(status.last_read_at, "2026-08-16T12:00:00Z")

        let sent = try XCTUnwrap(transport.seen.first, "nothing was sent")
        XCTAssertEqual(sent.path, "/v1/calendar/feed")
        // GET, not POST. The two share a path and only the verb tells "how is my
        // feed doing" apart from "replace my feed" — and the second is not
        // undoable from the member's side.
        XCTAssertEqual(sent.method, "GET")
        // Without the header the server answers for no workspace at all.
        XCTAssertEqual(sent.companyId, "c1")
        // There is no identifier anywhere in this feature: no route reads,
        // rotates or revokes somebody else's feed.
        XCTAssertFalse(sent.path.contains("user"), "path was \(sent.path)")
    }

    func testAFeedThatIsOffDecodesFromTheOneFieldTheServerSends() async throws {
        // The inactive payload is `{"active":false}` and nothing else. A model
        // that made the timestamps non-optional would throw here, and the card
        // would show a load failure to everybody who has never set this up —
        // which is everybody, on the first day.
        let transport = Recorder { _, _ in (200, #"{"active":false}"#) }
        let repo = repository(transport)

        let status = try await repo.calendarFeed("c1")

        XCTAssertFalse(status.active)
        XCTAssertNil(status.created_at)
        XCTAssertNil(status.last_read_at)
    }

    func testAFeedNothingHasPolledYetDecodesAsNeverRead() async throws {
        // Live, and `last_read_at` is an explicit null. This is the state the
        // whole "did I finish setting this up?" line exists for, and it is the
        // one a client that read null as an error would blank out.
        let transport = Recorder { _, _ in
            (200, #"{"active":true,"created_at":"2026-08-16T09:00:00Z","last_read_at":null}"#)
        }
        let repo = repository(transport)

        let status = try await repo.calendarFeed("c1")

        XCTAssertTrue(status.active)
        XCTAssertNil(status.last_read_at)
    }

    func testMintingSendsNothingFeatureSpecificAndReturnsTheOnlyCopyOfTheUrl() async throws {
        let transport = Recorder { _, _ in
            (201, #"{"url":"https://app.loonext.com/calendar/tok-abc/schedule.ics"}"#)
        }
        let repo = repository(transport)

        let minted = try await repo.createCalendarFeed("c1")

        XCTAssertEqual(minted.url, "https://app.loonext.com/calendar/tok-abc/schedule.ics")

        let sent = try XCTUnwrap(transport.seen.first, "nothing was sent")
        XCTAssertEqual(sent.path, "/v1/calendar/feed")
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.companyId, "c1")
        /*
         * `{}`, not empty — this client cannot send a bodyless POST.
         *
         * `ApiClient.encode` returns `Data("{}")` when `body` is nil, so every
         * bodyless POST here goes out as an empty JSON object with a JSON
         * content type. The other two in the app do the same
         * (`/v1/company/widget-key/rotate`, `/v1/webhooks/{id}/secret`), and
         * the route parses no body either way.
         *
         * The first version of this asserted `isEmpty` and would have turned
         * `Gate / iOS` red — the one job that cannot be run on the machine
         * that wrote it. What it was reaching for is real and is asserted
         * instead: nothing FEATURE-SPECIFIC is sent, because a body invented
         * here would be a schema this endpoint does not have.
         */
        XCTAssertEqual(sent.body, "{}", "body was \(sent.body)")
    }

    func testRevokingDeletesAndReadsWhatTheServerActuallyDid() async throws {
        let transport = Recorder { _, _ in (200, #"{"revoked":true}"#) }
        let repo = repository(transport)

        let result = try await repo.revokeCalendarFeed("c1")

        XCTAssertTrue(result.revoked)

        let sent = try XCTUnwrap(transport.seen.first, "nothing was sent")
        XCTAssertEqual(sent.path, "/v1/calendar/feed")
        XCTAssertEqual(sent.method, "DELETE")
        XCTAssertEqual(sent.companyId, "c1")
    }

    func testRevokingSomethingAlreadyOffIsAnAnswerRatherThanAFailure() async throws {
        // The route answers 200 either way, on purpose: revoking a feed that was
        // already revoked is the outcome the caller wanted, and a 404 would only
        // tell somebody who pressed twice that they had done something wrong. A
        // client that treated `revoked: false` as an error would put that
        // sentence back.
        let transport = Recorder { _, _ in (200, #"{"revoked":false}"#) }
        let repo = repository(transport)

        let result = try await repo.revokeCalendarFeed("c1")

        XCTAssertFalse(result.revoked)
    }

    // MARK: - The words, held to the file that owns them

    func testEveryWordIsTheOneTheWebCatalogueWroteInBothLanguages() throws {
        // This card's copy was COPIED, not written and not re-translated. Both
        // languages, every key, compared against the file they came from —
        // because the failure this guards against is not a missing string (the
        // catalogue guard catches that) but a subtly reworded one, and a warning
        // about a credential that says something slightly different on the phone
        // than on the laptop is the exact thing that costs somebody an
        // afternoon.
        let raw = try repoFile("apps/web/src/i18n/sections/calendarFeed.ts")
        guard let start = raw.range(of: "export const calendarFeedEn"),
              let split = raw.range(of: "export const calendarFeedFr")
        else {
            return XCTFail("calendarFeed.ts no longer has both language blocks")
        }
        let english = String(raw[start.upperBound ..< split.lowerBound])
        let french = String(raw[split.upperBound...])

        let keyPattern = try NSRegularExpression(
            pattern: #"(?m)^ {2}([a-zA-Z][A-Za-z0-9]*):"#
        )
        func keys(in source: String) -> Set<String> {
            let range = NSRange(source.startIndex ..< source.endIndex, in: source)
            return Set(
                keyPattern.matches(in: source, range: range).compactMap { match in
                    Range(match.range(at: 1), in: source).map { String(source[$0]) }
                }
            )
        }

        let englishKeys = keys(in: english)
        let frenchKeys = keys(in: french)
        XCTAssertFalse(englishKeys.isEmpty, "no keys parsed from the English catalogue")
        XCTAssertEqual(
            englishKeys, frenchKeys,
            "the web catalogue's English and French halves define different keys"
        )

        // Derive the list from the source rather than maintaining a hand-written
        // sample that can rot short when the web adds another calendar surface.
        let defined = Set(
            AppStrings.en.keys.filter { $0.hasPrefix("calendarFeed.") }
        )
        XCTAssertEqual(
            defined, Set(englishKeys.map { "calendarFeed.\($0)" }),
            "the section and this test disagree about which keys exist"
        )

        for key in englishKeys.sorted() {
            let en = try XCTUnwrap(AppStrings.en["calendarFeed.\(key)"], "no English for \(key)")
            let fr = try XCTUnwrap(AppStrings.frCA["calendarFeed.\(key)"], "no French for \(key)")
            XCTAssertTrue(
                english.contains("\"\(en)\""),
                "the English \(key) has drifted from the web catalogue: \(en)"
            )
            XCTAssertTrue(
                french.contains("\"\(fr)\""),
                "the French \(key) has drifted from the web catalogue: \(fr)"
            )
        }
    }

    func testTheSecondPressStatesTheConsequenceRatherThanAskingAQuestion() throws {
        // The copy half of the Ethical Friction decision, asserted as content
        // rather than as presence: a `revokeConfirm` reworded into "Are you
        // sure?" would still be a string, still be translated, and would have
        // thrown away the only thing that makes the second press worth having.
        let confirm = try XCTUnwrap(AppStrings.en["calendarFeed.revokeConfirm"])
        XCTAssertTrue(
            confirm.contains("my calendar stops updating"),
            "the second press must say what breaks: \(confirm)"
        )
        XCTAssertFalse(confirm.contains("?"), "it is a consequence, not a question: \(confirm)")

        let french = try XCTUnwrap(AppStrings.frCA["calendarFeed.revokeConfirm"])
        XCTAssertFalse(french.contains("?"), "and the French is not a question either: \(french)")
    }

    // MARK: - Who never sees this

    func testTheCardIsGatedOnTheCapabilityTheRoutesThemselvesAskFor() {
        // `/v1/calendar/feed` is behind `conversations.read` on all three verbs.
        // Every role in the table, not the two that are convenient.
        XCTAssertTrue(MemberRole.canReadConversations(MemberRole.owner), "owner")
        XCTAssertTrue(MemberRole.canReadConversations(MemberRole.admin), "admin")
        XCTAssertTrue(MemberRole.canReadConversations(MemberRole.member), "member")
        // A read-only observer HAS scheduled work to look at; the feed is a
        // read, and refusing them would be a rank check wearing a capability's
        // clothes.
        XCTAssertTrue(MemberRole.canReadConversations(MemberRole.readOnly), "read_only")

        // The one that matters. On a phone the bookkeeper's entire app IS
        // SettingsHome, so Profile is a screen they land on — and they are the
        // one role with no scheduled work and no route that would answer them.
        XCTAssertFalse(MemberRole.canReadConversations(MemberRole.bookkeeper), "bookkeeper")
        XCTAssertFalse(MemberRole.canReadConversations(nil), "signed in, no membership")
        // Fail closed: a build that has not heard of a newer preset refuses
        // rather than guesses, which is the answer the server gives too.
        XCTAssertFalse(MemberRole.canReadConversations("estimator"), "a role from a newer server")
    }

    func testTheCardCanRenderNothingExceptBehindThatCheck() throws {
        // The predicate above is only worth something if the view cannot draw
        // around it. `body` is three lines for exactly this reason: it is small
        // enough to pin whole, so deleting the check changes it.
        let source = collapsingWhitespace(try cardSource())
        XCTAssertTrue(
            source.contains(
                "var body: some View { if MemberRole.canReadConversations(scope.role) { card } }"
            ),
            "CalendarFeedCard.body must be nothing but the capability gate"
        )
    }

    func testTheProfileSectionActuallyMountsTheCard() throws {
        // A gate on a card nobody mounts protects nothing. This is the other
        // half: the surface exists on the screen it was written for, which for a
        // subscription belonging to the PERSON is Profile & account.
        let source = try repoFile("apps/ios/Loonext/Features/Settings/ProfileSection.swift")
        XCTAssertTrue(
            collapsingWhitespace(source).contains("CalendarFeedCard(scope: scope)"),
            "ProfileSectionView must mount CalendarFeedCard"
        )
    }

    // MARK: - The two decisions that only exist as shape

    func testTheUrlIsHeldNowhereButTheScreenItIsBeingReadFrom() throws {
        let source = try cardSource()

        // Nothing durable. The server keeps a hash, so a client that wrote the
        // plaintext anywhere would be the ONLY place in the product it survives
        // — and it would survive a backup, a sync and a device handover.
        for store in ["@AppStorage", "UserDefaults", "Keychain", "FileManager"] {
            XCTAssertFalse(
                source.contains(store),
                "the minted URL must not reach \(store)"
            )
        }
        // It is state, and the acknowledgement clears it.
        XCTAssertTrue(
            source.contains("@State private var url: String?"),
            "the URL must be view state with no initial value"
        )
        XCTAssertTrue(source.contains("url = nil"), "dismissing must clear it")
        // Exactly one place it is ever set from a response.
        XCTAssertEqual(
            source.components(separatedBy: "url = minted.url").count - 1, 1,
            "there must be exactly one assignment of the minted URL"
        )
    }

    func testTheRevokeDialogHidesItsTitleSoNothingAsksAreYouSure() throws {
        let source = collapsingWhitespace(try cardSource())

        XCTAssertTrue(
            source.contains("titleVisibility: .hidden"),
            "a visible dialog title would smuggle back the question the copy refuses to ask"
        )
        XCTAssertTrue(
            source.contains(
                #"Button(t("calendarFeed.revokeConfirm"), role: .destructive)"#
            ),
            "the destructive button must be the one carrying the consequence"
        )
    }

    func testTheSourceScansAreActuallyReadingTheirSubjects() throws {
        // Four assertions above read files off disk. A scan that matches nothing
        // passes forever, and those four are worth exactly as much as these.
        let card = try cardSource()
        XCTAssertTrue(card.contains("struct CalendarFeedCard: View"), "not reading the card")
        XCTAssertGreaterThan(card.count, 2000, "expected the whole card, saw \(card.count) bytes")

        let profile = try repoFile("apps/ios/Loonext/Features/Settings/ProfileSection.swift")
        XCTAssertTrue(
            profile.contains("struct ProfileSectionView: View"), "not reading the profile section"
        )

        let web = try repoFile("apps/web/src/i18n/sections/calendarFeed.ts")
        XCTAssertTrue(
            web.contains("export const calendarFeedEn"),
            "not reading the catalogue the words were copied from"
        )
    }
}
