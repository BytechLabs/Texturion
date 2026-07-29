import Foundation

/// #234 — the durable outbox (the Android `Outbox.kt` twin).
///
/// Our users are in crawl spaces, mechanical rooms, elevators and parking
/// garages. That is not an edge case, it is the job. Before this, a send that
/// could not reach the server dropped its pending row, restored the draft and
/// showed a toast — so a tech who typed an update in a basement, hit send and
/// walked to the truck had nothing queued and, if they missed the toast,
/// believed the customer had been told.
///
/// WHAT DECIDES WHETHER SOMETHING IS QUEUED is whether we reached the server
/// at all, and that distinction is the whole design:
///
///   - We never reached it (no signal, DNS, timeout) → QUEUE. We have no
///     answer yet, so the message waits for one.
///   - We reached it and it REFUSED (opted out, cap, registration) → do NOT
///     queue. That is an answer, and queueing it would mean re-asking a
///     question already decided while telling the person their message is on
///     its way.
///
/// #234 asks for "gates run at flush time, not at queue time", and this is
/// that rule stated precisely: a gate that has not run yet runs at flush; a
/// gate that has already refused is not re-run, it is reported.
///
/// IDEMPOTENCY IS INHERITED, not invented. The key minted for the first
/// attempt is stored with the row and reused by every flush, so the existing
/// server-side claim machinery collapses a double-send into one message.
struct QueuedSend: Codable, Equatable, Identifiable, Sendable {
    /// Also the idempotency key: one identity for the life of this message.
    let localId: String
    let companyId: String
    let conversationId: String
    let body: String
    /// ISO-8601, when the person actually pressed send.
    let createdAt: String
    /// Flush attempts so far — surfaced so a stuck row can be seen, not hidden.
    var attempts: Int = 0
    /// The last flush failure, for the row's own explanation.
    var lastError: String? = nil
    /// Set when the server REFUSED at flush. The row stops being retried
    /// automatically and waits for the person: a refusal is an answer, and
    /// silently re-asking would either spam a gate or, worse, eventually get a
    /// yes to a question the customer had already answered with STOP.
    var blocked: Bool = false
    /// Photos that ride with this message, as files this app owns.
    ///
    /// The bytes are already in hand when the person presses send (the
    /// composer read and normalized them to stage the chip), so queueing
    /// copies them into our own container. Nothing here refers to the picker's
    /// item, whose access ends with the picking session — a row restored after
    /// a relaunch would otherwise hold a handle to nothing and the message
    /// would send with the photo silently missing, which is the exact failure
    /// #234 exists to prevent.
    var media: [QueuedMedia] = []
    /// The person has been told this message is old and said send it anyway.
    ///
    /// Without this the age-out below would re-block the row on the very next
    /// flush, so "send it now" would be a button that does nothing.
    var staleAcknowledged: Bool = false

    var id: String { localId }
}

/// One queued photo: a file in this app's container, plus what it is.
struct QueuedMedia: Codable, Equatable, Sendable {
    let fileName: String
    let contentType: String
}

/// Bytes on their way to disk — the composer's StagedPhoto, minus its identity.
struct OutboxMediaBytes: Sendable {
    let contentType: String
    let bytes: Data
}

/// How long a queued message keeps sending itself before it stops and asks.
///
/// A day, because the thing being protected against is not the basement — it
/// is the phone that was in a drawer all weekend. "On my way" delivered Monday
/// morning is worse than not delivered: the customer reads it as current. Past
/// this the row waits for a person, who is the only one who knows whether the
/// message still means anything.
let outboxAgeOutHours: Double = 24

/// Said to the person, not logged — so it names the decision they now own.
let outboxStaleMessage =
    "Queued for over a day. The conversation may have moved on — send it now, or delete it."

/// Said when the photo is gone but the words are still worth sending.
let outboxMediaLostMessage =
    "The photo for this message is no longer on this device. Send the text on its own, "
        + "or delete it."

/// Persistence for the outbox.
///
/// `UserDefaults` is injectable for the reason `ComposerDrafts` makes it so:
/// what this must survive — app kill, a reboot, a flush racing itself — is
/// exactly what a device test would never catch reliably, and a throwaway
/// suite makes all of it assertable.
@MainActor
final class Outbox {
    /// ONE key holding the whole queue, rather than a key per message: a queue
    /// is read and rewritten as a unit on every flush, and a crash between two
    /// per-message writes could otherwise leave it half-updated. It is small
    /// by construction — a person can only type so many messages while offline.
    private static let storageKey = "outbox:queued"

    private let defaults: UserDefaults
    private let mediaRoot: URL

    /// Application Support, not Caches: the system may evict a cache under
    /// storage pressure, and a photo that disappears because the phone was
    /// full is the silent drop this whole file exists to prevent.
    init(defaults: UserDefaults = .standard, mediaRoot: URL? = nil) {
        self.defaults = defaults
        self.mediaRoot = mediaRoot
            ?? FileManager.default
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Outbox", isDirectory: true)
    }

    func all() -> [QueuedSend] {
        guard let data = defaults.data(forKey: Self.storageKey) else { return [] }
        // A queue we cannot decode is a queue we cannot send. Reporting empty
        // rather than crashing keeps the app usable; the raw value is left in
        // place, so nothing is destroyed on the way past.
        return (try? JSONDecoder().decode([QueuedSend].self, from: data)) ?? []
    }

    func put(_ send: QueuedSend) {
        var next = all().filter { $0.localId != send.localId }
        next.append(send)
        write(next)
    }

    /// Drops the row AND the photos it owned — nothing outlives its message.
    func remove(_ localId: String) {
        write(all().filter { $0.localId != localId })
        try? FileManager.default.removeItem(at: directory(for: localId))
    }

    /// Everything queued for one thread, oldest first (the timeline order).
    func forConversation(_ conversationId: String) -> [QueuedSend] {
        all()
            .filter { $0.conversationId == conversationId }
            .sorted { $0.createdAt < $1.createdAt }
    }

    // MARK: - Photos

    /// Copy staged bytes into our container, before the row is written.
    ///
    /// That order is deliberate. Files first then row means a crash in between
    /// leaves orphaned files, which `pruneMedia` sweeps. Row first then files
    /// would leave a row pointing at photos that do not exist — a message that
    /// can never be sent as written, which is the worse of the two.
    ///
    /// Synchronous on the main actor, like everything else on this class: the
    /// composer caps a text's photos at 1 MB each and three of them, and this
    /// runs once, at the moment a send fails.
    func saveMedia(_ localId: String, _ items: [OutboxMediaBytes]) -> [QueuedMedia] {
        let dir = directory(for: localId)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return items.enumerated().compactMap { index, item in
            // Index, not the original filename: a picked name is untrusted
            // input (it can carry path separators) and is never shown here.
            let name = "\(index).bin"
            do {
                try item.bytes.write(to: dir.appendingPathComponent(name))
                return QueuedMedia(fileName: name, contentType: item.contentType)
            } catch {
                return nil
            }
        }
    }

    /// Nil when the file is gone — the caller must not send as if it were there.
    func readMedia(_ localId: String, _ item: QueuedMedia) -> Data? {
        try? Data(contentsOf: directory(for: localId).appendingPathComponent(item.fileName))
    }

    /// Delete photo files whose message is no longer queued.
    func pruneMedia() {
        let live = Set(all().map(\.localId))
        let dirs = try? FileManager.default.contentsOfDirectory(
            at: mediaRoot,
            includingPropertiesForKeys: nil
        )
        for dir in dirs ?? [] where !live.contains(dir.lastPathComponent) {
            try? FileManager.default.removeItem(at: dir)
        }
    }

    private func directory(for localId: String) -> URL {
        mediaRoot.appendingPathComponent(localId, isDirectory: true)
    }

    private func write(_ rows: [QueuedSend]) {
        guard let data = try? JSONEncoder().encode(rows) else { return }
        defaults.set(data, forKey: Self.storageKey)
    }
}

/// True once a row has waited longer than `outboxAgeOutHours`.
///
/// A createdAt we cannot parse is NEVER stale. Guessing "old" from an
/// unreadable timestamp would stop a message the person is still waiting on,
/// and of the two ways to be wrong that is the one that loses a delivery.
///
/// `.withInternetDateTime` alone rejects the fractional seconds our own rows
/// can carry, so both spellings are tried — a parse that silently fails here
/// would disable the age-out entirely and nothing would ever say so.
private func agedOut(_ item: QueuedSend, _ now: Date) -> Bool {
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let created = fractional.date(from: item.createdAt)
        ?? plain.date(from: item.createdAt)
    else { return false }
    return now.timeIntervalSince(created) > outboxAgeOutHours * 3600
}

/// The three answers a flush can get, which is the distinction #234 turns on.
enum SendOutcome: Equatable, Sendable {
    case sent
    /// The server answered no. Not retried automatically.
    case refused(String)
    /// We never got an answer. Stays queued.
    case unreachable(String)
}

/// What one flush attempt did, so the caller can refresh exactly what changed.
struct FlushResult: Equatable, Sendable {
    var sent: [String] = []
    var blocked: [String] = []
    var stillQueued: [String] = []
}

/// Drains the outbox. One at a time, in the order the person wrote them.
///
/// SERIAL, not parallel, and that is a product decision rather than a
/// simplification: these are messages to one customer, and delivering "on my
/// way" before "running 20 late" would be worse than delivering both slowly.
///
/// RE-ENTRANCY is the #234 flap requirement. An LTE/Wi-Fi handoff can fire two
/// connectivity callbacks within a second; both hop to the main actor, so they
/// cannot interleave mid-statement, but the second WOULD start a fresh pass
/// over the same rows while the first was awaiting its request. The flag is
/// what stops that. The idempotency key would still collapse the duplicates
/// server-side, but the client would show two rows and count two sends, and
/// "the key saves us" is not a reason to send twice.
@MainActor
final class OutboxFlusher {
    private let outbox: Outbox
    private let send: (QueuedSend) async -> SendOutcome
    /// Injected so the age-out is assertable without waiting a day.
    private let now: () -> Date
    private var isFlushing = false

    init(
        outbox: Outbox,
        now: @escaping () -> Date = { Date() },
        send: @escaping (QueuedSend) async -> SendOutcome
    ) {
        self.outbox = outbox
        self.now = now
        self.send = send
    }

    func flush() async -> FlushResult {
        if isFlushing { return FlushResult() }
        isFlushing = true
        defer { isFlushing = false }

        var result = FlushResult()
        for item in outbox.all().sorted(by: { $0.createdAt < $1.createdAt }) {
            // A blocked row waits for the person, never for the network.
            if item.blocked {
                result.blocked.append(item.localId)
                continue
            }
            // Old enough that sending it is a decision rather than a delivery.
            if !item.staleAcknowledged, agedOut(item, now()) {
                var stale = item
                stale.blocked = true
                stale.lastError = outboxStaleMessage
                outbox.put(stale)
                result.blocked.append(item.localId)
                continue
            }
            switch await send(item) {
            case .sent:
                outbox.remove(item.localId)
                result.sent.append(item.localId)
            case .refused(let message):
                // An answer. Stop retrying and let the row explain itself.
                var updated = item
                updated.attempts += 1
                updated.lastError = message
                updated.blocked = true
                outbox.put(updated)
                result.blocked.append(item.localId)
            case .unreachable(let message):
                var updated = item
                updated.attempts += 1
                updated.lastError = message
                outbox.put(updated)
                result.stillQueued.append(item.localId)
                // Stop the pass: the network is down for this one, so it is
                // down for the rest, and hammering it would only burn battery
                // in the exact place battery matters.
                return result
            }
        }
        return result
    }
}
