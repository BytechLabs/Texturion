import Foundation

/// Every broadcast carries `seq`, a gapless per-topic counter (D151). A hole in
/// it means a delivery was lost on a healthy socket, and the client answers with
/// the resync a reconnect runs.
///
/// Pure and clock-free: callers pass the time, so the window is testable
/// without sleeping. `RealtimeClient` owns the timer.
struct TopicSequenceTracker {
    /// Two seconds of patience, because Realtime can reorder frames: at the
    /// hosted ceiling's edge the slowest emit-to-socket time was 1.4 s
    /// (CAPACITY.md 2e), so a frame that is only late still lands inside the
    /// window and costs nothing.
    static let reorderWindow: Double = 2

    private struct State {
        /// Highest sequence applied in order, or nil before the first event.
        var last: Int?
        /// Sequences seen beyond a hole, waiting for the hole to fill.
        var ahead: Set<Int> = []
        var deadline: Double?
    }

    private var topics: [String: State] = [:]

    /// The earliest moment an open hole must be answered, if any is open.
    var nextDeadline: Double? {
        topics.values.compactMap(\.deadline).min()
    }

    /// Feed the `seq` of one received broadcast; nil (no sequence) is ignored.
    mutating func observe(_ topic: String, seq: Int?, now: Double) {
        guard let seq else { return }
        var state = topics[topic] ?? State()
        defer { topics[topic] = state }

        guard let last = state.last else {
            state.last = seq
            return
        }
        if seq <= last || state.ahead.contains(seq) { return }

        state.ahead.insert(seq)
        var next = last
        while state.ahead.contains(next + 1) {
            next += 1
            state.ahead.remove(next)
        }
        state.last = next

        if state.ahead.isEmpty {
            state.deadline = nil
        } else if state.deadline == nil {
            state.deadline = now + Self.reorderWindow
        }
    }

    /// The topics whose hole is still open at `now`. Each is rebaselined: the
    /// resync the caller runs reads everything, so what was skipped no longer
    /// matters.
    mutating func expired(now: Double) -> [String] {
        var gaps: [String] = []
        for topic in Array(topics.keys) {
            guard var state = topics[topic],
                  let deadline = state.deadline,
                  deadline <= now,
                  let newest = state.ahead.max()
            else { continue }
            state.last = newest
            state.ahead = []
            state.deadline = nil
            topics[topic] = state
            gaps.append(topic)
        }
        return gaps.sorted()
    }

    /// Forget a topic's baseline; the next event only sets it.
    mutating func reset(_ topic: String) {
        topics.removeValue(forKey: topic)
    }

    mutating func resetAll() {
        topics = [:]
    }
}
