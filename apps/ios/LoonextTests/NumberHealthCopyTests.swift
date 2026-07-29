import XCTest
@testable import Loonext

/// #235 — what a degraded number is told to its owner.
///
/// Ported 1:1 from the Android twin's NumberHealthCopyTest. Three things are
/// pinned and all three are about restraint: this copy tells somebody their
/// business phone line is not working properly, and getting the tone wrong
/// costs more than saying nothing would.
final class NumberHealthCopyTests: XCTestCase {
    private func health(rate: Double? = 0.54) -> NumberHealth {
        NumberHealth(
            state: "degraded",
            delivery_rate: rate,
            degraded_since: "2026-07-01T00:00:00Z",
            detail: "delivery 54% against a baseline of 97%"
        )
    }

    func testGivesTheNumberWhenThereIsOneWorthQuoting() {
        XCTAssertTrue(numberHealthCopy(health()).contains("54%"))
    }

    func testSaysLessRatherThanInventingPrecisionWhenThereIsNoRate() {
        let copy = numberHealthCopy(health(rate: nil))
        XCTAssertTrue(copy.contains("Fewer of your texts"), copy)
        XCTAssertFalse(copy.contains("%"), copy)
    }

    func testNeverSaysSpamOrFlagged() {
        // We know delivery fell. We do NOT know which vendor labelled it, or
        // whether one did. Naming a cause we have not established would be a
        // guess dressed as a diagnosis — and the customer would repeat it to
        // their own customers.
        let copy = numberHealthCopy(health()).lowercased()
        XCTAssertFalse(copy.contains("spam"), copy)
        XCTAssertFalse(copy.contains("flagged"), copy)
        XCTAssertFalse(copy.contains("blocked"), copy)
    }

    func testDoesNotAskTheCustomerToDoAnythingTheyCannotDo() {
        // Remediation is registry paperwork that takes days and needs their
        // real business identity. Implying a self-serve fix would be a lie
        // about the timeline, and they would sit waiting for a button.
        let copy = numberHealthCopy(health())
        XCTAssertTrue(copy.contains("we're on it"), copy)
        XCTAssertTrue(copy.contains("don't need to do anything yet"), copy)
    }
}
