import XCTest
@testable import Loonext

/// #414 / #565 — the urgent mark, and that this phone agrees with the laptop and
/// with Android about when it shows.
///
/// Two halves. The behaviour tests assert the rule; the parity tests read
/// `packages/shared/src/emergency-flag.ts`, because this is a hand-port and
/// nothing about Swift says the original stayed put.
///
/// The bug this file exists for is one layer up: `ConversationDetail` never
/// declared `emergency_at`, so the decoder dropped it and the thread an urgent
/// notification opens was the one screen that could not say why you were there.
/// `scripts/check-conversation-detail-parity.mjs` guards that half — a model
/// missing a field the server sends. This file guards the rule that reads it.
final class EmergencyFlagTests: XCTestCase {

    private let when = "2026-08-08T23:04:00.000Z"

    func testAnOrdinaryOpenThreadIsNotFlagged() {
        XCTAssertFalse(isConversationFlaggedUrgent(emergencyAt: nil, closedAt: nil))
    }

    func testAnUrgentThreadIsFlaggedWhileItIsOpen() {
        XCTAssertTrue(isConversationFlaggedUrgent(emergencyAt: when, closedAt: nil))
    }

    func testClosingTheThreadClearsTheMark() {
        // Closing is the product's existing word for "handled". A badge that never
        // cleared would be decoration, and a timer deciding an emergency stopped
        // mattering would be a guess made while somebody was still driving to it.
        XCTAssertFalse(isConversationFlaggedUrgent(emergencyAt: when, closedAt: when))
    }

    func testAClosedThreadThatWasNeverUrgentIsNotFlagged() {
        XCTAssertFalse(isConversationFlaggedUrgent(emergencyAt: nil, closedAt: when))
    }

    func testTheLabelIsNotPreShoutedSoVoiceOverDoesNotSpellIt() {
        XCTAssertEqual(urgentBadgeLabel, "Urgent")
        XCTAssertNotEqual(urgentBadgeLabel, urgentBadgeLabel.uppercased())
    }

    /// The detail model declares the field the whole issue was about.
    ///
    /// A decoding test rather than a compile-time one: a `Codable` with no
    /// property for a key does not fail, it ignores it — which is exactly how this
    /// shipped. So the check has to be "did the value survive the wire".
    func testTheDetailModelActuallyDecodesEmergencyAt() throws {
        let json = """
        {
          "id": "c-1", "company_id": "co-1", "contact_id": "ct-1",
          "phone_number_id": "pn-1", "status": "open", "is_spam": false,
          "assigned_user_id": null, "pinned_at": null, "pinned_by_user_id": null,
          "last_message_at": "\(when)", "closed_at": null,
          "emergency_at": "\(when)", "opt_out_hint_at": null,
          "created_at": "\(when)", "updated_at": "\(when)",
          "contact": {
            "id": "ct-1", "name": "Jake", "phone_e164": "+14165550123",
            "address": null, "notes": null, "consent_source": null,
            "consent_at": null, "deleted_at": null
          },
          "messages": { "data": [], "next_cursor": null }
        }
        """
        let detail = try JSONDecoder().decode(
            ConversationDetail.self,
            from: Data(json.utf8)
        )
        XCTAssertEqual(detail.emergency_at, when)
        XCTAssertTrue(
            isConversationFlaggedUrgent(
                emergencyAt: detail.emergency_at,
                closedAt: detail.closed_at
            )
        )
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
            contentsOf: try repoPath("packages/shared/src/emergency-flag.ts"),
            encoding: .utf8
        )
    }

    /// The shared module still reads presence rather than an ordering.
    ///
    /// A grep rather than a second implementation: the one way this rule could
    /// change without any behaviour test here failing is if the original started
    /// COMPARING the two timestamps. Both answers are "a boolean", so only the
    /// source shows the difference.
    func testTheSharedModuleStillReadsPresence() throws {
        XCTAssertTrue(
            try sharedSource().contains(
                "conversation.emergency_at !== null && conversation.closed_at === null"
            ),
            "the shared rule is no longer a presence check"
        )
    }

    func testTheSharedLabelIsTheWordThisFileExpects() throws {
        XCTAssertTrue(
            try sharedSource().contains("URGENT_BADGE_LABEL = \"\(urgentBadgeLabel)\""),
            "URGENT_BADGE_LABEL has changed in the shared module"
        )
    }
}
