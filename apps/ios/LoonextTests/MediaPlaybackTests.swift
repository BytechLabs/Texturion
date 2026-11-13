import AVFoundation
import XCTest
@testable import Loonext

final class MediaPlaybackTests: XCTestCase {
    /// Players that set the audio session themselves, and why.
    private static let ownSession: [String: String] = [
        "Features/Settings/VoiceGreeting.swift": "Hearing a take back sets .playback itself and does not yet check for an engaged call; it should move to prepareMediaPlayback().",
    ]

    private static let playerPattern = #"\b(?:AVPlayer|AVAudioPlayer|AVQueuePlayer)\("#

    func testAnEngagedCallLeavesTheSessionAlone() {
        XCTAssertEqual(MediaPlaybackDecision.decide(callEngaged: true), .leaveAlone)
    }

    func testWithNoCallMediaUsesPlayback() {
        XCTAssertEqual(MediaPlaybackDecision.decide(callEngaged: false), .usePlayback)
    }

    func testFinishedPlaybackHandsBackOnlyItsOwnSession() {
        XCTAssertTrue(MediaPlaybackDecision.mayRelease(callEngaged: false, category: .playback))
        XCTAssertFalse(MediaPlaybackDecision.mayRelease(callEngaged: true, category: .playback))
    }

    func testFinishedPlaybackNeverStopsARecorderOrACall() {
        XCTAssertFalse(MediaPlaybackDecision.mayRelease(callEngaged: false, category: .record))
        XCTAssertFalse(MediaPlaybackDecision.mayRelease(callEngaged: false, category: .playAndRecord))
    }

    func testEveryPlayerPreparesTheSession() throws {
        let base = try UiPatternScan.sourceRoot()
        let walker = try XCTUnwrap(
            FileManager.default.enumerator(at: base, includingPropertiesForKeys: nil)
        )
        let player = try NSRegularExpression(pattern: Self.playerPattern)
        var players: [String] = []
        var unprepared: Set<String> = []
        for case let url as URL in walker where url.pathExtension == "swift" {
            let relative = String(url.path.dropFirst(base.path.count + 1))
            let text = UiPatternScan.stripComments(try String(contentsOf: url, encoding: .utf8))
            let whole = NSRange(text.startIndex..., in: text)
            guard player.firstMatch(in: text, range: whole) != nil else { continue }
            players.append(relative)
            if !text.contains("prepareMediaPlayback()") { unprepared.insert(relative) }
        }

        XCTAssertFalse(players.isEmpty, "the scan found no media player under \(base.path)")
        XCTAssertEqual(
            unprepared,
            Set(Self.ownSession.keys),
            "every media player calls prepareMediaPlayback() before play(), or the ring switch mutes it; an entry that now does, or no longer plays, leaves the list. Players found: \(players)"
        )
        for (file, reason) in Self.ownSession {
            XCTAssertFalse(reason.isEmpty, "\(file) needs a reason")
        }
    }
}
