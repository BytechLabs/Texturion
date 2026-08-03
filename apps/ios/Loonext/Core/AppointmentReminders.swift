import Foundation

/// #237 — appointment reminders, as this phone understands them.
///
/// A hand-port of the parts of packages/shared/src/appointment-reminders.ts a
/// SETTINGS screen needs: the cap, the offsets on offer, and how an offset is
/// said out loud. Mirrored again in
/// android/core/reminders/AppointmentReminders.kt.
///
/// The reminder bodies themselves are not here — they are the workspace's own
/// words rather than the product's, and the two suggestions arrive with the
/// rules from the API.
///
/// The confirmation vocabulary is deliberately absent too: which replies count
/// as a yes is decided on the SERVER, at the moment an inbound message arrives,
/// and a phone that also held an opinion about it would be a second answer to a
/// question only one side gets to answer.
enum AppointmentReminders {
    /// How many rules one workspace may hold. Mirrors `REMINDER_RULES_CAP` and
    /// the SQL cap.
    ///
    /// Two, not five: a crew that texts a customer five times before arriving
    /// is a crew whose customers stop reading their texts, and that cost lands
    /// on the next message that actually matters.
    static let rulesCap = 2

    /// The offsets an owner may pick between, furthest out first.
    ///
    /// A fixed list rather than a free number field. "How many minutes before?"
    /// is a question nobody in a van wants to answer, and the two that matter
    /// are already the industry's — the day before, so the customer can still
    /// move it, and a couple of hours out, so somebody is home.
    static let offsetChoices = [2880, 1440, 240, 120, 60]

    /// "The day before", "2 hours before" — the offset, said the way a person
    /// would.
    static func offsetLabel(_ minutes: Int) -> String {
        if minutes % 1440 == 0 {
            let days = minutes / 1440
            return days == 1 ? "The day before" : "\(days) days before"
        }
        if minutes % 60 == 0 {
            let hours = minutes / 60
            return hours == 1 ? "1 hour before" : "\(hours) hours before"
        }
        return "\(minutes) minutes before"
    }
}
