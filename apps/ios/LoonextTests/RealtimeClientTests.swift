import XCTest
@testable import Loonext

/// #215 Part B — the realtime transport must be LOSSLESS and ORDERED. Every
/// ID-only frame off the company channel routes a refetch, so a single dropped
/// (or reordered) frame is a message/status/task that never appears — or
/// appears against stale state — until a full re-JOIN or a navigation.
/// `events()` buffers `.unbounded` (FIFO) for exactly this reason; the old
/// `.bufferingNewest(64)` silently dropped the oldest frames under backpressure.
final class RealtimeClientTests: XCTestCase {
    /// Collects the ordered `seq` payloads a consumer actually received.
    private actor Collector {
        private(set) var seqs: [Int] = []
        func append(_ seq: Int) { seqs.append(seq) }
        var count: Int { seqs.count }
    }

    private func event(_ seq: Int) -> RealtimeEvent {
        RealtimeEvent(
            event: "message.created",
            payload: .object([
                "conversation_id": .string("conv1"),
                "seq": .number(Double(seq)),
            ])
        )
    }

    /// Poll an actor collector until it holds `target` frames or the deadline.
    private func drain(_ collector: Collector, upTo target: Int, timeout: TimeInterval) async {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if await collector.count >= target { return }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    /// Fill the stream's buffer with more frames than the old 64-slot policy
    /// held, BEFORE a (deliberately slow) consumer drains any — deterministic:
    /// under `.unbounded` all N are retained and delivered IN ORDER; under
    /// `.bufferingNewest(64)` only the newest 64 survive (the regression this
    /// guards). Asserting the full ordered list also catches any reordering.
    func testEventStreamDeliversEveryFrameInOrderToALateSlowConsumer() async {
        let client = RealtimeClient()
        let stream = await client.events()
        let total = 300 // well past the old 64-frame buffer

        for index in 0 ..< total {
            await client.deliver(event(index))
        }

        let collector = Collector()
        let consumer = Task {
            for await frame in stream {
                if let seq = frame.payload["seq"]?.doubleValue {
                    await collector.append(Int(seq))
                }
                // The backpressure the dropping policy lost frames under.
                try? await Task.sleep(for: .milliseconds(1))
                if await collector.count == total { break }
            }
        }

        await drain(collector, upTo: total, timeout: 10)
        consumer.cancel()

        let received = await collector.seqs
        XCTAssertEqual(
            received,
            Array(0 ..< total),
            "unbounded buffering must deliver every frame, in FIFO order, with no drops"
        )
    }

    /// A second stream opened off the same client is independent and equally
    /// lossless — the multicast fan-out yields to every observer in order.
    func testEachObserverGetsEveryFrameInOrder() async {
        let client = RealtimeClient()
        let streamA = await client.events()
        let streamB = await client.events()
        let total = 100

        for index in 0 ..< total {
            await client.deliver(event(index))
        }

        func received(_ stream: AsyncStream<RealtimeEvent>) async -> [Int] {
            let collector = Collector()
            let task = Task {
                for await frame in stream {
                    if let seq = frame.payload["seq"]?.doubleValue {
                        await collector.append(Int(seq))
                    }
                    if await collector.count == total { break }
                }
            }
            await drain(collector, upTo: total, timeout: 5)
            task.cancel()
            return await collector.seqs
        }

        let expected = Array(0 ..< total)
        let receivedA = await received(streamA)
        let receivedB = await received(streamB)
        XCTAssertEqual(receivedA, expected)
        XCTAssertEqual(receivedB, expected)
    }
}
