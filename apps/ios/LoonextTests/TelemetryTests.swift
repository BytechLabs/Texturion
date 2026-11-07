import XCTest
@testable import Loonext

/// D146: what an exception carries to PostHog. The message is the part a person
/// wrote into; the frames are class and line names.
final class TelemetryTests: XCTestCase {
    func testAThrownMessageLeavesWithItsPhoneNumberAndEmailRedacted() {
        XCTAssertEqual(
            Telemetry.scrubText("+16135550123 a@b.co"),
            "[phone redacted] [email redacted]"
        )
    }

    func testAURLLosesItsQueryStringAndAPublicLinkItsToken() {
        XCTAssertEqual(
            Telemetry.scrubText("GET https://api.loonext.com/v1/contacts?address=eq.140+Maple+Ave failed"),
            "GET https://api.loonext.com/v1/contacts failed"
        )
        XCTAssertEqual(
            Telemetry.scrubText("404 at https://api.loonext.com/photos/abcDEF123456abcDEF123456abcDEF123456abcDEF1?x=1"),
            "404 at https://api.loonext.com/photos/[token]"
        )
        XCTAssertEqual(Telemetry.scrubText("/pay/Zm9vYmFyYmF6"), "/pay/[token]")
    }

    func testOnlyTheMessageIsRewrittenNotTheFrames() {
        let list: [[String: Any]] = [[
            "type": "NSInvalidArgumentException",
            "value": "no route to +16135550123",
            "stacktrace": ["frames": [["function": "send", "lineno": 42]]],
        ]]
        let out = Telemetry.scrubbedExceptions(list)
        XCTAssertEqual(out.first?["value"] as? String, "no route to [phone redacted]")
        XCTAssertEqual(out.first?["type"] as? String, "NSInvalidArgumentException")
        XCTAssertNotNil(out.first?["stacktrace"])
    }

    func testABuildWithoutAProjectKeySendsNothing() {
        // The test host has no PostHogProjectKey: setup must return quietly.
        Telemetry.setup(bundle: Bundle(for: TelemetryTests.self))
    }
}
