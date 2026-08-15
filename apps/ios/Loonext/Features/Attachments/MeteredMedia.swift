import Foundation
import Network

/**
 #289 — "download photos on Wi-Fi only, at minimum".

 Hand-ported from packages/shared/src/metered-media.ts and covered by the same
 vectors.

 ---------------------------------------------------------------------------
 WHY THIS IS NOT AN ON/OFF SWITCH FOR PHOTOS.

 The obvious reading is "when this is on and I am on mobile data, do not
 download photos". Building that would make the app look broken on a job site: a
 thread of grey rectangles is not a thread, and a tech who turned the setting on
 last month has no idea why today's photos will not load.

 #240 changed what the choice can be. A thread and a gallery now fetch a bounded
 PREVIEW — a 1600px JPEG, 150-250 KB — and the ORIGINAL is fetched only when
 somebody opens a photo full-size or downloads it. The setting follows that line
 rather than cutting across it: the preview always loads, and the original waits
 for a tap on metered data.
 */
enum MeteredMedia {

    /// What the device says about the connection it is on.
    enum Connection { case unmetered, metered, unknown }

    /**
     The system's own answer, which is the only one worth having.

     `isExpensive` is what iOS reports for cellular AND for a personal hotspot —
     including somebody else's phone, which is exactly the case a tradesperson
     would want covered and the one a "is it cellular?" check would miss.

     A path that has not settled yet reads as `unknown`, which is treated as
     unmetered downstream: a photo that never loads with no explanation is a
     worse failure than a byte spent early.
     */
    static func connection(from path: NWPath?) -> Connection {
        guard let path, path.status == .satisfied else { return .unknown }
        return path.isExpensive || path.isConstrained ? .metered : .unmetered
    }

    /// May this fetch go ahead right now?
    static func mayFetch(
        variant: String,
        connection: Connection,
        wifiOnlyOriginals: Bool,
        requested: Bool
    ) -> Bool {
        // The preview IS the thread. Always allowed, on any connection, with
        // the setting on or off.
        if variant != "original" { return true }
        if !wifiOnlyOriginals { return true }
        if connection != .metered { return true }
        return requested
    }

    /**
     The sentence shown in place of a full-size photo waiting for a tap.

     Says the CONDITION and the REMEDY in one line, because the alternative — a
     spinner that never resolves, or a generic "couldn't load" — is how a
     deliberate setting gets reported as a bug.
     */
    /// #228 — catalogue KEYS, said at the call site. Android has resolved
    /// these three from the same keys since its own pass.
    static let meteredHint = "shell.meteredHint"

    static let settingLabel = "shell.wifiOnlyLabel"
    static let settingDescription = "shell.wifiOnlyDescription"
}

/**
 The live connection, as one process-wide observation.

 `NWPathMonitor` is a system resource with a real cost to start and stop, and
 the answer is the same for every screen — so it is started once and read, rather
 than spun up per photo.
 */
@MainActor
@Observable
final class ConnectionWatch {
    static let shared = ConnectionWatch()

    private(set) var connection: MeteredMedia.Connection = .unknown

    @ObservationIgnored private let monitor = NWPathMonitor()
    @ObservationIgnored private var started = false

    /// Idempotent: the shell calls it on every appearance.
    func start() {
        guard !started else { return }
        started = true
        monitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                self?.connection = MeteredMedia.connection(from: path)
            }
        }
        monitor.start(queue: .global(qos: .utility))
    }
}
