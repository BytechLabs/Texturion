import XCTest
@testable import Loonext

/// Port of EVERY vector in packages/shared/src/segments.test.ts (via the
/// Android SegmentsTest twin) — the estimator must agree with the server
/// byte-for-byte.
final class MessagingSegmentsTests: XCTestCase {
    private func assertEstimate(
        _ text: String,
        encoding: String,
        segments: Int,
        unitsUsed: Int,
        unitsPerSegment: Int,
        line: UInt = #line
    ) {
        let actual = estimateSegments(text)
        XCTAssertEqual(actual.encoding, encoding, "encoding", line: line)
        XCTAssertEqual(actual.segments, segments, "segments", line: line)
        XCTAssertEqual(actual.unitsUsed, unitsUsed, "unitsUsed", line: line)
        XCTAssertEqual(actual.unitsPerSegment, unitsPerSegment, "unitsPerSegment", line: line)
    }

    // MARK: GSM-7 basic

    func testEmptyStringIsZeroSegments() {
        assertEstimate(
            "",
            encoding: SmsEncoding.gsm7,
            segments: 0,
            unitsUsed: 0,
            unitsPerSegment: gsm7SingleSegmentUnits
        )
    }

    func testExactly160Gsm7CharsFitOneSegment() {
        assertEstimate(
            String(repeating: "a", count: 160),
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 160,
            unitsPerSegment: 160
        )
    }

    func test161Gsm7CharsConcatenateTo2SegmentsOf153() {
        assertEstimate(
            String(repeating: "a", count: 161),
            encoding: SmsEncoding.gsm7,
            segments: 2,
            unitsUsed: 161,
            unitsPerSegment: gsm7ConcatSegmentUnits
        )
    }

    func test153BoundaryMath() {
        XCTAssertEqual(estimateSegments(String(repeating: "a", count: 306)).segments, 2)
        XCTAssertEqual(estimateSegments(String(repeating: "a", count: 307)).segments, 3)
        XCTAssertEqual(estimateSegments(String(repeating: "a", count: 459)).segments, 3)
        XCTAssertEqual(estimateSegments(String(repeating: "a", count: 460)).segments, 4)
    }

    func testEAcuteIsGsm7Basic() {
        assertEstimate(
            "é",
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 1,
            unitsPerSegment: 160
        )
        XCTAssertEqual(estimateSegments(String(repeating: "é", count: 160)).segments, 1)
    }

    func testCCedillaIsGsm7BasicPerGsm0338() {
        assertEstimate(
            "ç",
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 1,
            unitsPerSegment: 160
        )
    }

    func testNewlineAndOtherLowBasicCharsAre1Septet() {
        assertEstimate(
            "a\nb",
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 3,
            unitsPerSegment: 160
        )
    }

    // MARK: GSM-7 extension table

    func testEuroIsGsm7ButCosts2Septets() {
        assertEstimate(
            "€",
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 2,
            unitsPerSegment: 160
        )
    }

    func testAllExtensionCharsCost2() {
        assertEstimate(
            String(repeating: "€", count: 80),
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 160,
            unitsPerSegment: 160
        )
        XCTAssertEqual(estimateSegments(String(repeating: "€", count: 81)).segments, 2)
        assertEstimate(
            "[~]{}\\^|€\u{0C}",
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: 20,
            unitsPerSegment: 160
        )
    }

    func testMixedBasicPlusExtensionCountsSeptetsExactly() {
        let text = "Price: $5 [deal] ~50% off €"
        assertEstimate(
            text,
            encoding: SmsEncoding.gsm7,
            segments: 1,
            unitsUsed: text.count + 4,
            unitsPerSegment: 160
        )
    }

    func testAnEscPairNeverStraddlesA153SeptetBoundary() {
        let text = String(repeating: "a", count: 152) + "€" + String(repeating: "a", count: 152)
        assertEstimate(
            text,
            encoding: SmsEncoding.gsm7,
            segments: 3,
            unitsUsed: 306,
            unitsPerSegment: 153
        )
        XCTAssertEqual(
            estimateSegments(
                String(repeating: "a", count: 151) + "€" + String(repeating: "a", count: 153)
            ).segments,
            2
        )
    }

    // MARK: UCS-2 fallback

    func testASingleEmojiForcesUcs2AndCounts2Utf16Units() {
        assertEstimate(
            "😀",
            encoding: SmsEncoding.ucs2,
            segments: 1,
            unitsUsed: 2,
            unitsPerSegment: ucs2SingleSegmentUnits
        )
    }

    func testOneNonGsmCharSwitchesTheWholeMessageToUcs2() {
        let text = String(repeating: "a", count: 159) + "😀"
        assertEstimate(
            text,
            encoding: SmsEncoding.ucs2,
            segments: 3,
            unitsUsed: 161,
            unitsPerSegment: ucs2ConcatSegmentUnits
        )
    }

    func test70To71Boundary() {
        assertEstimate(
            String(repeating: "中", count: 70),
            encoding: SmsEncoding.ucs2,
            segments: 1,
            unitsUsed: 70,
            unitsPerSegment: 70
        )
        assertEstimate(
            String(repeating: "中", count: 71),
            encoding: SmsEncoding.ucs2,
            segments: 2,
            unitsUsed: 71,
            unitsPerSegment: 67
        )
    }

    func test67BoundaryMath() {
        XCTAssertEqual(estimateSegments(String(repeating: "中", count: 134)).segments, 2)
        XCTAssertEqual(estimateSegments(String(repeating: "中", count: 135)).segments, 3)
    }

    func testASurrogatePairNeverStraddlesA67UnitBoundary() {
        let text = String(repeating: "中", count: 66) + "😀" + String(repeating: "中", count: 66)
        assertEstimate(
            text,
            encoding: SmsEncoding.ucs2,
            segments: 3,
            unitsUsed: 134,
            unitsPerSegment: 67
        )
        XCTAssertEqual(
            estimateSegments(
                String(repeating: "中", count: 65) + "😀" + String(repeating: "中", count: 67)
            ).segments,
            2
        )
    }

    func testUppercaseCCedillaIsOutsideGsm0338BasicAndForcesUcs2() {
        XCTAssertEqual(estimateSegments("Ça va").encoding, SmsEncoding.ucs2)
    }

    func testMixedRealWorldContentWithOneEmoji() {
        assertEstimate(
            "On our way! ETA 4:30 😀",
            encoding: SmsEncoding.ucs2,
            segments: 1,
            unitsUsed: 23,
            unitsPerSegment: 70
        )
    }

    // MARK: Composer meter semantics

    func testMeterHiddenAt1SegmentPassiveAt2AmberAt4() {
        XCTAssertFalse(segmentMeter("hi").visible)
        let two = segmentMeter(String(repeating: "a", count: 200))
        XCTAssertTrue(two.visible)
        XCTAssertEqual(two.segments, 2)
        XCTAssertEqual(two.label, "Sent in 2 parts")
        XCTAssertFalse(two.warn)
        let four = segmentMeter(String(repeating: "a", count: 500))
        XCTAssertTrue(four.warn)
    }

    func testMmsMetersAFlat3PartsRegardlessOfBody() {
        let meter = segmentMeter("short", hasMedia: true)
        XCTAssertTrue(meter.visible)
        XCTAssertEqual(meter.segments, mmsSegments)
        XCTAssertFalse(meter.warn)
    }
}
