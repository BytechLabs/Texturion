import XCTest
@testable import Loonext

/// #716: when the catch-up hint shows and comes back, and where the answers are kept.
final class PinsAndCatchUpTests: XCTestCase {

    func testTheHintFollowsTheOfferRule() {
        XCTAssertTrue(catchUpHintShown(offered: true, recapOpen: false, newestFromOthersId: "m1", answeredId: nil))
        XCTAssertFalse(catchUpHintShown(offered: false, recapOpen: false, newestFromOthersId: "m1", answeredId: nil))
    }

    func testAnAnsweredHintStaysHiddenUntilANewerMessageFromSomeoneElse() {
        XCTAssertFalse(catchUpHintShown(offered: true, recapOpen: false, newestFromOthersId: "m1", answeredId: "m1"))
        XCTAssertTrue(catchUpHintShown(offered: true, recapOpen: false, newestFromOthersId: "m2", answeredId: "m1"))
    }

    func testARecapOnScreenHidesTheHint() {
        XCTAssertFalse(catchUpHintShown(offered: true, recapOpen: true, newestFromOthersId: "m1", answeredId: nil))
    }

    func testAThreadWithNothingFromAnyoneElseOffersNoHint() {
        XCTAssertFalse(catchUpHintShown(offered: true, recapOpen: false, newestFromOthersId: nil, answeredId: nil))
    }

    func testAnswersAndPinStateAreKeptPerConversation() {
        let suite = "PinsAndCatchUpTests"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }

        XCTAssertFalse(PinsOpenStore.read("c1", defaults: defaults))
        PinsOpenStore.write(true, conversationId: "c1", defaults: defaults)
        XCTAssertTrue(PinsOpenStore.read("c1", defaults: defaults))
        XCTAssertFalse(PinsOpenStore.read("c2", defaults: defaults))

        XCTAssertNil(CatchUpAnswerStore.read("c1", defaults: defaults))
        CatchUpAnswerStore.write("m9", conversationId: "c1", defaults: defaults)
        XCTAssertEqual(CatchUpAnswerStore.read("c1", defaults: defaults), "m9")
        XCTAssertNil(CatchUpAnswerStore.read("c2", defaults: defaults))
    }

    func testTheNewStringsExistInBothLanguages() {
        for locale in ["en", "fr-CA"] {
            for key in ["thread.catchUpHint", "thread.catchUpRecap", "thread.notNow"] {
                let text = AppStrings.translate(locale, key)
                XCTAssertFalse(text.isEmpty || text == key, "\(locale) \(key)")
            }
        }
        XCTAssertEqual(AppStrings.translate("fr-CA", "thread.catchUpHint"), "Rattraper cette conversation ?")
    }
}
