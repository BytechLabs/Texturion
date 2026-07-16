import XCTest
@testable import Loonext

/// Create-on-attach resolution (ported from the Android TagLogicTest): the
/// sheet must attach an EXISTING tag when the typed name matches one
/// (case-insensitively — tags_name_uq is on lower(name)) and only create when
/// the name is genuinely new. Plus the gallery's pure grouping/label helpers
/// (the Android GalleryLogicTest twin).
final class ThreadTagsLogicTests: XCTestCase {
    private func tag(_ id: String, _ name: String) -> Tag {
        Tag(id: id, name: name, color: nil, created_at: nil, updated_at: nil)
    }

    private var existing: [Tag] {
        [tag("t1", "Estimate"), tag("t2", "Follow up")]
    }

    // MARK: - resolveTagInput

    func testBlankInputResolvesToNothing() {
        XCTAssertNil(resolveTagInput("", existing: existing))
        XCTAssertNil(resolveTagInput("   ", existing: existing))
    }

    func testOverLimitInputResolvesToNothing() {
        XCTAssertNil(
            resolveTagInput(String(repeating: "x", count: tagNameMax + 1), existing: existing)
        )
    }

    func testInputAtTheLimitStillResolves() {
        let name = String(repeating: "x", count: tagNameMax)
        XCTAssertEqual(resolveTagInput(name, existing: existing), .createNew(name))
    }

    func testExactNameAttachesTheExistingTagById() {
        XCTAssertEqual(
            resolveTagInput("Estimate", existing: existing),
            .existing(existing[0])
        )
    }

    func testMatchIsCaseInsensitiveLikeTheServersCreateOnAttach() {
        XCTAssertEqual(
            resolveTagInput("FOLLOW UP", existing: existing),
            .existing(existing[1])
        )
    }

    func testSurroundingWhitespaceIsTrimmedBeforeMatching() {
        XCTAssertEqual(
            resolveTagInput("  estimate  ", existing: existing),
            .existing(existing[0])
        )
    }

    func testAnUnknownNamePlansACreateWithTheTrimmedName() {
        XCTAssertEqual(
            resolveTagInput("  Warranty ", existing: existing),
            .createNew("Warranty")
        )
    }

    func testNoLoadedTagsMeansEveryValidNameCreates() {
        XCTAssertEqual(
            resolveTagInput("Estimate", existing: []),
            .createNew("Estimate")
        )
    }

    // MARK: - Gallery grouping + labels

    private func item(
        _ id: String,
        kind: String,
        source: String = "mms",
        fileName: String? = nil,
        sizeBytes: Int? = nil
    ) -> GalleryItem {
        GalleryItem(
            id: id,
            source: source,
            kind: kind,
            file_name: fileName,
            content_type: nil,
            size_bytes: sizeBytes,
            created_at: "2026-07-15T12:00:00Z",
            url: "https://signed.example/\(id)"
        )
    }

    private var mixed: [GalleryItem] {
        [
            item("a", kind: "image"),
            item("b", kind: "file", source: "note", fileName: "quote.pdf"),
            item("c", kind: "image"),
            item("d", kind: "file", source: "task", fileName: "permit.docx"),
        ]
    }

    func testImagesViewKeepsOnlyServerTaggedImagesInOrder() {
        XCTAssertEqual(galleryItemsFor(.images, mixed).map(\.id), ["a", "c"])
    }

    func testFilesViewKeepsEverythingThatIsNotAnImageInOrder() {
        XCTAssertEqual(galleryItemsFor(.files, mixed).map(\.id), ["b", "d"])
    }

    func testFileNameFallsBackHonestlyWhenTheRecordHasNone() {
        XCTAssertEqual(
            galleryFileName(item("x", kind: "file", fileName: "quote.pdf")),
            "quote.pdf"
        )
        XCTAssertEqual(
            galleryFileName(item("x", kind: "file", source: "mms")),
            "Text-message attachment"
        )
        XCTAssertEqual(
            galleryFileName(item("x", kind: "file", source: "note", fileName: "  ")),
            "Attachment"
        )
    }

    func testSizeLabelCoversBytesKilobytesMegabytesAndTheUnknownCase() {
        XCTAssertNil(gallerySizeLabel(nil))
        XCTAssertEqual(gallerySizeLabel(312), "312 B")
        XCTAssertEqual(gallerySizeLabel(48 * 1024), "48 KB")
        XCTAssertEqual(gallerySizeLabel(Int(2.4 * 1024 * 1024)), "2.4 MB")
    }
}
