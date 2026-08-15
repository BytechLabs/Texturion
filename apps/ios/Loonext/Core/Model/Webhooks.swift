import Foundation

/// #243 — outbound webhook endpoints. Twin of the Android
/// `core/model/Webhooks.kt`.
///
/// The signing secret is not a property here, because it is not a field in any
/// list response. It arrives exactly twice in the product's whole life — when
/// an endpoint is created and when its key is rotated — and both of those
/// answer with `MintedWebhookSecret`, whose property is named `secret_once` so
/// a caller storing the response wholesale is at least storing something that
/// says what it is.
struct WebhookEndpoint: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let url: String
    var description: String?
    var events: [String] = []
    var active: Bool = true
    /// A catalogue KEY when WE turned it off, so this phone can translate it.
    var disabled_reason: String?
    var disabled_at: String?
    var consecutive_failures: Int = 0
    var last_success_at: String?
    var last_failure_at: String?
    var created_at: String?
}

struct WebhookEndpointList: Codable, Sendable {
    var endpoints: [WebhookEndpoint] = []
    var cap: Int = 0
}

/// What PATCH answers: the row as it now is, wrapped.
struct WebhookEndpointEnvelope: Codable, Sendable {
    let endpoint: WebhookEndpoint
}

struct MintedWebhookSecret: Codable, Sendable {
    let endpoint: WebhookEndpoint
    let secret_once: String
}

struct WebhookDelivery: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let event_type: String
    let status: String
    var attempts: Int = 0
    var response_status: Int?
    var created_at: String?
    var delivered_at: String?
}

struct WebhookDeliveryList: Codable, Sendable {
    var deliveries: [WebhookDelivery] = []
}

struct CreateWebhookEndpointBody: Codable, Sendable {
    let url: String
    let events: [String]
    var description: String?
}

struct UpdateWebhookEndpointBody: Codable, Sendable {
    var url: String?
    var events: [String]?
    var description: String?
    var active: Bool?
}

/// What the far end said about a test ping.
///
/// A refusal is a SUCCESSFUL test — the person pressed the button to find out,
/// and both answers are the button working — so the route answers 200 either
/// way and the difference is carried here.
struct WebhookTestResult: Codable, Sendable {
    let ok: Bool
    var status: Int?
    var reason: String?
}
