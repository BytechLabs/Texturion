import XCTest
@testable import Loonext

/// #240 — the numbers this phone generates against and the Worker refuses on.
///
/// Vectors shared with packages/shared/src/attachment-preview.test.ts and the
/// Kotlin port. Two sets of numbers for one contract is how a client ends up
/// producing something the server will not take, and the failure would reach
/// the founder as "photos sometimes don't upload".
final class AttachmentPreviewTests: XCTestCase {

    func testWantsOneForABigImage() {
        XCTAssertTrue(AttachmentPreview.worthHaving("image/jpeg", 8 * 1024 * 1024))
        XCTAssertTrue(
            AttachmentPreview.worthHaving("image/png", AttachmentPreview.worthItBytes + 1)
        )
    }

    func testLeavesASmallImageAlone() {
        // Inbound MMS is ≤1 MB per item by carrier limit (D28), and below the
        // threshold a derivative saves a fraction of a fraction.
        XCTAssertFalse(
            AttachmentPreview.worthHaving("image/jpeg", AttachmentPreview.worthItBytes)
        )
        XCTAssertFalse(AttachmentPreview.worthHaving("image/jpeg", 40 * 1024))
    }

    func testNeverWantsOneForAFileThatIsNotAnImage() {
        // Nothing about a 20 MB PDF gets smaller by making a picture of its
        // first page — the thread renders a file row, not a picture.
        for type in ["application/pdf", "text/csv", "application/zip"] {
            XCTAssertFalse(AttachmentPreview.worthHaving(type, 20 * 1024 * 1024), type)
        }
    }

    func testNeverWantsOneForAnImageTypeThisProductRefuses() {
        // A preview is a second way into the same bucket, so it must not be a
        // way around the upload allow-list. SVG is out because an SVG is an
        // active document.
        XCTAssertFalse(AttachmentPreview.worthHaving("image/svg+xml", 5 * 1024 * 1024))
        XCTAssertFalse(AttachmentPreview.worthHaving("image/tiff", 5 * 1024 * 1024))
    }

    func testIgnoresCaseAndStrayWhitespaceOnTheType() {
        XCTAssertTrue(AttachmentPreview.worthHaving("  IMAGE/JPEG ", 5 * 1024 * 1024))
    }

    func testScalesTheLongestEdgeDownKeepingTheRatio() {
        let landscape = AttachmentPreview.dimensions(4000, 3000)
        XCTAssertEqual(landscape.width, 1600)
        XCTAssertEqual(landscape.height, 1200)
        let portrait = AttachmentPreview.dimensions(3000, 4000)
        XCTAssertEqual(portrait.width, 1200)
        XCTAssertEqual(portrait.height, 1600)
    }

    func testNeverScalesAnythingUp() {
        let small = AttachmentPreview.dimensions(800, 600)
        XCTAssertEqual(small.width, 800)
        XCTAssertEqual(small.height, 600)
    }

    func testKeepsAPanoramasShortEdgeAboveZero() {
        // 8000 x 12 scales the short edge to 2.4px, and a zero-height renderer
        // context produces nothing. This is the shape that reads as "the app
        // breaks on one guy's photos".
        let thin = AttachmentPreview.dimensions(8000, 12)
        XCTAssertEqual(thin.width, 1600)
        XCTAssertGreaterThanOrEqual(thin.height, 1)
    }

    func testAnswersSomethingUsableForADegenerateSize() {
        for (w, h) in [(0, 100), (100, 0), (-5, 100)] {
            let size = AttachmentPreview.dimensions(w, h)
            XCTAssertGreaterThanOrEqual(size.width, 1, "\(w)x\(h)")
            XCTAssertGreaterThanOrEqual(size.height, 1, "\(w)x\(h)")
        }
    }

    func testAcceptsARealDownscaleAndDropsWhatTheServerWouldRefuse() {
        let original = 8 * 1024 * 1024
        XCTAssertTrue(AttachmentPreview.isUseful(180 * 1024, original))
        // An already-optimised JPEG re-encoded at a fixed quality can come out
        // bigger than its source.
        XCTAssertFalse(AttachmentPreview.isUseful(400 * 1024, 300 * 1024))
        XCTAssertFalse(
            AttachmentPreview.isUseful(AttachmentPreview.maxPreviewBytes + 1, 25 * 1024 * 1024)
        )
        XCTAssertTrue(
            AttachmentPreview.isUseful(AttachmentPreview.maxPreviewBytes, 25 * 1024 * 1024)
        )
        XCTAssertFalse(AttachmentPreview.isUseful(0, original))
    }

    func testAgreesWithTheServerExactlyAtTheFraction() {
        // The server refuses strictly above the fraction. A client that
        // disagreed by one byte would produce an upload that fails only for
        // photos of a particular size — the worst kind of bug to be told about.
        let small = 300 * 1024
        let half = Int(Double(small) * AttachmentPreview.maxPreviewFraction)
        XCTAssertTrue(AttachmentPreview.isUseful(half, small))
        XCTAssertFalse(AttachmentPreview.isUseful(half + 1, small))
    }

    func testHoldsTheSharedNumbers() {
        // Pinned against packages/shared/src/attachment-preview.ts. These are a
        // hand-port, and a hand-port is exactly where a contract drifts.
        XCTAssertEqual(AttachmentPreview.maxEdge, 1600)
        XCTAssertEqual(AttachmentPreview.jpegQuality, 0.72, accuracy: 0.0001)
        XCTAssertEqual(AttachmentPreview.worthItBytes, 512 * 1024)
        XCTAssertEqual(AttachmentPreview.maxPreviewBytes, 400 * 1024)
        XCTAssertEqual(AttachmentPreview.maxPreviewFraction, 0.5, accuracy: 0.0001)
    }

    /// The real thing, on a real image, because this is the one client where
    /// the encoder is available inside the test target.
    func testMakesASmallerJpegFromABigPng() throws {
        // A 3000x2000 solid image compresses tiny as PNG, so pad it past the
        // worth-it threshold — the point is the DIMENSIONS and the re-encode,
        // and a file that skipped the size gate would prove neither.
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 3000, height: 2000))
        let source = renderer.image { context in
            // Noise rather than a flat fill: a solid colour encodes to almost
            // nothing at any size, which would make "it got smaller" trivially
            // true and the test worthless.
            for x in stride(from: 0, to: 3000, by: 7) {
                UIColor(hue: CGFloat(x % 360) / 360, saturation: 1, brightness: 1, alpha: 1)
                    .setFill()
                context.fill(CGRect(x: x, y: 0, width: 7, height: 2000))
            }
        }
        let original = try XCTUnwrap(source.pngData())
        XCTAssertGreaterThan(original.count, AttachmentPreview.worthItBytes)

        let preview = try XCTUnwrap(
            AttachmentPreview.make(contentType: "image/png", bytes: original)
        )
        XCTAssertTrue(AttachmentPreview.isUseful(preview.count, original.count))
        let decoded = try XCTUnwrap(UIImage(data: preview))
        // Points at scale 1 are pixels — the renderer format pins the scale, so
        // a 3x device does not silently produce a 4800px "preview".
        XCTAssertEqual(Int(decoded.size.width), 1600)
        XCTAssertEqual(Int(decoded.size.height), 1067)
    }

    func testMakesNothingFromBytesThatAreNotAnImage() {
        let notAnImage = Data(repeating: 0x41, count: 2 * 1024 * 1024)
        XCTAssertNil(AttachmentPreview.make(contentType: "image/jpeg", bytes: notAnImage))
    }
}
