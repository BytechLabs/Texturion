import Foundation

/// Pure push-payload logic (no UIKit/Firebase imports — unit-tested in
/// LoonextTests, mirroring the Android push/PushPayload.kt + its JVM tests).
///
/// The server push contract (apps/api/src/notifications — inbound.ts,
/// missed-call.ts, incoming-call.ts, fanned out natively via fcm.ts) is
/// `{title, body, url}` plus `kind: 'call'` for the 30s push-to-wake ring
/// (#135). On iOS the payload arrives as an APNs ALERT via FCM's bridge:
/// `aps {alert: {title, body}}` plus the same custom data keys
/// (`url`, `kind`, and `title`/`body` duplicated as data). Malformed payloads
/// still parse to a calm generic notice — a push is never silently dropped
/// (web sw.js parity).

/// Deep-link constants — the only origin push deep links may target.
enum PushLink {
    static let appOrigin = "https://app.loonext.com"
    /// Default deep link when a push carries no usable url.
    static let fallbackDeepLink = appOrigin + "/inbox"
}

/// Structural `kind` discriminator values. `call` is live today
/// (incoming-call.ts); `missed_call` is the discriminator the native sender
/// sets so missed calls carry their own category.
enum PushKind {
    static let call = "call"
    static let missedCall = "missed_call"
}

/// Category identifiers — the iOS analogue of the Android notification
/// channel ids (same constants, so the parse tests mirror 1:1). Remote alert
/// pushes are rendered by the system; these categorize parsed content for
/// foreground-presentation decisions and any locally posted notifications.
enum PushCategory {
    static let messages = "messages"
    static let missedCalls = "missed_calls"
    static let incomingCalls = "incoming_calls"
}

/// One parsed, display-ready push.
struct PushContent: Sendable, Equatable {
    /// Raw `kind` value, nil when absent — branch structurally, never on text.
    let kind: String?
    let title: String
    let body: String
    /// Normalized absolute deep link (always on `PushLink.appOrigin`).
    let url: String
    /// Coalescing tag: repeats for one thread/call replace, not stack (#149).
    /// On iOS remote pushes coalescing is server-side (apns-collapse-id);
    /// the tag still keys client-side handling.
    let tag: String
    /// Category this push belongs to (`PushCategory`).
    let category: String

    var isCall: Bool { kind == PushKind.call }

    /// `call` query param from the wake link (`/calls?call=<call_session_id>`).
    var callSessionId: String? { queryParam(url: url, name: "call") }
}

/// Parse a push data map into displayable content. Every field is optional on
/// the wire; missing/garbage input degrades to a generic notice in the
/// Messages category with the inbox fallback link.
func parsePush(_ data: [String: String]) -> PushContent {
    let kind = trimmedNonEmpty(data["kind"])
    let url = normalizeDeepLink(data["url"])
    let title = trimmedNonEmpty(data["title"])
    let body = data["body"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let tag = coalescingTag(kind: kind, normalizedUrl: url)

    if kind == PushKind.call {
        return PushContent(
            kind: kind,
            title: title ?? "Incoming call",
            body: body.isEmpty ? "Someone is calling your business number." : body,
            url: url,
            tag: tag,
            category: PushCategory.incomingCalls
        )
    }
    return PushContent(
        kind: kind,
        title: title ?? "Loonext",
        body: body.isEmpty ? "You have a new notification." : body,
        url: url,
        tag: tag,
        category: kind == PushKind.missedCall ? PushCategory.missedCalls : PushCategory.messages
    )
}

/// Normalize a push deep link (web sw.js + Android parity):
/// - relative paths resolve against `PushLink.appOrigin`
/// - legacy `/conversations/{id}` becomes `/inbox/{id}`
/// - query strings are preserved (the `/calls?call=…` wake link needs its param)
/// - foreign-origin or unparseable urls fall back to the inbox
func normalizeDeepLink(_ raw: String?) -> String {
    let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if trimmed.isEmpty { return PushLink.fallbackDeepLink }
    let absolute = trimmed.hasPrefix("/") ? PushLink.appOrigin + trimmed : trimmed
    guard let components = URLComponents(string: absolute),
          components.scheme == "https",
          components.host == "app.loonext.com"
    else { return PushLink.fallbackDeepLink }

    var path = components.percentEncodedPath
    if path.isEmpty { path = "/inbox" }
    // Legacy exactly-one-segment thread path → the current inbox shape.
    let legacyPrefix = "/conversations/"
    if path.hasPrefix(legacyPrefix) {
        let id = path.dropFirst(legacyPrefix.count)
        if !id.isEmpty, !id.contains("/") {
            path = "/inbox/\(id)"
        }
    }
    let query = components.percentEncodedQuery.map { "?\($0)" } ?? ""
    return PushLink.appOrigin + path + query
}

/// Derive the coalescing tag from a NORMALIZED url:
/// - calls tag per call SESSION (#149: two concurrent calls are two
///   notifications; repeats for one call replace each other)
/// - thread pushes tag per conversation (repeat texts in one thread coalesce)
/// - anything else tags per deep link
func coalescingTag(kind: String?, normalizedUrl: String) -> String {
    if kind == PushKind.call {
        if let session = queryParam(url: normalizedUrl, name: "call") {
            return "call:\(session)"
        }
        return "call:\(normalizedUrl)"
    }
    if let conversation = conversationId(fromNormalizedUrl: normalizedUrl) {
        return "conversation:\(conversation)"
    }
    return "notice:\(normalizedUrl)"
}

/// The `/inbox/{id}` segment of a normalized deep link, nil for non-thread
/// links. Used for tag coalescing and foreground-banner suppression when the
/// user is already viewing that thread.
func conversationId(fromNormalizedUrl url: String) -> String? {
    let prefix = PushLink.appOrigin + "/inbox/"
    guard url.hasPrefix(prefix) else { return nil }
    let id = url.dropFirst(prefix.count).prefix { $0 != "/" && $0 != "?" && $0 != "#" }
    return id.isEmpty ? nil : String(id)
}

/// First value of a query parameter, percent-decoded; nil when absent or
/// empty. (No `+`-as-space decoding — session ids never carry it.)
func queryParam(url: String, name: String) -> String? {
    guard let items = URLComponents(string: url)?.queryItems,
          let item = items.first(where: { $0.name == name }),
          let value = item.value,
          !value.isEmpty
    else { return nil }
    return value
}

// MARK: - Routing

/// A navigation request parsed from a notification tap / universal link —
/// the same URL shapes the Android MainActivity routes:
/// `https://app.loonext.com/inbox/{conversationId}` and
/// `https://app.loonext.com/calls?call={call_session_id}`.
enum PushRoute: Equatable, Sendable {
    case thread(conversationId: String)
    case calls(sessionId: String?)
}

/// Parse a (raw or normalized) push/universal-link URL into a route. Foreign
/// origins normalize to the inbox fallback, which routes nowhere — nil means
/// "open the app, no navigation".
func parsePushRoute(url: String) -> PushRoute? {
    let normalized = normalizeDeepLink(url)
    guard let components = URLComponents(string: normalized) else { return nil }
    let segments = components.percentEncodedPath.split(separator: "/").map(String.init)
    if segments.count >= 2, segments[0] == "inbox" || segments[0] == "conversations" {
        return .thread(conversationId: segments[1])
    }
    if segments.first == "calls" {
        return .calls(sessionId: queryParam(url: normalized, name: "call"))
    }
    return nil
}

// MARK: - APNs userInfo extraction

/// Flatten a notification's `userInfo` into the `[String: String]` data map
/// `parsePush` expects: string-valued custom keys pass through (`url`,
/// `kind`, and FCM's duplicated `title`/`body`); the `aps` dictionary and
/// other non-string values are dropped. `fallbackTitle`/`fallbackBody` (the
/// rendered `aps.alert` off UNNotificationContent) fill in only when the data
/// keys are absent — mirrors the Android notification-only fallback merge.
func pushData(
    fromUserInfo userInfo: [AnyHashable: Any],
    fallbackTitle: String = "",
    fallbackBody: String = ""
) -> [String: String] {
    var data: [String: String] = [:]
    for (key, value) in userInfo {
        if let key = key as? String, let value = value as? String {
            data[key] = value
        }
    }
    if data["title"] == nil, !fallbackTitle.isEmpty {
        data["title"] = fallbackTitle
    }
    if data["body"] == nil, !fallbackBody.isEmpty {
        data["body"] = fallbackBody
    }
    return data
}

private func trimmedNonEmpty(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
          !trimmed.isEmpty
    else { return nil }
    return trimmed
}
