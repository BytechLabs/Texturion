import XCTest
@testable import Loonext

/// The consent card's one line (copy ported from the web /contacts/[id]
/// ConsentLine via the Android ConsentLineTest, so the clients never explain
/// consent differently), the explicit-null field-clear body, and the
/// multipart form encoding the import/note-upload doors share.
final class ContactsDataTests: XCTestCase {
    private let utc: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()

    private func memberName(_ userId: String?) -> String? {
        userId == "u1" ? "Dana Fields" : nil
    }

    // MARK: consentLine

    func testNoConsentRecordedTeachesHowItGetsRecorded() {
        XCTAssertEqual(
            consentLine(
                consentSource: nil, consentAt: nil, consentAttestedBy: nil,
                memberName: memberName, calendar: utc
            ),
            "No consent recorded yet. It's recorded when they text you first, "
                + "or when you send them their first text, which attests they asked for it."
        )
    }

    func testInboundSmsReadsTextedYouFirstWithTheDate() {
        XCTAssertEqual(
            consentLine(
                consentSource: ConsentSource.inboundSms,
                consentAt: "2026-07-08T15:00:00Z",
                consentAttestedBy: nil,
                memberName: memberName,
                calendar: utc
            ),
            "Texted you first · Jul 8"
        )
    }

    func testInboundSmsWithoutADateOmitsTheSuffix() {
        XCTAssertEqual(
            consentLine(
                consentSource: ConsentSource.inboundSms,
                consentAt: nil,
                consentAttestedBy: nil,
                memberName: memberName,
                calendar: utc
            ),
            "Texted you first"
        )
    }

    func testAttestedConsentNamesTheMemberWhoRecordedIt() {
        XCTAssertEqual(
            consentLine(
                consentSource: ConsentSource.attested,
                consentAt: "2026-07-08T15:00:00Z",
                consentAttestedBy: "u1",
                memberName: memberName,
                calendar: utc
            ),
            "Consent recorded by Dana Fields · Jul 8"
        )
    }

    func testAnUnresolvableAttesterIsOmittedNotFaked() {
        XCTAssertEqual(
            consentLine(
                consentSource: ConsentSource.attested,
                consentAt: "2026-07-08T15:00:00Z",
                consentAttestedBy: "u-gone",
                memberName: memberName,
                calendar: utc
            ),
            "Consent recorded · Jul 8"
        )
    }

    /// #248. This case used to pass `ConsentSource.imported` — a fourth value,
    /// `"import"`, that this app had written down and the database has never
    /// been able to produce (`consent_source_t` is `('inbound_sms','attested')`
    /// and nothing else). It read as a documented third way consent could
    /// arrive, which is precisely the thing nobody should believe about an
    /// import: a file does not carry a basis. The constant is gone; the
    /// FALLTHROUGH it was exercising is real and still needs holding, because a
    /// value some later migration adds must still say a basis exists rather
    /// than dropping back to the teaching line, which invites somebody to
    /// attest a consent that is already recorded.
    func testAConsentSourceThisBuildDoesNotKnowStillReadsAsRecorded() {
        XCTAssertEqual(
            consentLine(
                consentSource: "some_basis_a_later_migration_added",
                consentAt: nil,
                consentAttestedBy: nil,
                memberName: memberName,
                calendar: utc
            ),
            "Consent recorded"
        )
    }

    func testAnUnparseableConsentDateDropsTheSuffixRatherThanCrashing() {
        XCTAssertEqual(
            consentLine(
                consentSource: ConsentSource.inboundSms,
                consentAt: "garbage",
                consentAttestedBy: nil,
                memberName: memberName,
                calendar: utc
            ),
            "Texted you first"
        )
    }

    // MARK: field bodies

    func testBlankFieldClearsWithAnExplicitJsonNull() throws {
        XCTAssertEqual(
            String(decoding: try JSONEncoder().encode(contactFieldBody("name", nil)), as: UTF8.self),
            "{\"name\":null}"
        )
        XCTAssertEqual(
            String(decoding: try JSONEncoder().encode(contactFieldBody("name", "Dana")), as: UTF8.self),
            "{\"name\":\"Dana\"}"
        )
    }

    func testCreateBodyOmitsAbsentOptionals() throws {
        let minimal = try JSONDecoder().decode(
            JSONValue.self,
            from: try JSONEncoder().encode(
                contactCreateBody(phoneE164: "+14165550123", name: nil, address: nil, notes: nil)
            )
        )
        XCTAssertEqual(minimal, .object(["phone_e164": .string("+14165550123")]))

        let full = try JSONDecoder().decode(
            JSONValue.self,
            from: try JSONEncoder().encode(
                contactCreateBody(
                    phoneE164: "+14165550123", name: "Dana", address: "1 Main St", notes: "Gate 4"
                )
            )
        )
        XCTAssertEqual(
            full,
            .object([
                "phone_e164": .string("+14165550123"),
                "name": .string("Dana"),
                "address": .string("1 Main St"),
                "notes": .string("Gate 4"),
            ])
        )
    }

    // MARK: multipart form encoding

    func testMultipartFormBodyIsRfc2388Shaped() {
        let body = multipartFormBody(
            boundary: "B",
            fields: [("owner_type", "note"), ("owner_id", "n1")],
            fileField: "file",
            fileName: "a.txt",
            contentType: "text/plain",
            fileBytes: Data("hello".utf8)
        )
        let expected = "--B\r\n"
            + "Content-Disposition: form-data; name=\"owner_type\"\r\n\r\nnote\r\n"
            + "--B\r\n"
            + "Content-Disposition: form-data; name=\"owner_id\"\r\n\r\nn1\r\n"
            + "--B\r\n"
            + "Content-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\n"
            + "Content-Type: text/plain\r\n\r\n"
            + "hello\r\n"
            + "--B--\r\n"
        XCTAssertEqual(String(decoding: body, as: UTF8.self), expected)
    }

    func testMultipartFileNameIsSanitizedAgainstHeaderInjection() {
        let body = multipartFormBody(
            boundary: "B",
            fields: [],
            fileField: "file",
            fileName: "we\"ird\r\n.txt",
            contentType: "text/csv",
            fileBytes: Data()
        )
        let text = String(decoding: body, as: UTF8.self)
        XCTAssertTrue(text.contains("filename=\"weird.txt\""), "got \(text)")
    }
}
