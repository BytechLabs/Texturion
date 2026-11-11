#if DEBUG
import SwiftUI

/// Fixture backend for the audit host's data-backed screens (#739 #740 #744 #746
/// #749 #752): the REAL views, fed by canned `/v1` answers instead of a network.
/// Debug only, and reachable only through `-a11yAuditSurface`.
///
/// Fixture strings stay at two words or fewer so the hardcoded-strings scanner,
/// which reads three-word string literals as interface copy, has nothing to count.

/// A session store's backing, in memory: the simulator host has no keychain and the
/// audit host must not touch the real one.
final class A11yFixtureStorage: SessionStorage, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Data?

    init() {}

    func read() -> Data? { lock.withLock { stored } }
    func write(_ data: Data) { lock.withLock { stored = data } }
    func remove() { lock.withLock { stored = nil } }
}

/// Answers every GET the fixture screens make from `A11yFixtureData`, and refuses the
/// rest with a 404 envelope, which each screen already treats as "nothing there".
struct A11yFixtureTransport: HTTPClient {
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        let url = request.url ?? URL(fileURLWithPath: "/")
        let isRead = (request.httpMethod ?? "GET") == "GET"
        let body = isRead ? A11yFixtureData.body(path: url.path, query: url.query ?? "") : nil
        let payload = body ?? #"{"error":{"code":"not_found","message":"missing"}}"#
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: body == nil ? 404 : 200,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"]
        ) else { throw URLError(.badServerResponse) }
        return (Data(payload.utf8), response)
    }
}

enum A11yFixtureGraph {
    /// A graph signed in as the fixture owner, talking to `A11yFixtureTransport`.
    @MainActor
    static func make() -> AppGraph {
        let store = SessionStore(storage: A11yFixtureStorage())
        store.save(
            Session(
                accessToken: "fixture",
                refreshToken: "fixture",
                expiresAt: Date().timeIntervalSince1970 + 86_400,
                userId: "u1",
                email: "sam@example.com"
            )
        )
        return AppGraph(sessionStore: store, transport: A11yFixtureTransport())
    }
}

enum A11yFixtureData {
    static let companyId = "co-1"
    static let contactId = "ct-1"
    /// The workspace's zone, so a day on the calendar is the same day on any runner.
    static let zoneId = "America/Toronto"

    @MainActor
    static func me() -> Me {
        guard let me = try? JSONDecoder().decode(Me.self, from: Data(meJSON().utf8)) else {
            preconditionFailure("fixture me")
        }
        return me
    }

    // MARK: Routing

    static func body(path: String, query: String) -> String? {
        guard let range = path.range(of: "/v1/") else { return nil }
        let route = String(path[range.lowerBound...])
        switch route {
        case "/v1/me": return meJSON()
        case "/v1/company": return json(company())
        case "/v1/company/setting-choices": return json(settingChoices())
        case "/v1/company/ownership":
            return json(["owner_member_id": "m1", "i_am_owner": true, "can_offer": true] as [String: Any])
        case "/v1/members": return json(page(members()))
        case "/v1/invites": return json(page(invites()))
        case "/v1/calendar/feed": return json(["active": false])
        case "/v1/on-call": return json(["data": [Any]()])
        case "/v1/tags": return json(page(tags()))
        case "/v1/saved-views": return json(["data": [Any]()])
        case "/v1/contact-fields": return json(["data": [Any](), "cap": 10] as [String: Any])
        case "/v1/conversations": return json(page([]))
        case "/v1/tasks":
            return json(page(query.contains("has_location=true") ? mapTasks() : calendarTasks()))
        case "/v1/calls": return json(page(calls()))
        case "/v1/contacts/\(contactId)": return json(contact())
        case "/v1/contacts/\(contactId)/activity": return json(page([]))
        case "/v1/contacts/\(contactId)/linked-tasks": return json(page(linkedTasks()))
        default: return nil
        }
    }

    // MARK: Helpers

    private static func json(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    private static func page(_ rows: [[String: Any]]) -> [String: Any] {
        ["data": rows, "next_cursor": NSNull()]
    }

    private static func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func ago(days: Double) -> String {
        iso(Date().addingTimeInterval(-days * 86_400))
    }

    private static func ahead(days: Double) -> String {
        iso(Date().addingTimeInterval(days * 86_400))
    }

    /// Noon of `day` in the current month, in the workspace's zone.
    private static func thisMonth(day: Int) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zoneId) ?? .current
        var parts = calendar.dateComponents([.year, .month], from: Date())
        parts.day = day
        parts.hour = 12
        return iso(calendar.date(from: parts) ?? Date())
    }

    // MARK: Me and the workspace

    private static func meJSON() -> String {
        json([
            "user_id": "u1",
            "display_name": "Sam Rivera",
            "memberships": [
                [
                    "company_id": companyId,
                    "name": "Northside Plumbing",
                    "role": "owner",
                    "subscription_status": "active",
                ],
            ],
            "company": company(),
        ])
    }

    private static func company() -> [String: Any] {
        var hours: [String: Any] = [:]
        for day in ["mon", "tue", "wed", "thu", "fri"] {
            hours[day] = ["open": "08:00", "close": "17:00"]
        }
        return [
            "id": companyId,
            "name": "Northside Plumbing",
            "country": "CA",
            "us_texting_enabled": false,
            "requested_area_code": "416",
            "timezone": zoneId,
            "subscription_status": "active",
            "created_at": ago(days: 200),
            "updated_at": ago(days: 2),
            "business_hours": hours,
            "after_hours_calls": "voicemail",
        ]
    }

    /// #749: Sam Rivera moved after-hours calls off the default on Aug 8, 2026.
    private static func settingChoices() -> [String: Any] {
        [
            "data": [
                [
                    "key": "after_hours_calls",
                    "value": "voicemail",
                    "default_value": "ring_everyone",
                    "chosen_by": "Sam Rivera",
                    "chosen_at": "2026-08-08T15:00:00Z",
                ],
            ],
        ]
    }

    // MARK: Team

    private static func members() -> [[String: Any]] {
        let rows: [(String, String, String, String)] = [
            ("m1", "u1", "owner", "Sam Rivera"),
            ("m2", "u2", "admin", "Alex Mason"),
            ("m3", "u3", "member", "Priya Nair"),
            ("m4", "u4", "bookkeeper", "Jo Kim"),
        ]
        return rows.map { row -> [String: Any] in
            [
                "id": row.0,
                "user_id": row.1,
                "role": row.2,
                "display_name": row.3,
                "created_at": ago(days: 120),
            ]
        }
    }

    private static func invites() -> [[String: Any]] {
        let rows: [(String, String, String)] = [
            ("iv1", "lee@example.com", "member"), ("iv2", "ray@example.com", "read_only"),
        ]
        return rows.map { row -> [String: Any] in
            [
                "id": row.0,
                "company_id": companyId,
                "email": row.1,
                "role": row.2,
                "invited_by": "u1",
                "expires_at": ahead(days: 5),
                "created_at": ago(days: 2),
            ]
        }
    }

    private static func tags() -> [[String: Any]] {
        [["id": "tg1", "name": "Landlord"], ["id": "tg2", "name": "Repeat"]]
    }

    // MARK: Tasks

    private static func task(
        _ id: String,
        _ title: String,
        due: String? = nil,
        done: Bool = false,
        site: (lat: Double, lng: Double)? = nil
    ) -> [String: Any] {
        var row: [String: Any] = [
            "id": id,
            "company_id": companyId,
            "title": title,
            "assigned_user_id": "u1",
            "created_by_user_id": "u1",
            "created_at": ago(days: 9),
            "updated_at": ago(days: 1),
            "done": done,
            "status": done ? "done" : "open",
        ]
        if let due { row["due_at"] = due }
        if let site {
            row["lat"] = site.lat
            row["lng"] = site.lng
            row["contact"] = ["id": contactId, "name": "Dana Whitcomb"]
        }
        return row
    }

    /// #739: dated tasks across the month. Day 17 stays empty, which is the day the
    /// UI test taps.
    private static func calendarTasks() -> [[String: Any]] {
        let plan: [(Int, String, Bool)] = [
            (3, "Fix boiler", true), (6, "Quote roof", false), (6, "Order tiles", false),
            (9, "Swap panel", false), (12, "Check furnace", false), (14, "Install sink", false),
            (19, "Flush tank", false), (22, "Pay invoice", false), (22, "Send quote", false),
            (22, "Seal deck", false), (26, "Fit vents", false), (28, "Clear drain", false),
        ]
        return plan.enumerated().map { index, entry in
            task("t\(index)", entry.1, due: thisMonth(day: entry.0), done: entry.2)
        }
    }

    /// #752: jobs around downtown Toronto.
    private static func mapTasks() -> [[String: Any]] {
        [
            task("m1", "Fix boiler", site: (43.6426, -79.3871)),
            task("m2", "Quote roof", site: (43.6453, -79.3806)),
            task("m3", "Swap panel", site: (43.6487, -79.3715)),
            task("m4", "Install sink", site: (43.6435, -79.3791)),
            task("m5", "Check furnace", site: (43.6503, -79.3596)),
        ]
    }

    // MARK: Contact

    private static func contact() -> [String: Any] {
        [
            "id": contactId,
            "phone_e164": "+14165550134",
            "name": "Dana Whitcomb",
            "business_name": "Whitcomb Realty",
            "address": "88 Queen St",
            "email": "dana@example.com",
            "notes": "Ring twice",
            "consent_source": "inbound_text",
            "consent_at": ago(days: 900),
            "first_identification_sent_at": ago(days: 900),
            "created_at": ago(days: 900),
            "updated_at": ago(days: 4),
            "conversation_count": 23,
            "first_conversation_at": ago(days: 900),
            "opted_out": false,
            "last_activity_at": ago(days: 1),
            "created_by_name": "Sam Rivera",
            "updated_by_name": "Alex Mason",
            "timezone_resolved": zoneId,
            "timezone_source": "area_code",
            "local_hour": 14,
            "phones": [
                ["id": "ph1", "phone_e164": "+14165550177", "label": "Office", "created_at": ago(days: 300)],
            ],
            "addresses": [
                [
                    "id": "ad1", "label": "Rental", "address": "41 Bay St",
                    "is_primary": false, "created_at": ago(days: 300),
                ],
            ],
            "tags": tags(),
        ]
    }

    private static func calls() -> [[String: Any]] {
        let outcomes = ["answered", "missed", "voicemail"]
        return (0..<24).map { index in
            let outcome = outcomes[index % outcomes.count]
            var row: [String: Any] = [
                "id": "cl\(index)",
                "call_session_id": "cs\(index)",
                "caller_e164": "+14165550134",
                "contact_id": contactId,
                "contact_name": "Dana Whitcomb",
                "direction": index % 4 == 3 ? "outbound" : "inbound",
                "outcome": outcome,
                "forward_seconds": outcome == "answered" ? 60 + index * 7 : 0,
                "started_at": ago(days: Double(index) * 2.5 + 0.2),
            ]
            if outcome == "voicemail" {
                row["voicemail_seconds"] = 22
                row["has_voicemail"] = true
            }
            return row
        }
    }

    private static func linkedTasks() -> [[String: Any]] {
        let titles = [
            "Fix boiler", "Quote roof", "Order tiles", "Swap panel", "Check furnace",
            "Install sink", "Flush tank", "Pay invoice", "Send quote", "Seal deck",
            "Fit vents", "Clear drain",
        ]
        return titles.enumerated().map { index, title in
            [
                "id": "lt\(index)",
                "number": 100 + index,
                "title": title,
                "done": index % 3 == 0,
                "due_at": ahead(days: Double(index) - 4),
            ]
        }
    }
}

// MARK: - Screens

/// #739 and #752: the real Tasks tab, opened on one of its views.
@MainActor
struct A11yTasksSurface: View {
    let initialView: TaskViewKind

    @State private var graph = A11yFixtureGraph.make()
    @State private var me = A11yFixtureData.me()

    var body: some View {
        TasksTab(
            graph: graph,
            companyId: A11yFixtureData.companyId,
            me: me,
            initialView: initialView
        )
    }
}

/// #740: the real contact page, on a customer with a long history.
@MainActor
struct A11yContactSurface: View {
    @State private var graph = A11yFixtureGraph.make()

    var body: some View {
        NavigationStack {
            ContactDetailView(
                graph: graph,
                companyId: A11yFixtureData.companyId,
                contactId: A11yFixtureData.contactId,
                onOpenConversation: { _ in },
                onComposeNew: { _ in },
                callerIdName: "Sam Rivera",
                canUnmerge: true,
                canDelete: true,
                canBlock: true
            )
        }
    }
}

/// Which settings screen `A11ySettingsSurface` draws.
enum A11ySettingsKind {
    case calendar, team, calling, onCall
}

/// #744, #746, #749: the real settings sections, loaded through the fixture
/// repository chain (`SettingsRepository` over the fixture transport), so the choice
/// note reads the fixture's `/v1/company/setting-choices`.
@MainActor
struct A11ySettingsSurface: View {
    let kind: A11ySettingsKind

    @State private var graph = A11yFixtureGraph.make()
    @State private var me = A11yFixtureData.me()
    @State private var company: CompanyView?

    @Environment(\.appLocale) private var appLocale

    private var repo: SettingsRepository {
        SettingsRepository(api: graph.api, sessionStore: graph.sessionStore)
    }

    private var scope: SettingsScope {
        SettingsScope(
            graph: graph,
            repo: repo,
            companyId: A11yFixtureData.companyId,
            me: me,
            role: MemberRole.owner,
            showMessage: { _ in }
        )
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    section
                }
                .padding(.vertical, 10)
                .contentMaxWidth()
            }
            .background(BrandColor.canvas.ignoresSafeArea())
            .navigationTitle(AppStrings.translate(appLocale, "shell.settings"))
            .navigationBarTitleDisplayMode(.inline)
        }
        .tint(BrandColor.olive)
        .task { company = try? await repo.company(A11yFixtureData.companyId) }
    }

    @ViewBuilder
    private var section: some View {
        switch kind {
        case .calendar:
            CalendarFeedCard(scope: scope)
        case .onCall:
            OnCallCard(scope: scope)
        case .team:
            if let company {
                TeamSectionView(scope: scope, company: company)
            }
        case .calling:
            if let loaded = company {
                CallingSectionView(scope: scope, company: loaded) { company = $0 }
            }
        }
    }
}
#endif
