import XCTest
@testable import Loonext

/// Attachment kinds and the words the inbox puts on them.
///
/// The founder's report was a voice message shown as "Photo", so the naming
/// rules are pinned here. The mapping must stay identical to
/// packages/shared/src/mms.ts and public.mms_media_kind (migration
/// 20260724080000) — a row must not change its wording depending on whether the
/// server or the client answered.
final class MediaKindTests: XCTestCase {
    func testMapsEveryContentTypeFamily() {
        XCTAssertEqual(MediaKind.of("image/jpeg"), .image)
        XCTAssertEqual(MediaKind.of("audio/mp4"), .audio)
        XCTAssertEqual(MediaKind.of("video/3gpp"), .video)
        XCTAssertEqual(MediaKind.of("text/vcard"), .contact)
        XCTAssertEqual(MediaKind.of("text/x-vcard"), .contact)
        XCTAssertEqual(MediaKind.of("text/calendar"), .calendar)
        XCTAssertEqual(MediaKind.of("application/pdf"), .document)
        XCTAssertEqual(MediaKind.of("text/plain"), .text)
    }

    func testCanonicalizesParametersAndCase() {
        // The exact shape Telnyx delivered for the founder's voice message.
        XCTAssertEqual(MediaKind.of("AUDIO/MP4; codecs=mp4a"), .audio)
        XCTAssertEqual(MediaKind.of("  image/PNG  "), .image)
    }

    func testUnknownAndMissingFallBackToFile() {
        XCTAssertEqual(MediaKind.of("application/zip"), .file)
        XCTAssertEqual(MediaKind.of(nil), .file)
        XCTAssertEqual(MediaKind.of(""), .file)
    }

    func testAudioIsNeverCalledAPhoto() {
        XCTAssertEqual(attachmentLabel(kind: .audio, count: 1), "Audio message")
    }

    func testLabelsEachKind() {
        XCTAssertEqual(attachmentLabel(kind: .image, count: 1), "Photo")
        XCTAssertEqual(attachmentLabel(kind: .video, count: 1), "Video")
        XCTAssertEqual(attachmentLabel(kind: .contact, count: 1), "Contact card")
        XCTAssertEqual(attachmentLabel(kind: .calendar, count: 1), "Calendar invite")
        XCTAssertEqual(attachmentLabel(kind: .document, count: 1), "PDF")
        XCTAssertEqual(attachmentLabel(kind: .text, count: 1), "Text file")
        XCTAssertEqual(attachmentLabel(kind: .file, count: 1), "Attachment")
        XCTAssertEqual(attachmentLabel(kind: nil, count: 1), "Attachment")
    }

    func testPluralizesWithTheCount() {
        XCTAssertEqual(attachmentLabel(kind: .image, count: 3), "3 photos")
        XCTAssertEqual(attachmentLabel(kind: .audio, count: 2), "2 audio messages")
        XCTAssertEqual(attachmentLabel(kind: .document, count: 2), "2 PDFs")
        XCTAssertEqual(attachmentLabel(kind: nil, count: 4), "4 attachments")
    }

    func testNeverReadsAsZero() {
        XCTAssertEqual(attachmentLabel(kind: .image, count: 0), "Photo")
    }

    func testSharedKindIsNilForAMixedSet() {
        XCTAssertEqual(sharedMediaKind([.image, .image]), .image)
        XCTAssertNil(sharedMediaKind([.image, .audio]))
        XCTAssertNil(sharedMediaKind([]))
    }

    func testSnippetDecodesWithoutTheNewFields() throws {
        // A response predating migration 20260724080000 must still decode.
        let json = """
        {"id":"m1","direction":"inbound","body":"","created_at":"2026-07-24T00:00:00Z",
         "has_attachments":true}
        """.data(using: .utf8)!
        let snippet = try JSONDecoder().decode(ConversationSnippet.self, from: json)
        XCTAssertTrue(snippet.has_attachments)
        XCTAssertNil(snippet.attachment_kind)
        XCTAssertNil(snippet.attachment_count)
    }

    func testSnippetDecodesTheKindAndCount() throws {
        let json = """
        {"id":"m1","direction":"inbound","body":"","created_at":"2026-07-24T00:00:00Z",
         "has_attachments":true,"attachment_count":1,"attachment_kind":"audio"}
        """.data(using: .utf8)!
        let snippet = try JSONDecoder().decode(ConversationSnippet.self, from: json)
        XCTAssertEqual(snippet.attachment_kind, "audio")
        XCTAssertEqual(snippet.attachment_count, 1)
        XCTAssertEqual(
            attachmentLabel(
                kind: snippet.attachment_kind.map { MediaKind(rawValue: $0) ?? .file },
                count: snippet.attachment_count ?? 1
            ),
            "Audio message"
        )
    }
}
