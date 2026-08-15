import XCTest
@testable import Loonext

/// #289 — "download photos on Wi-Fi only, at minimum".
///
/// Vectors shared with packages/shared/src/metered-media.test.ts and the Kotlin
/// port. The thing worth holding is the LINE the setting cuts along: #240 made
/// a thread fetch a 200 KB preview and a full-size view fetch the original, and
/// the setting follows that split rather than blocking photos outright. A phone
/// that got this wrong would show a wall of grey rectangles on a job site.
final class MeteredMediaTests: XCTestCase {

    private let all: [MeteredMedia.Connection] = [.unmetered, .metered, .unknown]

    func testTheThreadAlwaysReads() {
        // The preview IS the thread. Blocking it would make the app look broken
        // to somebody who turned a setting on last month.
        for connection in all {
            for wifiOnly in [true, false] {
                XCTAssertTrue(
                    MeteredMedia.mayFetch(
                        variant: "preview",
                        connection: connection,
                        wifiOnlyOriginals: wifiOnly,
                        requested: false
                    ),
                    "\(connection)/\(wifiOnly)"
                )
            }
        }
    }

    func testTheFullSizePhotoLoadsNormallyWhenTheSettingIsOff() {
        for connection in all {
            XCTAssertTrue(
                MeteredMedia.mayFetch(
                    variant: "original",
                    connection: connection,
                    wifiOnlyOriginals: false,
                    requested: false
                ),
                "\(connection)"
            )
        }
    }

    func testItWaitsOnMobileDataAndLoadsOnWifi() {
        XCTAssertFalse(
            MeteredMedia.mayFetch(
                variant: "original",
                connection: .metered,
                wifiOnlyOriginals: true,
                requested: false
            )
        )
        XCTAssertTrue(
            MeteredMedia.mayFetch(
                variant: "original",
                connection: .unmetered,
                wifiOnlyOriginals: true,
                requested: false
            )
        )
    }

    func testItLoadsTheOneThePersonTapped() {
        // A per-image escape rather than a per-session one: the point of the
        // setting is that data is spent deliberately.
        XCTAssertTrue(
            MeteredMedia.mayFetch(
                variant: "original",
                connection: .metered,
                wifiOnlyOriginals: true,
                requested: true
            )
        )
    }

    func testAConnectionTheOSWillNotDescribeReadsAsUnmetered() {
        // A path that has not settled is not a reason to withhold a photo with
        // no explanation.
        XCTAssertTrue(
            MeteredMedia.mayFetch(
                variant: "original",
                connection: .unknown,
                wifiOnlyOriginals: true,
                requested: false
            )
        )
        XCTAssertEqual(MeteredMedia.connection(from: nil), .unknown)
    }

    func testTheHintNamesTheConditionAndTheRemedy() {
        // The alternative — a spinner that never resolves, or a generic
        // "couldn't load" — is how a deliberate setting gets reported as a bug.
        //
        // #228: `meteredHint` is a catalogue KEY now, so this resolves it. The
        // shared module's twin of this assertion was repointed in the same
        // commit and this one was not — which is why it is worth saying that
        // both halves have to be checked in BOTH languages: a translation that
        // kept only the condition leaves a reader with a photo that never
        // arrives and nothing to do about it.
        let en = AppStrings.translate("en", MeteredMedia.meteredHint)
        XCTAssertTrue(en.contains("mobile data"), en)
        XCTAssertTrue(en.lowercased().contains("tap"), en)

        let fr = AppStrings.translate("fr-CA", MeteredMedia.meteredHint)
        XCTAssertTrue(fr.lowercased().contains("données mobiles"), fr)
        XCTAssertTrue(fr.lowercased().contains("touchez"), fr)
    }

    func testTheSettingRowSaysWhatStillLoads() {
        // The description exists to stop the label reading as "photos are
        // off". Threads and galleries always load; only the full-size fetch
        // waits for Wi-Fi.
        for locale in ["en", "fr-CA"] {
            let label = AppStrings.translate(locale, MeteredMedia.settingLabel)
            let description = AppStrings.translate(
                locale,
                MeteredMedia.settingDescription
            )
            XCTAssertFalse(label.isEmpty, locale)
            XCTAssertNotEqual(label, description, locale)
            XCTAssertGreaterThan(description.count, 40, locale)
        }
    }
}
