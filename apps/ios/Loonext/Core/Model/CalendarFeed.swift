import Foundation

/// #245 — your own schedule feed. The shapes `/v1/calendar/feed` speaks.
///
/// There is no identifier anywhere in this file, and that is the API's design
/// rather than an omission here: every route acts on the CALLER's own feed and
/// there is none that reads, rotates or revokes somebody else's. The URL is a
/// bearer token that gets pasted into third-party apps, so handing one person
/// another person's would be a different feature with a different consent
/// question. See apps/api/src/routes/calendar.ts.

/// What GET answers. Never the URL — only its hash is stored.
struct CalendarFeedStatus: Codable, Sendable {
    let active: Bool
    /// Absent entirely when `active` is false, which is why both of these are
    /// optional rather than defaulted: the inactive payload is `{"active":false}`
    /// and nothing else.
    var created_at: String?
    /// When a calendar app last polled it. Null until something has — the
    /// difference between "set up" and "finished setting up".
    var last_read_at: String?
}

/// The 201 from POST, and the ONLY response in the product that carries the
/// URL. There is no property for it anywhere else because there is no other
/// moment it exists outside the member's own clipboard.
struct MintedCalendarFeed: Codable, Sendable {
    let url: String
}

/// The 200 from DELETE. `false` means there was nothing live to switch off,
/// which the route treats as the same outcome the caller wanted rather than as
/// an error — so the screen does too.
struct CalendarFeedRevoked: Codable, Sendable {
    let revoked: Bool
}
