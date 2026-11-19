import Foundation

struct ScheduleDecision: Decodable, Sendable, Identifiable {
    struct Job: Decodable, Sendable {
        let id: String
        let title: String
        let due_at: String?
    }

    struct Connection: Decodable, Sendable {
        let provider: String
        let time_zone: String
    }

    struct Snapshot: Decodable, Sendable {
        let title: String
        let start: String
        let end: String
        let time_zone: String
    }

    struct Refusal: Decodable, Sendable {
        let code: String
    }

    let id: String
    let state: String
    let provider_condition: String
    let allowed_actions: [String]
    let task: Job
    let connection: Connection
    let ours: Snapshot?
    let theirs: Snapshot?
    let refusal: Refusal?

    var timeZone: TimeZone? {
        TimeZone(identifier: ours?.time_zone ?? theirs?.time_zone ?? connection.time_zone)
    }
}

struct ScheduleDecisionsResponse: Decodable, Sendable {
    let attention: [ScheduleDecision]
}

struct ScheduleDecisionRequest: Encodable, Sendable {
    let action: String
    var new_due_at: String?
}

struct ScheduleDecisionResult: Decodable, Sendable {
    let outcome: String
}
