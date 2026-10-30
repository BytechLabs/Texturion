import AVFAudio
import Foundation
import UIKit
import UserNotifications

/// Ring beacons (D142): what this phone says happened to one ring. Each stage
/// is one POST of the server's session id, a stage word and the device state
/// that decides whether a ring can show. Never the caller, the number, or
/// anything else from the call.
///
/// A stage is sent only when this phone knows the server's session for it.
/// Every member ring's INVITE names that session in X-Loonext-Session, so a
/// ring is keyed from the moment it arrives; a pushed ring that CallKit showed
/// before its INVITE keeps the moment and sends it once the INVITE names the
/// session.
///
/// Fire and forget: nothing on the call path waits for it, every failure is
/// dropped without a line in the diagnostics a support report shares, and
/// each stage is sent at most once per session. ring-beacons.test.ts in
/// apps/api compares the words below with the server's.
enum RingBeaconStage: String, Sendable {
    case pushReceived = "push_received"
    case osReported = "os_reported"
    case ringMeSent = "ring_me_sent"
    case ringingShown = "ringing_shown"
    case answered = "answered"
    case declined = "declined"
}

/// The request body. Optional fields the phone could not read are left out.
struct RingBeaconBody: Encodable, Sendable, Equatable {
    let call_session_id: String
    let stage: String
    let occurred_at: String
    let os: String
    let permissions: [String: String]
    let power_save: Bool?
}

/// Which (session, stage) pairs were already sent, for the most recent
/// `capacity` of them. A ring lasts under a minute, so a small window is
/// enough and the memory never grows with the life of the process.
struct RingBeaconLedger: Sendable {
    private var seen: [String] = []
    let capacity: Int

    init(capacity: Int = 64) {
        self.capacity = capacity
    }

    mutating func firstTime(_ sessionId: String, _ stage: RingBeaconStage) -> Bool {
        let key = "\(sessionId)|\(stage.rawValue)"
        guard !seen.contains(key) else { return false }
        seen.append(key)
        if seen.count > capacity {
            seen.removeFirst(seen.count - capacity)
        }
        return true
    }
}

@MainActor
enum RingBeacons {
    private static var ledger = RingBeaconLedger()

    /// Record `stage` for `sessionId`, as of `at`. Returns at once; a missing
    /// workspace or session, or a stage already sent for this session, sends
    /// nothing.
    static func emit(
        _ stage: RingBeaconStage,
        sessionId: String?,
        companyId: String?,
        api: ApiClient,
        at: Date = Date()
    ) {
        guard let sessionId, !sessionId.isEmpty,
              let companyId, !companyId.isEmpty
        else { return }
        guard ledger.firstTime(sessionId, stage) else { return }
        // Stamped before the hop, so the time is the stage's and not the send's.
        let occurredAt = timestamp(at)
        Task { @MainActor in
            let body = RingBeaconBody(
                call_session_id: sessionId,
                stage: stage.rawValue,
                occurred_at: occurredAt,
                os: "ios-\(UIDevice.current.systemVersion)",
                permissions: await permissions(),
                power_save: ProcessInfo.processInfo.isLowPowerModeEnabled
            )
            guard let data = try? JSONEncoder().encode(body) else { return }
            await api.sendQuietly("POST", "/v1/ring-beacons", body: data, companyId: companyId)
        }
    }

    /// The session a member's answer or decline of `call` is evidence about: an
    /// inbound call still ringing, by the session its INVITE named, else by
    /// the one an earlier answer resolved. Anything else is not a ring.
    nonisolated static func ringingSession(
        _ call: CallSnapshot?,
        ringSession: String?
    ) -> String? {
        guard let call, call.direction == .inbound, call.phase == .ringing else { return nil }
        return ringSession ?? call.sessionId
    }

    nonisolated static func timestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func permissions() async -> [String: String] {
        var out: [String: String] = [:]
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            out["notifications"] = "granted"
        case .denied:
            out["notifications"] = "denied"
        case .notDetermined:
            out["notifications"] = "prompt"
        @unknown default:
            out["notifications"] = "unknown"
        }
        switch AVAudioApplication.shared.recordPermission {
        case .granted:
            out["microphone"] = "granted"
        case .denied:
            out["microphone"] = "denied"
        default:
            // Undetermined: iOS has not asked yet.
            out["microphone"] = "prompt"
        }
        return out
    }
}
