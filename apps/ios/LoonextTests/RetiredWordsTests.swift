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

    /// "Thread" is retired for "conversation", the record the menus already
    /// name. Key to why "thread" is the right word there.
    private let threadOtherMeanings: [String: String] = [:]

    /// "Line" meaning a phone line is retired for "number". "Line" keeps its
    /// other meanings (a line of text, "Line of work", `{line}`), so the bare
    /// word is not banned: this matches the phrases a phone line turns up in.
    /// Key to why "line" is not a phone line there.
    private let lineOtherMeanings: [String: String] = [
        "settings.aiCatchUpHelp": "every line of a catch-up is a line of text quoting a message",
    ]

    private func saysThread(_ value: String) -> Bool {
        words(in: value).contains { $0 == "thread" || $0 == "threads" }
    }

    private func saysPhoneLine(_ value: String) -> Bool {
        let all = words(in: value)
        for index in all.indices where all[index] == "line" || all[index] == "lines" {
            let before = index > 0 ? all[index - 1] : ""
            let beforeThat = index > 1 ? all[index - 2] : ""
            let after = index + 1 < all.count ? all[index + 1] : ""
            if ["business", "phone", "shop", "office", "field", "shared"].contains(before) { return true }
            if all[index] == "lines" { continue }
            if ["this", "that", "each", "every"].contains(before) { return true }
            if ["a", "the", "this", "that"].contains(before) && after == "s" { return true }
            if before == "the" && (after == "you" || after == "they") { return true }
            if after == "busy" || after == "paused" || after == "ready" { return true }
            if before == "the" && beforeThat == "on" { return true }
        }
        return false
    }

    func testNoEnglishValueCallsAConversationAThread() {
        let offenders = AppStrings.en
            .filter { saysThread($0.value) && threadOtherMeanings[$0.key] == nil }
            .map { "\($0.key): \($0.value)" }
            .sorted()
        XCTAssertEqual(offenders, [], "a conversation is called a thread")
    }

    func testEveryNamedThreadExceptionStillSaysThread() {
        let stale = threadOtherMeanings.keys.filter { key in
            guard let value = AppStrings.en[key] else { return true }
            return !saysThread(value)
        }
        XCTAssertEqual(stale.sorted(), [], "exceptions that no longer match")
    }

    func testNoEnglishValueCallsAPhoneNumberALine() {
        let offenders = AppStrings.en
            .filter { saysPhoneLine($0.value) && lineOtherMeanings[$0.key] == nil }
            .map { "\($0.key): \($0.value)" }
            .sorted()
        XCTAssertEqual(offenders, [], "a phone number is called a line")
    }

    func testEveryNamedLineExceptionStillMatches() {
        let stale = lineOtherMeanings.keys.filter { key in
            guard let value = AppStrings.en[key] else { return true }
            return !saysPhoneLine(value)
        }
        XCTAssertEqual(stale.sorted(), [], "exceptions that no longer match")
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

    /// #755: the audit log was "History" in the nav and "Activity log" in search.
    func testNoEnglishValueNamesTheAuditLogHistoryOrActivityLog() {
        let offenders = AppStrings.en
            .filter { entry in
                let all = words(in: entry.value)
                let saysActivityLog = zip(all, all.dropFirst()).contains { $0 == "activity" && $1 == "log" }
                return all == ["history"] || saysActivityLog
            }
            .map { "\($0.key): \($0.value)" }
            .sorted()
        XCTAssertEqual(offenders, [], "the audit log is called something else")
    }
}
