import XCTest
@testable import Loonext

/// The one retry-affordance rule (SPEC): outbound + failed + no carrier id +
/// error code != 40300 (carrier opt-out block). Ported 1:1 from the Android
/// RetryableTest.kt.
final class MessagingRetryableTests: XCTestCase {
    private func message(
        direction: String = MessageDirection.outbound,
        status: String? = MessageStatus.failed,
        telnyxId: String? = nil,
        errorCode: String? = "internal"
    ) -> Message {
        Message(
            id: "m1",
            conversation_id: "c1",
            direction: direction,
            body: "hello",
            status: status,
            segments: nil,
            encoding: nil,
            sent_by_user_id: nil,
            error_code: errorCode,
            error_detail: nil,
            telnyx_message_id: telnyxId,
            done_at: nil,
            done_by_user_id: nil,
            pinned_at: nil,
            pinned_by_user_id: nil,
            created_at: "2026-07-15T00:00:00Z",
            attachments: [],
            has_task: false,
            promoted_task: nil,
            task_id: nil,
            task: nil
        )
    }

    func testApiLevelFailureWithNoCarrierIdIsRetryable() {
        XCTAssertTrue(message().retryable)
    }

    func testACarrierAssignedIdBlocksRetry() {
        XCTAssertFalse(message(telnyxId: "tx_123").retryable)
    }

    func testCarrierOptOut40300BlocksRetry() {
        XCTAssertFalse(message(errorCode: carrierOptOutErrorCode).retryable)
    }

    func testOnlyFailedStatusIsRetryable() {
        XCTAssertFalse(message(status: MessageStatus.queued).retryable)
        XCTAssertFalse(message(status: MessageStatus.sent).retryable)
        XCTAssertFalse(message(status: MessageStatus.delivered).retryable)
        XCTAssertFalse(message(status: nil).retryable)
    }

    func testOnlyOutboundIsRetryable() {
        XCTAssertFalse(
            message(
                direction: MessageDirection.inbound,
                status: MessageStatus.received
            ).retryable
        )
        XCTAssertFalse(message(direction: MessageDirection.note, status: nil).retryable)
    }

    func testANilErrorCodeWithNoCarrierIdStaysRetryable() {
        XCTAssertTrue(message(errorCode: nil).retryable)
    }
}
