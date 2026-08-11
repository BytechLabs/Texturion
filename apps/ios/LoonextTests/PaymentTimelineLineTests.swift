import XCTest
@testable import Loonext

/**
 #607 A3 — one conversation must not have two histories.

 ## The defect these hold shut

 A `payment_paid` row is written into `conversation_events` by the Connect
 webhook, and until now no client narrated it. The phones fell through to
 `humanizedEventType` and rendered "Payment paid" — a column value with the
 underscore taken out, carrying none of the amount, currency or description the
 server had just written into the payload. Web narrated nothing at all and
 rendered no row, because the payment labels are absent from its own
 `ConversationEventType` union and `SystemLine` returns null for a sentence it
 cannot produce.

 A generic fallback on the phones and silence on the laptop is the worst of the
 three available answers: it is neither the designed line nor the designed
 quiet, and a crew comparing the two reads two different histories for one job.
 The answer taken is to NARRATE, on all three clients, in the same words — the
 same rule `mediaRefusedLine` and `callCompletedLine` already live under.

 Narrating rather than silencing, because the strip is deliberately temporary:
 `paymentRequestWorthShowing` keeps a settled request for a week and its own
 comment says where it goes after that — "the request is history and the
 timeline holds it". Silence would have made that sentence false and left
 `amount_cents`, `currency` and `description` written into every payload with no
 reader anywhere.

 ## What each guard below is worth

 1. NO payment type may reach the generic fallback. Asserted against the shipped
    `humanizedEventType` rather than against a typed "Payment paid", so deleting
    an arm fails here instead of quietly restoring the defect.
 2. The set this client narrates is the API's own payment family, checked in
    BOTH directions. A sixth `payment_*` type on the server fails this suite
    until somebody decides what it says, rather than landing as machine text.
 3. The amount goes through the money formatter at the payload's own currency.
    The fixture is CAD precisely so a hardcoded audience is visible: the right
    answer and the wrong one are different strings.
 4. A refund quotes what went BACK, not what was charged.
 5. The three the customer and their bank perform name nobody.
 6. Web and Android narrate the same five. This is the parity assertion itself,
    and it is the reason this file reads two sources outside `apps/ios`.
 */
final class PaymentTimelineLineTests: XCTestCase {
    // MARK: - Fixtures

    /// A member roster with one name in it, so a line that credits an actor is
    /// visibly different from one that does not.
    private let names = ["u1": "Dana"]

    /// The full payload the API actually writes for a settled payment.
    ///
    /// CAD ON PURPOSE, and it is the fixture decision that makes guard 3 able to
    /// tell anything: `formatMoneyIn` drops its qualifier only when the amount's
    /// currency and the reader's agree, so a USD fixture renders identically
    /// whether the audience is read from the payload or hardcoded to `.usd`. In
    /// CAD the two answers are different strings.
    private func fullPayload(
        amountCents: Int = 25_000,
        description: String? = "Deposit"
    ) -> [String: JSONValue] {
        var payload: [String: JSONValue] = [
            "payment_request_id": .string("pr1"),
            "amount_cents": .number(Double(amountCents)),
            "currency": .string("cad"),
        ]
        if let description = description {
            payload["description"] = .string(description)
        }
        return payload
    }

    private func event(
        _ type: String,
        _ payload: [String: JSONValue],
        actorUserId: String? = nil
    ) -> ConversationEvent {
        ConversationEvent(
            id: "ev-\(type)",
            conversation_id: "conv1",
            actor_user_id: actorUserId,
            type: type,
            payload: .object(payload),
            created_at: "2026-08-11T12:00:00Z"
        )
    }

    private func line(
        _ type: String,
        _ payload: [String: JSONValue],
        actorUserId: String? = "u1"
    ) -> String {
        eventLine(
            event(type, payload, actorUserId: actorUserId),
            memberNames: names,
            contactName: "Sam"
        )
    }

    /// The figure as this app writes it — computed, never typed. A signed amount
    /// in a phone string literal is what `check-money-literals.mjs` refuses, and
    /// a test that types one is asserting a currency nobody chose.
    private func cad(_ cents: Int) -> String {
        formatMoneyIn(cents, .cad, audience: .cad)
    }

    // MARK: - 1. Nothing falls through

    /// The mutation this kills is a one-line deletion: take an arm out of
    /// `eventLine` and the type lands on `default`, which produces a sentence —
    /// so an assertion that merely checked for a non-empty string would pass.
    func testNoPaymentTypeRendersTheGenericFallback() {
        XCTAssertFalse(
            paymentTimelineEventTypes.isEmpty,
            "the narrated set is empty, so the loop below asserts nothing"
        )
        for type in paymentTimelineEventTypes.sorted() {
            let rendered = line(type, fullPayload())
            XCTAssertNotEqual(
                rendered,
                humanizedEventType(type),
                "\(type) is still rendering the machine label. That is the #607 "
                    + "A3 defect itself: a column value with the underscore taken "
                    + "out, no amount, no context — and web renders no row at all "
                    + "for the same event."
            )
            XCTAssertFalse(
                rendered.isBlank,
                "\(type) renders a blank line, which is a row of empty space "
                    + "rather than silence — the timeline draws every item it is "
                    + "given"
            )
            // The amount is the whole reason this line exists rather than a
            // three-word label.
            XCTAssertTrue(
                rendered.contains(cad(25_000)),
                "\(type) does not say how much: \"\(rendered)\""
            )
        }
    }

    // MARK: - 2. The vocabulary is the server's, in both directions

    /// The payment family, read out of the API's own union.
    ///
    /// That union is the shipped constant for this vocabulary and
    /// `scripts/check-conversation-events.mjs` already holds it equal to the SQL
    /// enum in both directions — so checking against it reaches the database
    /// without this test needing to parse migrations.
    func testTheNarratedSetIsExactlyTheApiUnionsPaymentFamily() throws {
        let source = try repoFile("apps/api/src/routes/core/events.ts")
        let union = try unionBody(of: "ConversationEventType", in: source)
        let declared = Set(
            quotedTokens(in: union).filter { $0.hasPrefix("payment_") }
        )

        XCTAssertFalse(
            declared.isEmpty,
            "no payment_* members found in ConversationEventType — re-point this "
                + "scan rather than letting it pass by finding nothing"
        )
        // BOTH directions, deliberately. A missing member means a type the
        // server writes and this client renders as machine text; an extra one
        // means an arm for something nothing writes, which reads as coverage and
        // is not.
        XCTAssertEqual(
            paymentTimelineEventTypes,
            declared,
            "the payment types this timeline narrates and the ones the API "
                + "writes have drifted. Narrated-only: "
                + "\(paymentTimelineEventTypes.subtracting(declared).sorted()); "
                + "API-only: \(declared.subtracting(paymentTimelineEventTypes).sorted())"
        )
    }

    // MARK: - 3. The amount is formatted, never typed

    func testTheAmountIsWrittenInThePayloadsOwnCurrency() {
        let paid = line("payment_paid", fullPayload())
        XCTAssertEqual(paid, "They paid \(cad(25_000)) — Deposit")

        // The mutation: `audience: .usd` instead of the payload's currency. A
        // Canadian business reading its own thread would then be told "CA$250",
        // which is the #522 shape in reverse — the qualifier belongs on a
        // FOREIGN price, and this money is the reader's own.
        XCTAssertFalse(
            paid.contains(formatMoneyIn(25_000, .cad, audience: .usd)),
            "the amount is qualified as foreign money in the account's own "
                + "thread: \"\(paid)\""
        )
    }

    /// Cents survive. `formatMonthlyCents` prints the decimals only when there
    /// are any, so an amount that has them is the case that can tell a rounded
    /// implementation from an exact one.
    func testAnAmountWithCentsKeepsThem() {
        XCTAssertEqual(
            line("payment_paid", fullPayload(amountCents: 25_050)),
            "They paid \(cad(25_050)) — Deposit"
        )
    }

    /// #270: `amount_cents` is a JSON NUMBER. Read through `stringValue` it is
    /// nil, and the line silently degrades to the no-amount arm — which reads
    /// like a deliberate choice rather than a bug, exactly as it did for every
    /// voicemail duration on this platform for months.
    func testTheAmountIsReadAsANumberAndNotAsAString() {
        let rendered = line("payment_paid", fullPayload())
        XCTAssertNotEqual(
            rendered,
            "They paid",
            "the amount was dropped — `amount_cents` is a JSON number and "
                + "`stringValue` returns nil for one"
        )
    }

    // MARK: - 4. A refund quotes what went back

    func testARefundQuotesWhatWentBackAndNotWhatWasCharged() {
        var payload = fullPayload()
        payload["amount_refunded_cents"] = .number(10_000)

        let rendered = line("payment_refunded", payload)
        XCTAssertEqual(rendered, "\(cad(10_000)) went back to them — Deposit")
        // The mutation this kills is reading `amount_cents` here, which would
        // tell the crew the customer got the whole deposit back when they got
        // part of it.
        XCTAssertFalse(
            rendered.contains(cad(25_000)),
            "the line quotes the amount CHARGED on a partial refund: \"\(rendered)\""
        )
    }

    /// A stored zero means the webhook did not know the figure, never that
    /// nothing moved — `amount_refunded_cents` is nullable and a refund that
    /// moved nothing is not a refund. Falling back to the charged amount is the
    /// honest reading; printing a zero would be an invented fact.
    func testAZeroRefundedAmountFallsBackToWhatWasCharged() {
        var payload = fullPayload()
        payload["amount_refunded_cents"] = .number(0)
        XCTAssertEqual(
            line("payment_refunded", payload),
            "\(cad(25_000)) went back to them — Deposit"
        )
    }

    // MARK: - 5. Who each line credits

    /// #237's rule, applied to money. These three carry `actor_user_id: null`
    /// because nobody in the workspace performed them — and a line that named a
    /// crew member would credit them with the customer's payment, or with their
    /// bank's chargeback.
    func testThePaymentsNobodyInTheWorkspaceMadeNameNobody() {
        for type in ["payment_paid", "payment_refunded", "payment_disputed"] {
            // The actor is supplied deliberately: the arm must ignore it even
            // when one is there, so a future writer stamping an actor onto these
            // rows cannot change what the sentence claims.
            let rendered = line(type, fullPayload(), actorUserId: "u1")
            XCTAssertFalse(
                rendered.contains("Dana"),
                "\(type) credits a crew member with something the customer or "
                    + "their bank did: \"\(rendered)\""
            )
        }
    }

    /// The two a crew member really does perform in this app carry their name,
    /// because "somebody asked this customer for $250" is a question the rest of
    /// the crew asks about a bill they did not send.
    func testTheAskAndTheCallOffCarryTheirActor() {
        XCTAssertEqual(
            line("payment_requested", fullPayload()),
            "Dana asked for \(cad(25_000)) — Deposit"
        )
        // The cancel payload carries no description — the route writes the id,
        // the amount and the currency and nothing else — so this is also the
        // case that proves the trailing clause is conditional rather than
        // always-on.
        var cancelled = fullPayload(description: nil)
        XCTAssertEqual(
            line("payment_cancelled", cancelled),
            "Dana called off the \(cad(25_000)) request"
        )
        cancelled["description"] = .string("")
        XCTAssertEqual(
            line("payment_cancelled", cancelled),
            "Dana called off the \(cad(25_000)) request",
            "a blank description left a dangling separator on the end of the line"
        )
    }

    /// An actor who has left the roster still produces a whole sentence — the
    /// same "Someone" every other arm in `eventLine` falls back to.
    func testAnActorNoLongerOnTheRosterStillReadsAsASentence() {
        XCTAssertEqual(
            line("payment_requested", fullPayload(), actorUserId: "u-departed"),
            "Someone asked for \(cad(25_000)) — Deposit"
        )
    }

    // MARK: - A payload missing the amount

    /// Every arm drops the figure rather than inventing one, and every result is
    /// still a whole sentence. The row this covers is a real one: the payload is
    /// untyped `jsonb` and any writer can put anything in it, which is the same
    /// reason the trigger itself stopped trusting `payment_request_id`.
    func testAMissingAmountDropsOutOfTheSentenceRatherThanReadingAsZero() {
        let bare: [String: JSONValue] = ["payment_request_id": .string("pr1")]
        let expected = [
            "payment_requested": "Dana asked for a payment",
            "payment_paid": "They paid",
            "payment_cancelled": "Dana called off the request",
            "payment_refunded": "The money went back to them",
            "payment_disputed": "Their bank pulled this payment back",
        ]
        // Set-equality against the shipped list, so a sixth type cannot be added
        // to the timeline and skipped here.
        XCTAssertEqual(
            Set(expected.keys),
            paymentTimelineEventTypes,
            "this table and the narrated set have drifted"
        )
        for (type, sentence) in expected {
            let rendered = line(type, bare)
            XCTAssertEqual(rendered, sentence)
            // The failure mode a `?? 0` would produce: a formatted zero, which
            // reads as a fact rather than as an absence.
            XCTAssertFalse(
                rendered.contains(cad(0)),
                "\(type) rendered a made-up zero amount: \"\(rendered)\""
            )
        }
    }

    // MARK: - 6. The parity assertion itself

    /// Web and Android narrate the same five types.
    ///
    /// THIS IS THE #607 A3 GUARD. The defect was not that a line was wrong; it
    /// was that three clients answered the same event three different ways, and
    /// nothing in any of the three suites could see the other two. So this one
    /// reads them.
    ///
    /// It checks that each label appears as a QUOTED LITERAL in the file that
    /// narrates the timeline, with comment lines removed first. Prose in this
    /// repository names event types in backticks, so a discussion of the type
    /// cannot stand in for an arm that renders it.
    func testWebAndAndroidNarrateTheSameFivePaymentTypes() throws {
        let timelines = [
            "apps/web/src/components/thread/system-line.tsx",
            "apps/android/app/src/main/kotlin/com/loonext/android/features/thread/Timeline.kt",
        ]
        for path in timelines {
            // Two lines rather than `codeOnly(try repoFile(path))`: a `try`
            // buried in an argument list is the kind of thing that reads fine
            // and only compiles on a machine none of this was written on.
            let raw = try repoFile(path)
            let source = codeOnly(raw)
            for type in paymentTimelineEventTypes.sorted() {
                XCTAssertTrue(
                    source.contains("\"\(type)\""),
                    "\(path) does not narrate \(type), so one conversation has "
                        + "two histories: this phone states the payment and that "
                        + "client does not. #607 A3 ruled that out in both "
                        + "directions — either every client narrates a payment "
                        + "or none does, and iOS narrates."
                )
            }
        }
    }

    /// Web says the SAME SENTENCES, read out of its own English catalogue.
    ///
    /// The arm-presence scan above proves nobody fell off the switch. This one
    /// proves the three clients did not fall off it in three different words —
    /// which is the half of A3 that "one conversation, one history" actually
    /// rests on, and the half no suite in this repository held before now. Web
    /// pins its own sentences and Android pins its own; each was free to reword
    /// and stay green.
    ///
    /// Read from `sections/thread.ts` rather than retyped, so this is a
    /// comparison and not a second copy of the copy. Web only: its strings live
    /// in a catalogue that can be parsed, while Android's are Kotlin string
    /// templates, and a scan that tried to evaluate `"$actor asked for $amount"`
    /// would be reimplementing interpolation to compare two literals.
    func testWebSaysTheSamePaymentSentencesWordForWord() throws {
        let english = try webEnglishThreadCatalogue()
        XCTAssertEqual(
            Set(webPaymentKeys.keys),
            paymentTimelineEventTypes,
            "this key table and the narrated set have drifted, so a type would "
                + "be compared against nothing"
        )

        for type in paymentTimelineEventTypes.sorted() {
            guard let keys = webPaymentKeys[type] else { continue }

            let withAmount = try catalogueValue(keys.withAmount, in: english)
                .replacingOccurrences(of: "{by}", with: "Dana")
                .replacingOccurrences(of: "{amount}", with: cad(25_000))
            XCTAssertEqual(
                line(type, fullPayload(description: nil)),
                withAmount,
                "iOS and web say \(type) differently. One conversation, two "
                    + "histories — reword both or neither."
            )

            let generic = try catalogueValue(keys.generic, in: english)
                .replacingOccurrences(of: "{by}", with: "Dana")
            XCTAssertEqual(
                line(type, ["payment_request_id": .string("pr1")]),
                generic,
                "iOS and web disagree about \(type) when the payload carries no "
                    + "amount"
            )
        }

        // The trailing clause is a template on web and a concatenation here, so
        // the separator itself is worth comparing: an en dash for an em dash
        // would read as a typo on one client and as the design on the other.
        let joined = try catalogueValue("sysPaymentWithDescription", in: english)
            .replacingOccurrences(of: "{line}", with: "They paid \(cad(25_000))")
            .replacingOccurrences(of: "{description}", with: "Deposit")
        XCTAssertEqual(
            line("payment_paid", fullPayload()),
            joined,
            "iOS and web join the description to the line differently"
        )
    }

    // MARK: - Harness

    /// Which catalogue key on web says what each arm here says.
    ///
    /// Key NAMES, not copy — the sentences themselves are read out of the file.
    /// Labels written out in the literal as well as in the type. An unlabelled
    /// tuple does convert to a labelled one, and being sure of that costs a CI
    /// round trip on a machine with no Swift compiler.
    private let webPaymentKeys: [String: (withAmount: String, generic: String)] = [
        "payment_requested": (
            withAmount: "sysPaymentRequested", generic: "sysPaymentRequestedGeneric"
        ),
        "payment_paid": (
            withAmount: "sysPaymentPaid", generic: "sysPaymentPaidGeneric"
        ),
        "payment_cancelled": (
            withAmount: "sysPaymentCancelled", generic: "sysPaymentCancelledGeneric"
        ),
        "payment_refunded": (
            withAmount: "sysPaymentRefunded", generic: "sysPaymentRefundedGeneric"
        ),
        "payment_disputed": (
            withAmount: "sysPaymentDisputed", generic: "sysPaymentDisputedGeneric"
        ),
    ]

    /// Web's ENGLISH thread strings, bounded to `threadEn`.
    ///
    /// Bounded on purpose: `threadFr` in the same file holds every one of these
    /// keys, and an unbounded scan taking the first match would be right only by
    /// accident of declaration order — the same accident that had the SQL scan
    /// in `PaymentRealtimeTests` reading a superseded migration.
    private func webEnglishThreadCatalogue() throws -> String {
        let path = "apps/web/src/i18n/sections/thread.ts"
        let source = try repoFile(path)
        guard let start = source.range(of: "export const threadEn = {"),
              let end = source.range(
                  of: "\n} as const;",
                  range: start.upperBound..<source.endIndex
              )
        else {
            throw missingSource("the threadEn catalogue in \(path)")
        }
        return String(source[start.upperBound..<end.lowerBound])
    }

    /// One `key: "value"` out of a catalogue section.
    private func catalogueValue(_ key: String, in section: String) throws -> String {
        // The colon is part of the needle, so `sysPaymentPaid` cannot match the
        // line that defines `sysPaymentPaidGeneric`.
        guard let start = section.range(of: "\(key): \""),
              let end = section.range(of: "\"", range: start.upperBound..<section.endIndex)
        else {
            throw missingSource("the \(key) string in apps/web/src/i18n/sections/thread.ts")
        }
        return String(section[start.upperBound..<end.lowerBound])
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

    /// One file anywhere in the checkout, by its repo-relative path. FAILS
    /// rather than skips when it is not there — see `MissingSource`.
    private func repoFile(_ relative: String) throws -> String {
        let url = repoRoot().appendingPathComponent(relative)
        guard let source = try? String(contentsOf: url, encoding: .utf8) else {
            throw missingSource(url.path)
        }
        return source
    }

    /// The body of a TypeScript union type, from its name to the `;` that ends
    /// it, with `//` comments already removed.
    ///
    /// Bounded rather than scanning the whole file, so a payment label used
    /// somewhere else in it could never stand in for a member of the union.
    private func unionBody(of name: String, in source: String) throws -> String {
        let code = codeOnly(source)
        guard let start = code.range(of: "type \(name) ="),
              let end = code.range(of: ";", range: start.upperBound..<code.endIndex)
        else {
            throw missingSource("the \(name) union in apps/api/src/routes/core/events.ts")
        }
        return String(code[start.upperBound..<end.lowerBound])
    }

    /// Every double-quoted literal in a fragment, in order.
    private func quotedTokens(in text: String) -> [String] {
        text
            .split(separator: "\"", omittingEmptySubsequences: false)
            .enumerated()
            .filter { $0.offset % 2 == 1 }
            .map { String($0.element) }
    }

    /// A source with comment-only lines removed — `//` for TypeScript, Kotlin
    /// and Swift alike, and `*` for the continuation lines of a block comment.
    ///
    /// Whole lines only: stripping mid-line would eat the `//` in a URL. Prose
    /// inside a `/** */` block that does not begin with `*` survives, which is
    /// why the needles above are quoted literals rather than bare words.
    private func codeOnly(_ source: String) -> String {
        source
            .split(separator: "\n", omittingEmptySubsequences: false)
            // Named `row` rather than `line`, because this class has a method
            // called `line(_:_:actorUserId:)` and a closure parameter that
            // shadows a member is a reading trap even where it compiles.
            .filter { row in
                let trimmed = row.trimmingCharacters(in: .whitespaces)
                return !trimmed.hasPrefix("//") && !trimmed.hasPrefix("*")
            }
            .joined(separator: "\n")
    }
}
