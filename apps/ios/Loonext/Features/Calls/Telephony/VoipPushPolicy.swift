import Foundation

@MainActor
struct VoipPushPolicy {
    struct Incoming {
        let metadata: [String: Any]
        let uuid: UUID
        let displayName: String
        let number: String

        var id: String { uuid.uuidString.lowercased() }
    }

    enum Wake: Equatable {
        case failed
        case connect(companyId: String)
    }

    enum Watchdog: Equatable {
        case inviteArrived
        case answeredElsewhere
    }

    private static let inviteTimeout: Duration = .seconds(20)
    private let sleep: @MainActor (Duration) async -> Void

    init(sleep: @escaping @MainActor (Duration) async -> Void = { duration in
        try? await Task.sleep(for: duration)
    }) {
        self.sleep = sleep
    }

    func incoming(
        _ payload: [AnyHashable: Any],
        workspaceNumbers: Set<String>?,
        locale: String,
        makeUUID: () -> UUID = { UUID() }
    ) -> Incoming {
        let metadata = Self.parseMetadata(payload["metadata"])
        let number = (metadata["caller_number"] as? String)
            ?? (metadata["caller_id_number"] as? String)
            ?? ""
        let rawName = (metadata["caller_name"] as? String)
            ?? (metadata["caller_id_name"] as? String)
            ?? ""
        let identity = pushedCallerIdentity(
            number: number, name: rawName, workspaceNumbers: workspaceNumbers, locale: locale
        )
        return Incoming(
            metadata: metadata,
            uuid: (metadata["call_id"] as? String).flatMap(UUID.init(uuidString:)) ?? makeUUID(),
            displayName: identity.name,
            number: identity.number
        )
    }

    func wake(activeCompanyId: String?, lastCompanyId: String?) -> Wake {
        guard let company = activeCompanyId ?? lastCompanyId else { return .failed }
        return .connect(companyId: company)
    }

    func afterWatchdog(hasInvite: @MainActor () -> Bool) async -> Watchdog {
        await sleep(Self.inviteTimeout)
        return hasInvite() ? .inviteArrived : .answeredElsewhere
    }

    private static func parseMetadata(_ value: Any?) -> [String: Any] {
        if let dict = value as? [String: Any] { return dict }
        if let text = value as? String,
           let data = text.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return parsed
        }
        return [:]
    }
}
