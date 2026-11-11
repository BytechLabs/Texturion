import Foundation
import Observation

/// #735: the Trash's wire rows, its calls, and the words of one row.
///
/// `GET /v1/trash` answers `{ data: [row], next_cursor }`. A row names its `kind`
/// and carries ONE object under that same key (`conversation`, `message`, `call`
/// or `voicemail`), so the four shapes decode into one details struct whose
/// fields are all optional: a kind the server adds later still decodes, and the
/// screen skips what it cannot restore.

struct TrashDetails: Codable, Sendable {
    var contact_name: String? = nil
    var contact_phone: String? = nil
    var message_count: Int? = nil
    var conversation_id: String? = nil
    var direction: String? = nil
    var snippet: String? = nil
    var outcome: String? = nil
    var started_at: String? = nil
    var has_voicemail: Bool? = nil
    var voicemail_seconds: Int? = nil
}

struct TrashRow: Codable, Sendable {
    let id: String
    let kind: String
    let deleted_at: String
    var deleted_by_user_id: String? = nil
    /// When the nightly purge erases it for good.
    let purge_after: String
    var conversation: TrashDetails? = nil
    var message: TrashDetails? = nil
    var call: TrashDetails? = nil
    var voicemail: TrashDetails? = nil

    /// A call and its voicemail share one id, so the id alone is not a key.
    var rowKey: String { "\(kind):\(id)" }

    /// The object under this row's own kind.
    var details: TrashDetails? {
        switch kind {
        case "conversation": return conversation
        case "message": return message
        case "call": return call
        case "voicemail": return voicemail
        default: return nil
        }
    }
}

struct TrashRepository: Sendable {
    let api: ApiClient

    func list(companyId: String, cursor: String? = nil, limit: Int = 50) async throws -> Page<TrashRow> {
        try await api.get(
            "/v1/trash",
            query: ["cursor": cursor, "limit": String(limit)],
            companyId: companyId
        )
    }

    /// Delete forever. 409 under a legal hold, with the server's sentence.
    func purge(companyId: String, kind: String, id: String) async throws {
        try await api.delete("/v1/trash/\(kind)/\(id)", companyId: companyId)
    }

    /// Display names for "deleted by"; the caller treats a failure as "someone".
    func members(companyId: String) async throws -> Page<Member> {
        try await api.get("/v1/members", query: ["limit": "100"], companyId: companyId)
    }
}

/// The words and arithmetic of one Trash row, pure so they unit-test without a view.
enum TrashText {
    private static let dayMs: Double = 24 * 60 * 60 * 1000

    /// Whole days until the purge, rounded up, and 0 when less than a day
    /// remains: "1 day left" must never mean "gone in an hour".
    static func daysLeft(purgeAfter: String, now: Date = Date()) -> Int {
        guard let at = parseWireTimestamp(purgeAfter) else { return 0 }
        let remaining = at.timeIntervalSince(now) * 1000
        if remaining < dayMs { return 0 }
        return Int((remaining / dayMs).rounded(.up))
    }

    static func daysLeftLabel(purgeAfter: String, locale: String?, now: Date = Date()) -> String {
        let days = daysLeft(purgeAfter: purgeAfter, now: now)
        if days == 0 { return AppStrings.translate(locale, "trash.daysLeftToday") }
        if days == 1 { return AppStrings.translate(locale, "trash.daysLeftOne") }
        return AppStrings.translate(locale, "trash.daysLeftMany", ["count": String(days)])
    }

    static func kindLabel(_ row: TrashRow, locale: String?) -> String {
        switch row.kind {
        case "conversation":
            return AppStrings.translate(locale, "trash.kindConversation")
        case "message":
            let note = row.details?.direction == MessageDirection.note
            return AppStrings.translate(locale, note ? "trash.kindNote" : "trash.kindMessage")
        case "call":
            return AppStrings.translate(locale, "trash.kindCall")
        default:
            return AppStrings.translate(locale, "trash.kindVoicemail")
        }
    }

    /// The customer, as a name when there is one and a number when there is not.
    static func whoLabel(_ row: TrashRow, locale: String?) -> String {
        let name = (row.details?.contact_name ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        if let phone = row.details?.contact_phone, !phone.isEmpty { return formatPhone(phone) }
        return AppStrings.translate(locale, "trash.unknownContact")
    }

    /// The second line: what is inside, in a few words.
    static func detailLabel(_ row: TrashRow, locale: String?) -> String {
        let details = row.details
        switch row.kind {
        case "conversation":
            let count = details?.message_count ?? 0
            let key = count == 1 ? "trash.messageCountOne" : "trash.messageCountMany"
            return AppStrings.translate(locale, key, ["count": String(count)])
        case "message":
            let snippet = (details?.snippet ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return snippet.isEmpty ? AppStrings.translate(locale, "trash.noSnippet") : snippet
        case "call":
            let outcome = details?.outcome
            let baseKey: String
            if outcome == CallOutcome.missed {
                baseKey = "trash.callOutcomeMissed"
            } else if outcome == CallOutcome.voicemail {
                baseKey = "trash.callOutcomeVoicemail"
            } else {
                baseKey = "trash.callOutcomeAnswered"
            }
            let base = AppStrings.translate(locale, baseKey)
            if details?.has_voicemail == true, outcome != CallOutcome.voicemail {
                return base + " · " + AppStrings.translate(locale, "trash.callWithVoicemail")
            }
            return base
        default:
            if let seconds = details?.voicemail_seconds, seconds > 0 {
                return AppStrings.translate(locale, "trash.voicemailLength", ["seconds": String(seconds)])
            }
            return AppStrings.translate(locale, "trash.kindVoicemail")
        }
    }

    /// "Deleted Sep 9, 3:42 PM by you · 29 days left".
    static func metaLine(
        _ row: TrashRow,
        locale: String?,
        meUserId: String,
        memberNames: [String: String],
        now: Date = Date()
    ) -> String {
        let when = TimestampFormat.label(row.deleted_at, style: .long, locale: locale, now: now)
        let deleted: String
        if let by = row.deleted_by_user_id {
            let who: String
            if by == meUserId {
                who = AppStrings.translate(locale, "trash.you")
            } else {
                who = memberNames[by] ?? AppStrings.translate(locale, "trash.someone")
            }
            deleted = AppStrings.translate(locale, "trash.deletedByLine", ["when": when, "who": who])
        } else {
            deleted = AppStrings.translate(locale, "trash.deletedByUnknown", ["when": when])
        }
        return deleted + " · " + daysLeftLabel(purgeAfter: row.purge_after, locale: locale, now: now)
    }

    /// "Conversation · Dana Whitcomb": what a row is, for the confirmation and for VoiceOver.
    static func subject(_ row: TrashRow, locale: String?) -> String {
        kindLabel(row, locale: locale) + " · " + whoLabel(row, locale: locale)
    }

    static func deleteForeverBody(_ row: TrashRow, locale: String?) -> String {
        AppStrings.translate(locale, "trash.deleteForeverBody", ["what": subject(row, locale: locale)])
    }

    /// Rows this build can act on. A kind added server-side later is hidden
    /// rather than shown with a Restore that cannot work.
    static func usable(_ rows: [TrashRow]) -> [TrashRow] {
        rows.filter { TrashKind(rawValue: $0.kind) != nil }
    }
}

/// State and mutations for the Trash screen.
@MainActor
@Observable
final class TrashModel {
    private let repo: TrashRepository
    private let deletion: RecordDeletionRepository
    private let companyId: String

    private(set) var state: LoadState<Void> = .loading
    private(set) var rows: [TrashRow] = []
    private(set) var nextCursor: String?
    private(set) var loadingMore = false
    private(set) var memberNames: [String: String] = [:]
    /// Row keys with a restore or a purge in flight, so a second tap cannot repeat it.
    private(set) var busy: Set<String> = []

    init(api: ApiClient, companyId: String) {
        self.repo = TrashRepository(api: api)
        self.deletion = RecordDeletionRepository(api: api)
        self.companyId = companyId
    }

    func prepareRetry() {
        state = .loading
    }

    func refresh() async {
        do {
            let page = try await repo.list(companyId: companyId)
            rows = TrashText.usable(page.data)
            nextCursor = page.next_cursor
            state = .ready(())
        } catch {
            // A quiet refetch failure keeps the list the person is looking at.
            if case .ready = state {
                // keep
            } else {
                state = .failed(error.userMessage)
            }
        }
        if memberNames.isEmpty, let page = try? await repo.members(companyId: companyId) {
            var names: [String: String] = [:]
            for member in page.data where !member.display_name.isEmpty {
                names[member.user_id] = member.display_name
            }
            memberNames = names
        }
    }

    func loadMore() async {
        guard let cursor = nextCursor, !loadingMore else { return }
        loadingMore = true
        defer { loadingMore = false }
        guard let page = try? await repo.list(companyId: companyId, cursor: cursor) else { return }
        let known = Set(rows.map { $0.rowKey })
        let fresh = TrashText.usable(page.data).filter { !known.contains($0.rowKey) }
        rows.append(contentsOf: fresh)
        nextCursor = page.next_cursor
    }

    /// Puts one item back. The returned sentence (nil when nothing was attempted) is the toast: the server's own
    /// words on a refusal ("Restore the conversation first").
    func restore(_ row: TrashRow, locale: String?) async -> String? {
        guard let kind = TrashKind(rawValue: row.kind), !busy.contains(row.rowKey) else {
            return nil
        }
        busy.insert(row.rowKey)
        defer { busy.remove(row.rowKey) }
        do {
            try await deletion.restore(companyId: companyId, kind: kind, id: row.id)
            rows.removeAll { $0.rowKey == row.rowKey }
            // Restoring a conversation also takes its calls out of the Trash.
            await refresh()
            return AppStrings.translate(locale, "trash.restored")
        } catch {
            return error.userMessage
        }
    }

    /// Deletes one item for good. The returned sentence (nil when nothing was attempted) is the toast.
    func purge(_ row: TrashRow, locale: String?) async -> String? {
        guard !busy.contains(row.rowKey) else { return nil }
        busy.insert(row.rowKey)
        defer { busy.remove(row.rowKey) }
        do {
            try await repo.purge(companyId: companyId, kind: row.kind, id: row.id)
            rows.removeAll { $0.rowKey == row.rowKey }
            return AppStrings.translate(locale, "trash.deletedForever")
        } catch {
            return error.userMessage
        }
    }
}
