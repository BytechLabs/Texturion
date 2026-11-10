import XCTest
@testable import Loonext

/// #717: the default is offered once, as the inherit choice, never twice.
final class DefaultChoiceTests: XCTestCase {

    func testTheDefaultsOwnValueIsNotOfferedBesideTheInheritChoice() {
        XCTAssertFalse(offeredBesideDefault("en", default: "en", stored: nil))
        XCTAssertTrue(offeredBesideDefault("fr-CA", default: "en", stored: nil))
    }

    func testARecordAlreadySetToTheDefaultsValueKeepsItAsTheStateInForce() {
        XCTAssertTrue(offeredBesideDefault("en", default: "en", stored: "en"))
    }

    func testAnUnknownDefaultHidesNothing() {
        XCTAssertTrue(offeredBesideDefault("en", default: nil, stored: nil))
        XCTAssertEqual(
            choicesBesideDefault([15, 20, 30], default: nil, stored: nil),
            [15, 20, 30]
        )
    }

    func testChoicesDropOnlyTheDefaultUnlessItIsStored() {
        let rings = [15, 20, 30, 45]
        XCTAssertEqual(
            choicesBesideDefault(rings, default: 45, stored: nil), [15, 20, 30]
        )
        XCTAssertEqual(choicesBesideDefault(rings, default: 45, stored: 45), rings)
        XCTAssertEqual(
            choicesBesideDefault(rings, default: 30, stored: 45), [15, 20, 45]
        )
    }
}
