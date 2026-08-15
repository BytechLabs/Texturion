import XCTest
@testable import Loonext

/// #294 — the arithmetic behind an arrow and a circle, and that this phone draws the
/// same marks the laptop does.
///
/// Three hand-written versions of the same trigonometry is three chances for one
/// client to point an arrowhead slightly the wrong way, on a photo a customer keeps.
final class PhotoMarkupTests: XCTestCase {

    func testItIsAnArrowAndACircleAndNothingElse() {
        XCTAssertEqual(PhotoMarkup.tools, ["arrow", "circle"])
        XCTAssertEqual(PhotoMarkup.label("arrow"), "Arrow")
        XCTAssertEqual(PhotoMarkup.label("circle"), "Circle")
    }

    func testTheStrokeScalesWithThePhoto() {
        XCTAssertGreaterThan(
            PhotoMarkup.strokeWidth(width: 4000, height: 3000),
            PhotoMarkup.strokeWidth(width: 800, height: 600)
        )
    }

    func testTheStrokeNeverDisappearsAndNeverCoversWhatItPointsAt() {
        XCTAssertGreaterThanOrEqual(PhotoMarkup.strokeWidth(width: 40, height: 30), 3)
        XCTAssertLessThanOrEqual(PhotoMarkup.strokeWidth(width: 20000, height: 20000), 18)
    }

    func testTheStrokeMeasuresTheShortEdge() {
        // Or a panorama gets drawn on with a fence post.
        XCTAssertEqual(
            PhotoMarkup.strokeWidth(width: 8000, height: 600),
            PhotoMarkup.strokeWidth(width: 600, height: 600)
        )
    }

    func testTheStrokeSurvivesASizeItCannotUse() {
        XCTAssertGreaterThanOrEqual(PhotoMarkup.strokeWidth(width: 0, height: 0), 3)
        XCTAssertGreaterThanOrEqual(PhotoMarkup.strokeWidth(width: -100, height: -100), 3)
    }

    func testTheArrowheadSitsBehindTheTip() {
        // Pointing right: both barbs must be LEFT of the tip, or the arrow points
        // backwards on a photo somebody keeps.
        let (a, b) = PhotoMarkup.arrowHead(
            from: CGPoint(x: 0, y: 0),
            to: CGPoint(x: 100, y: 0),
            stroke: 4
        )
        XCTAssertLessThan(a.x, 100)
        XCTAssertLessThan(b.x, 100)
        XCTAssertEqual(a.y, -b.y, accuracy: 0.001)
    }

    func testTheArrowheadTurnsWithTheShaft() {
        let (a, b) = PhotoMarkup.arrowHead(
            from: CGPoint(x: 0, y: 0),
            to: CGPoint(x: 0, y: 100),
            stroke: 4
        )
        XCTAssertLessThan(a.y, 100)
        XCTAssertLessThan(b.y, 100)
        XCTAssertEqual(a.x, -b.x, accuracy: 0.001)
    }

    func testALongDragDoesNotGrowAComicalHead() {
        let (a, _) = PhotoMarkup.arrowHead(
            from: CGPoint(x: 0, y: 0),
            to: CGPoint(x: 4000, y: 0),
            stroke: 4
        )
        XCTAssertLessThan(4000 - a.x, 400)
    }

    func testAZeroLengthDragDrawsNothingRatherThanNaN() {
        let (a, b) = PhotoMarkup.arrowHead(
            from: CGPoint(x: 50, y: 50),
            to: CGPoint(x: 50, y: 50),
            stroke: 4
        )
        XCTAssertEqual(a, CGPoint(x: 50, y: 50))
        XCTAssertEqual(b, CGPoint(x: 50, y: 50))
        XCTAssertFalse(a.x.isNaN)
    }

    func testTheCircleIsTheSameWhicheverCornerItStartedFrom() {
        let forward = PhotoMarkup.circleFromDrag(
            from: CGPoint(x: 10, y: 20),
            to: CGPoint(x: 110, y: 220)
        )
        let backward = PhotoMarkup.circleFromDrag(
            from: CGPoint(x: 110, y: 220),
            to: CGPoint(x: 10, y: 20)
        )
        XCTAssertEqual(forward, backward)
        // Same centre and radii as the shared module's cx/cy/rx/ry, expressed as
        // the rect Core Graphics wants.
        XCTAssertEqual(forward.midX, 60)
        XCTAssertEqual(forward.midY, 120)
        XCTAssertEqual(forward.width / 2, 50)
        XCTAssertEqual(forward.height / 2, 100)
    }

    func testATapIsNotADrag() {
        // Or scrolling a photo leaves a dot on a customer's job record.
        XCTAssertFalse(
            PhotoMarkup.isDeliberateDrag(
                from: CGPoint(x: 10, y: 10),
                to: CGPoint(x: 12, y: 11),
                width: 1000,
                height: 1000
            )
        )
    }

    func testADragIsJudgedAgainstThePhoto() {
        // 40pt is a deliberate mark on a 600px photo and a twitch on a 4000px one.
        let from = CGPoint(x: 0, y: 0)
        let to = CGPoint(x: 40, y: 0)
        XCTAssertTrue(PhotoMarkup.isDeliberateDrag(from: from, to: to, width: 600, height: 600))
        XCTAssertFalse(
            PhotoMarkup.isDeliberateDrag(from: from, to: to, width: 4000, height: 4000)
        )
    }

    func testTheMarkedUpNameSaysSoAndAlwaysEndsJpg() {
        // Keeping .png on JPEG bytes would be a lie the type check downstream
        // catches, and the customer would see a rejected upload for no reason.
        XCTAssertEqual(PhotoMarkup.markedUpFileName("boiler.jpg"), "boiler-marked.jpg")
        XCTAssertEqual(PhotoMarkup.markedUpFileName("plate.png"), "plate-marked.jpg")
        XCTAssertEqual(PhotoMarkup.markedUpFileName("no-extension"), "no-extension-marked.jpg")
        XCTAssertEqual(PhotoMarkup.markedUpFileName(".jpg"), "photo-marked.jpg")
        XCTAssertEqual(PhotoMarkup.markedUpFileName("   "), "marked-up.jpg")
        XCTAssertEqual(PhotoMarkup.markedUpFileName("a.b.c.jpg"), "a.b.c-marked.jpg")
        // A trailing dot is not an extension — the shared regex needs a character
        // after it, and this is the case the first version of this port got wrong.
        XCTAssertEqual(PhotoMarkup.markedUpFileName("photo."), "photo.-marked.jpg")
    }

    // MARK: - Against the original

    private func repoPath(_ relative: String) throws -> URL {
        var dir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while true {
            let candidate = dir.appendingPathComponent(relative)
            if FileManager.default.fileExists(atPath: candidate.path) { return candidate }
            let parent = dir.deletingLastPathComponent()
            if parent.path == dir.path { break }
            dir = parent
        }
        XCTFail("\(relative) is not reachable from \(#filePath)")
        throw CocoaError(.fileNoSuchFile)
    }

    private func sharedSource() throws -> String {
        try String(
            contentsOf: try repoPath("packages/shared/src/photo-markup.ts"),
            encoding: .utf8
        )
    }

    /// Where the markup WORDS live since #228: the web catalogue.
    ///
    /// All six moved together — the two hints and the four single words — so
    /// this whole test reads the catalogue. The tool IDS ("arrow"/"circle")
    /// are wire values and are still asserted against the shared module by the
    /// tests below, which is why `sharedSource()` stays.
    ///
    /// Sliced to the English half: the French holds the same keys, and a
    /// `contains` over the whole file would ask whether a label appears in
    /// EITHER language.
    private func catalogueEnglish() throws -> String {
        let raw = try String(
            contentsOf: try repoPath("apps/web/src/i18n/sections/domain.ts"),
            encoding: .utf8
        )
        guard let start = raw.range(of: "export const domainEn"),
              let end = raw.range(of: "export const domainFr")
        else {
            XCTFail("domain.ts no longer has both language blocks")
            return ""
        }
        return String(raw[start.upperBound ..< end.lowerBound])
    }

    func testTheCopyMatchesTheSharedModule() throws {
        let shared = try catalogueEnglish()
        for label in [
            PhotoMarkup.label("arrow"),
            PhotoMarkup.label("circle"),
            PhotoMarkup.hint,
            PhotoMarkup.hintSecondTap,
            PhotoMarkup.save,
            PhotoMarkup.undo,
        ] {
            XCTAssertTrue(shared.contains("\"\(label)\""), "this copy has drifted: \(label)")
        }
    }

    func testTheInkAndTheHaloMatchTheSharedModule() throws {
        // A mark drawn in a different red on one client is a mark a crew stops
        // trusting to mean the same thing.
        let shared = try sharedSource()
        XCTAssertTrue(shared.contains("\"\(PhotoMarkup.inkHex)\""))
        XCTAssertTrue(shared.contains("\"\(PhotoMarkup.haloHex)\""))
    }

    func testTheSharedModuleStillKnowsOnlyTheseTwoTools() throws {
        let shared = try sharedSource()
        guard let range = shared.range(of: "MARKUP_TOOLS = [") else {
            return XCTFail("MARKUP_TOOLS has moved — point this test at it")
        }
        let rest = shared[range.upperBound...]
        guard let end = rest.firstIndex(of: "]") else {
            return XCTFail("MARKUP_TOOLS never closes")
        }
        let names = rest[..<end]
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: CharacterSet(charactersIn: " \"\n\r\t")) }
            .filter { !$0.isEmpty }
        XCTAssertEqual(names, PhotoMarkup.tools)
    }
}
