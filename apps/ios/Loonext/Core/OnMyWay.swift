import Foundation

/// #520 — "on my way, about 20 minutes", sent while walking to the van.
///
/// A hand-port of `packages/shared/src/on-my-way.ts`, mirrored again in
/// android/core/compose/OnMyWay.kt. `on-my-way-parity.test.ts` keeps the
/// sentence the same on all three, because three clients writing their own
/// "on my way" is three products.
///
/// THE TWO DECISIONS #520 ASKS FOR, MADE:
///
/// 1. The ETA comes from PRESETS, not typing and not location. Typing is slow
///    in the one moment this exists to be fast in, and deriving it from
///    distance would need a location permission for a background-ish purpose —
///    a privacy ask this product has not made — in exchange for a number the
///    tech already knows better than a straight line does. They are the one
///    holding the traffic.
///
/// 2. It writes NOTHING to the job. The text is evidence of what somebody SAID,
///    not of where the van is, and a status fed by a message goes stale the
///    moment the tech is diverted and says so in words instead of tapping
///    again. The message is in the thread and the thread is attached to the
///    job; that is the record.
enum OnMyWay {
    /// The choices, in minutes.
    ///
    /// Four, not eight. This is a control somebody uses one-handed with a
    /// toolbox in the other, and the difference between 20 and 25 minutes is
    /// not a promise anybody can keep — which is why the sentence says "about".
    static let presets = [10, 20, 30, 45]

    /// What the customer reads.
    ///
    /// "About" is doing real work: a tech who says 20 and arrives at 28 has not
    /// broken a promise. An exact arrival time is a claim about traffic nobody
    /// can make from a van.
    /// The body, per language — a hand-port of the `onMyWay` field in
    /// `packages/shared/src/locale.ts`.
    ///
    /// Here rather than in the string catalogue, and that distinction is the
    /// whole point: every other string on this screen is read by the CREW and
    /// resolves against the app locale. This one is read by the CUSTOMER and
    /// resolves against theirs.
    ///
    /// Fully ASCII, so the GSM-7 constraint the shared file documents is not
    /// even in question for this one.
    private static let bodies = [
        MessageLocale.en: "On my way - about {minutes} minutes.",
        MessageLocale.frCA: "En route - environ {minutes} minutes.",
    ]

    /// The body for a customer, given the two locales that decide it.
    static func bodyFor(contact: String?, company: String?) -> String {
        bodies[MessageLocale.resolve(contact: contact, company: company)]
            ?? bodies[MessageLocale.en]!
    }

    /// #228 — the template is a parameter, defaulted to the English.
    ///
    /// The default is right here and nowhere else in this conversion: a caller
    /// that has not been taught about the contact's language sends what it
    /// always sent, rather than failing. This is the control somebody taps
    /// one-handed walking to a van; a translation gap must not become an
    /// outage on it.
    static func text(_ minutes: Int, template: String? = nil) -> String {
        (template ?? bodies[MessageLocale.en]!)
            .replacingOccurrences(of: "{minutes}", with: String(minutes))
    }

    /// The label on the choice, which is shorter than the sentence it sends.
    static func presetLabel(_ minutes: Int) -> String { "\(minutes) min" }

    /// What the clients call it, in one place.
    enum Copy {
        /// Not "ETA" — that is a word for dispatchers, not for a crew.
        static let action = "domain.onMyWayAction"

        /// Shown while choosing, so the tap that sends is not a surprise.
        /// Somebody expecting a picker and getting a sent message has texted a
        /// customer by accident.
        static let prompt = "domain.onMyWayPrompt"

        /// Said once, where the choice is made. The gates can still refuse this
        /// — an opt-out is binding however fast the send is meant to be — and a
        /// refusal with no warning reads as the button being broken.
        static let gatedNote = "domain.onMyWayGatedNote"
    }
}
