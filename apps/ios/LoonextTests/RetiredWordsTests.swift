import XCTest

@testable import Loonext

/// One word per thing. A task's labels and a conversation's tags are the same
/// list (`task_tags` takes its values from the workspace's tag vocabulary), so
/// English says "tag" everywhere. This reads every English value and fails when
/// "label" or "labels" appears, unless the key is named below with the reason
/// its word means something else.
///
/// The roster is closed: an entry whose value no longer says "label" FAILS, so
/// it cannot outlive the copy it excuses. The web and Android twins
/// (`retired-words.test.ts`, `RetiredWordsTest.kt`) are kept in step by hand.
final class RetiredWordsTests: XCTestCase {
    /// Key to why "label" is the right word there.
    private let otherMeanings: [String: String] = [
        "contactsTasks.labelField": "the name of a custom field's label",
        "settings.screeningFlag": "call screening flags a call with a caller-ID label",
    ]

    /// The words a reader sees: `{name}` placeholders removed, then split on
    /// anything that is not a letter. Written by hand rather than with a regular
    /// expression, like the token reader in `AppStringsTests`.
    private func words(in value: String) -> [String] {
        var readable = ""
        var inToken = false
        for character in value.lowercased() {
            if character == "{" { inToken = true; readable.append(" "); continue }
            if character == "}" { inToken = false; continue }
            if inToken { continue }
            readable.append(character.isLetter ? character : " ")
        }
        return readable.split(separator: " ").map(String.init)
    }

    private func saysLabel(_ value: String) -> Bool {
        words(in: value).contains { $0 == "label" || $0 == "labels" }
    }

    func testNoEnglishValueCallsATagALabel() {
        let all = AppStrings.en
        XCTAssertGreaterThan(all.count, 1000, "read only \(all.count) English values")

        let offenders = all
            .filter { saysLabel($0.value) && otherMeanings[$0.key] == nil }
            .map { "\($0.key): \($0.value)" }
            .sorted()
        XCTAssertEqual(offenders, [], "a tag is called a label")
    }

    func testEveryNamedExceptionStillSaysLabel() {
        let stale = otherMeanings.keys.filter { key in
            guard let value = AppStrings.en[key] else { return true }
            return !saysLabel(value)
        }
        XCTAssertEqual(stale.sorted(), [], "exceptions that no longer match")
    }
}
