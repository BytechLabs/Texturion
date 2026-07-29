import XCTest
@testable import Loonext

/// #415 — the meter and the preview must measure one string.
///
/// The composer showed a segment count for the RAW draft and, one line below, a
/// preview of the SUBSTITUTED text that actually sends. Merge fields make those
/// different, so the only pre-send cost disclosure this product has was
/// answering about a string the customer never receives.
///
/// It never overbilled — server-side metering measures the real sent text — but
/// it misinformed, silently and repeatedly. An owner who builds a saved reply
/// around {business_name} sees the same wrong number every time they send.
///
/// Same assertion table as the web and Android suites, deliberately: the
/// estimator and the substituter are hand-ported to three languages, so a case
/// that only one of them gets right is the failure mode #376 warns about.
final class MessagingMergedSegmentsTests: XCTestCase {

    /// What the composer now meters.
    private func meter(
        _ draft: String,
        contactName: String? = nil,
        businessName: String? = nil
    ) -> SegmentMeterState {
        segmentMeter(
            MergeFields.applyMergeFields(
                draft,
                contactName: contactName,
                businessName: businessName
            ),
            hasMedia: false
        )
    }

    /// #393: what it meters when this send will be SIGNED.
    private func signedMeter(
        _ draft: String,
        contactName: String? = nil,
        businessName: String? = nil,
        signature: String? = Self.signature
    ) -> SegmentMeterState {
        segmentMeter(
            Signature.append(
                MergeFields.applyMergeFields(
                    draft,
                    contactName: contactName,
                    businessName: businessName
                ),
                suffix: signature
            ),
            hasMedia: false
        )
    }

    /// The server-resolved signature, as the API would hand it over.
    private static let signature = " - Acme Plumbing. Reply STOP to opt out"

    // MARK: - #393, the signature is part of what sends
    //
    // Same argument as #415 below through a different door: the first text to a
    // new customer can be signed server-side, and a meter ignoring it would
    // under-report the one message type where the product ADDS text the user
    // never typed. Same assertion table as the web and Kotlin suites.

    func testTheSignatureCanPushAFirstTextIntoASecondPart() {
        let draft = String(repeating: "x", count: 150)
        XCTAssertEqual(meter(draft).segments, 1, "unsigned is one part")
        XCTAssertEqual(signedMeter(draft).segments, 2, "signed is two")
    }

    func testTheSignatureStaysGsm7SoItCostsOnePartNotTwo() {
        // An em dash here would flip the message to UCS-2 and cost THREE parts
        // (D4). Pinned on every client, because this is the surface a customer
        // would see the wrong number on.
        let metered = signedMeter(String(repeating: "x", count: 150))
        XCTAssertEqual(metered.encoding, SmsEncoding.gsm7)
        XCTAssertEqual(metered.segments, 2)
    }

    func testAnUnsignedSendIsMeteredExactlyAsBefore() {
        let draft = String(repeating: "x", count: 150)
        XCTAssertEqual(
            signedMeter(draft, signature: nil).segments,
            meter(draft).segments
        )
    }

    func testMergeFieldsAndTheSignatureBothCountInTheSendPathOrder() {
        let business = "Wilson & Sons Plumbing and Heating"
        let draft = "Hi, this is {business_name}. " + String(repeating: "x", count: 100)
        XCTAssertEqual(
            meter(draft, businessName: business).segments,
            1,
            "merged alone is one part"
        )
        XCTAssertEqual(
            signedMeter(draft, businessName: business).segments,
            2,
            "merged then signed is two"
        )
    }

    func testAnOwnerWhoAlreadyTypedTheSignatureIsNotCountedTwice() {
        let draft = "On my way" + Self.signature
        XCTAssertEqual(signedMeter(draft).segments, meter(draft).segments)
    }

    func testCrossesTheBoundaryBusinessNameHides() {
        // "{business_name}" is 15 characters. The real one is 34.
        //
        // Worth knowing while reading this: `{` and `}` are GSM-7 EXTENDED
        // characters costing TWO septets each, so the token is 17 septets
        // rather than 15 — one more way the raw draft is not the message.
        let business = "Wilson & Sons Plumbing and Heating"
        let draft = "Hi, this is {business_name}. " + String(repeating: "x", count: 120)

        XCTAssertEqual(estimateSegments(draft).segments, 1, "raw draft is one part")
        XCTAssertEqual(
            meter(draft, businessName: business).segments,
            2,
            "the merged message is two"
        )
    }

    func testCatchesTheEncodingFlipANameCanCause() {
        // THE CASE THAT IS NOT A ROUNDING ERROR. One character outside GSM-7
        // flips the WHOLE message to UCS-2 and per-part capacity falls from 160
        // to 70, so a draft the meter called one part sends as three.
        let business = "O\u{2019}Brien Heating" // typographic apostrophe
        let draft = "Hi, this is {business_name}. " + String(repeating: "x", count: 120)

        XCTAssertEqual(estimateSegments(draft).encoding, "GSM-7")
        let metered = meter(draft, businessName: business)
        XCTAssertEqual(metered.encoding, "UCS-2")
        XCTAssertGreaterThan(metered.segments, 1)
    }

    func testPinsWhichNamesFlip() {
        // GSM-7 carries plenty of accents, so #415's own example does not flip.
        // Lowercase ç is GSM-7 and uppercase Ç is not; lowercase á is GSM-7 and
        // uppercase Á is not. Nobody would predict that, so it is asserted.
        func flips(_ business: String) -> String {
            meter("Hi from {business_name}", businessName: business).encoding
        }

        XCTAssertEqual(flips("M\u{e9}nard Plomberie"), "GSM-7")
        XCTAssertEqual(flips("Caf\u{e9} St\u{e5}hl"), "GSM-7")
        XCTAssertEqual(flips("O\u{2019}Brien Heating"), "UCS-2")
        XCTAssertEqual(flips("\u{c7}elik Is\u{131}tma"), "UCS-2")
        XCTAssertEqual(flips("\u{c1}ngel Fontaner\u{ed}a"), "UCS-2")
    }

    func testLeavesADraftWithNoMergeFieldsAlone() {
        // The fix must not move the number for the ordinary case, which is most
        // messages.
        let draft = "On our way, about twenty minutes out."
        XCTAssertEqual(
            meter(draft, businessName: "Anything").segments,
            segmentMeter(draft, hasMedia: false).segments
        )
    }

    func testCountsADroppedTokenAsTheShorterMessage() {
        // Substitution can SHORTEN too: an unresolvable token is dropped
        // cleanly, so the raw count is not even a reliable floor. Metering the
        // merged text is the only thing right in both directions.
        let draft = "Hi {first_name}, " + String(repeating: "x", count: 150)
        XCTAssertEqual(estimateSegments(draft).segments, 2)
        XCTAssertEqual(meter(draft).segments, 1)
    }
}
