import Foundation

/// #302 — Phoenix Presence, as a pure function of the frames.
///
/// WHY THIS IS SEPARATE FROM `RealtimeClient`. The socket layer is hand-rolled
/// Phoenix over URLSession and cannot be run on the build machine at all — Swift
/// compiles only in CI here. So the part that can be got wrong quietly, turning
/// `presence_state` and `presence_diff` into "who is on this thread", lives
/// where XCTest can exercise it. Same reasoning as `MessageMerge.swift`.
///
/// THE WIRE FORMAT BELOW WAS OBSERVED, NOT GUESSED. Captured off the working
/// web client's socket with two signed-in browsers on one conversation:
///
///   join     → config.presence = ["key": <user_id>, "enabled": true]
///              `enabled` is REQUIRED. Without it the server accepts the join
///              and then silently sends no presence at all, which looks exactly
///              like a feature that does not work.
///   track    → event "presence", payload
///              ["type": "presence", "event": "track", "payload": [ …entry… ]]
///   state    ← "presence_state", payload [<key>: ["metas": [ [...] ]]]
///              (an empty object when nobody is tracked yet)
///   diff     ← "presence_diff", payload ["joins": …, "leaves": …], each side
///              shaped exactly like `presence_state`
///
/// One key can hold several metas — the same person on two devices — which is
/// why the rule collapses by user id rather than trusting the key.

/// One tracked entry, matching the shared `PresenceEntry` contract.
struct PresenceEntry: Equatable, Sendable {
    let userId: String
    let displayName: String
    let conversationId: String
    let at: Int
    let typing: Bool
}

struct PresenceViewer: Equatable, Sendable {
    let userId: String
    let displayName: String
    let typing: Bool
}

/// Mirrors packages/shared/src/presence.ts. Kept in step by the parity test.
enum PresenceTiming {
    static let ttlMs = 45_000
    static let heartbeatMs = 15_000
    static let typingTtlMs = 6_000
    static let typingThrottleMs = 2_000
}

/// The presence map for one topic: key → the metas under it.
///
/// Kept in the raw shape Phoenix sends rather than flattened on arrival: a
/// `leaves` diff names the key, and reconciling that against a flattened list
/// means guessing which entry went.
typealias PresenceMap = [String: [PresenceEntry]]

private func parseMeta(_ meta: [String: Any]) -> PresenceEntry? {
    guard let userId = meta["user_id"] as? String, !userId.isEmpty,
          let conversationId = meta["conversation_id"] as? String, !conversationId.isEmpty
    else { return nil }
    // A missing or unparseable timestamp reads as epoch, which the staleness
    // rule then discards. Dropping the entry outright would reach the same
    // outcome by a less obvious route.
    let at = (meta["at"] as? Int) ?? Int((meta["at"] as? Double) ?? 0)
    return PresenceEntry(
        userId: userId,
        displayName: (meta["display_name"] as? String) ?? "",
        conversationId: conversationId,
        at: at,
        typing: (meta["typing"] as? Bool) ?? false
    )
}

/// Parse one `[key: ["metas": [...]]]` object into the map shape.
private func parseKeyed(_ payload: [String: Any]) -> PresenceMap {
    var out: PresenceMap = [:]
    for (key, value) in payload {
        let metas = (value as? [String: Any])?["metas"] as? [[String: Any]]
        // A key whose metas are missing or unreadable is STILL a key that is
        // present. Recording it empty rather than skipping keeps a later
        // `leaves` able to remove it — dropping it here would leave a phantom
        // no diff can ever clear.
        out[key] = metas?.compactMap(parseMeta) ?? []
    }
    return out
}

/// `presence_state` replaces everything: it is the server's complete answer.
func applyPresenceState(_ payload: [String: Any]) -> PresenceMap {
    parseKeyed(payload)
}

/// `presence_diff` is additive-then-subtractive, and the ORDER matters.
///
/// A rejoin arrives as a leave of the old ref and a join of the new one, and the
/// two can land in the same frame. Applying leaves last would delete the key the
/// joins half just re-established — the person would blink out of the thread
/// every time their token refreshed.
func applyPresenceDiff(_ current: PresenceMap, _ payload: [String: Any]) -> PresenceMap {
    var next = current
    if let leaves = payload["leaves"] as? [String: Any] {
        for key in parseKeyed(leaves).keys { next.removeValue(forKey: key) }
    }
    if let joins = payload["joins"] as? [String: Any] {
        for (key, entries) in parseKeyed(joins) { next[key] = entries }
    }
    return next
}

/// Every entry across every key, for the rule below.
func presenceEntries(_ map: PresenceMap) -> [PresenceEntry] {
    map.values.flatMap { $0 }
}

/// Who else is on this conversation — the Swift port of the shared
/// `presenceFor`. Kept in lockstep by `PresenceLogicTests`.
func viewersOf(
    entries: [PresenceEntry],
    conversationId: String,
    selfUserId: String,
    now: Int,
    healthy: Bool
) -> [PresenceViewer] {
    guard healthy else { return [] }

    var seen: [String: (entry: PresenceEntry, typing: Bool)] = [:]
    for entry in entries {
        guard entry.conversationId == conversationId else { continue }
        guard entry.userId != selfUserId else { continue }
        let age = now - entry.at
        if age < -PresenceTiming.ttlMs { continue }
        if age > PresenceTiming.ttlMs { continue }

        let prior = seen[entry.userId]
        let typing = (entry.typing && age <= PresenceTiming.typingTtlMs) || (prior?.typing ?? false)
        if prior == nil || entry.at > prior!.entry.at {
            seen[entry.userId] = (entry, typing)
        } else if typing != prior!.typing {
            seen[entry.userId] = (prior!.entry, typing)
        }
    }

    return seen.values
        .sorted { $0.entry.at > $1.entry.at }
        .map { pair in
            let name = pair.entry.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
            return PresenceViewer(
                userId: pair.entry.userId,
                displayName: name.isEmpty ? "A teammate" : name,
                typing: pair.typing
            )
        }
}

/// The one line the crew reads. Port of the shared `presenceLabel`.
func presenceLabel(_ viewers: [PresenceViewer]) -> String? {
    if viewers.isEmpty { return nil }

    let typing = viewers.filter { $0.typing }
    switch typing.count {
    case 0: break
    case 1: return "\(typing[0].displayName) is replying…"
    case 2: return "\(typing[0].displayName) and \(typing[1].displayName) are replying…"
    default: return "\(typing.count) people are replying…"
    }

    switch viewers.count {
    case 1: return "\(viewers[0].displayName) is also here"
    case 2: return "\(viewers[0].displayName) and \(viewers[1].displayName) are also here"
    default: return "\(viewers.count) teammates are also here"
    }
}
