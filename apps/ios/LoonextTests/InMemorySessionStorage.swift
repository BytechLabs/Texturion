import Foundation

@testable import Loonext

/// A session store's backing, in memory, for a host with no keychain. [#599]
///
/// # Why this lives in the test target and not beside the real one
///
/// `SessionStore` persists the credential that authorizes every request this app makes.
/// A type that makes it forget everything on relaunch has no business being reachable
/// from the shipping binary — the failure would be silent (people quietly signed out on
/// every cold start) and the mistake that causes it is one line at a construction site.
/// Here, production cannot name it.
///
/// # Why it exists at all
///
/// The simulator test host has no keychain, on every run. Two cases in
/// `ThreadControllerResyncTests` skipped for that reason from the day they were written
/// — including the #215 contract that a message the backend holds, which no realtime
/// event delivered, is recovered — and `XCTSkipIf` reports as a pass, so the suite
/// looked green while never executing the guarantee it exists for.
///
/// The keychain is the only part the host lacks. Everything above it — encoding,
/// decoding, the `changes` broadcast, the lock — is ordinary code that had never been
/// exercised either, and now is.
final class InMemorySessionStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Data?

    init() {}

    func read() -> Data? { lock.withLock { stored } }
    func write(_ data: Data) { lock.withLock { stored = data } }
    func remove() { lock.withLock { stored = nil } }
}
