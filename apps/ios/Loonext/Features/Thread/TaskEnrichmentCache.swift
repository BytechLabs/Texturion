import Foundation

/// #214 — the one-enrich-per-(company, message)-per-session cache, the Swift
/// twin of the module-level `Map` in apps/web/src/lib/api/task-enrichment.ts.
/// The founder's "local caching for the session": if a teammate opens the
/// make-task sheet for a message, gets an enrichment, cancels, then reopens the
/// SAME message, reuse the result instead of spending another AI call. An
/// actor singleton so it survives view teardown within the session; in-memory
/// only (cleared on app relaunch).
actor TaskEnrichmentCache {
    static let shared = TaskEnrichmentCache()

    private var entries: [String: TaskEnrichment] = [:]

    private func key(_ companyId: String, _ messageId: String) -> String {
        "\(companyId):\(messageId)"
    }

    func cached(companyId: String, messageId: String) -> TaskEnrichment? {
        entries[key(companyId, messageId)]
    }

    func store(_ enrichment: TaskEnrichment, companyId: String, messageId: String) {
        entries[key(companyId, messageId)] = enrichment
    }
}
