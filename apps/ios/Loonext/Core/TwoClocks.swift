import Foundation

/// #539 — a time on this screen must say whose clock it is on.
///
/// The hand-port of `packages/shared/src/two-clocks.ts`, and the third copy after
/// `core/time/TwoClocks.kt`.
///
/// ## The bug this closes
///
/// A queued message showed "Tue, 8:00 AM", formatted in the CUSTOMER's zone
/// because that is the time whoever scheduled it picked. Nothing said so. A
/// dispatcher in Toronto reading a send queued for a customer in Vancouver saw
/// "8:00 AM", read their own clock, and was three hours out — with nothing on the
/// screen to argue with. The string is correct and the reader is wrong, which is
/// the worst kind of label.
///
/// ## The rule
///
/// One instant, two wall clocks. Say both — but ONLY when they differ, because a
/// crew whose customers are all in town would otherwise read
/// "8:00 AM their time · 8:00 AM yours" on every row forever, and a label that is
/// noise on the ordinary day is one people stop reading before the day it matters.
///
/// ## Why "differ" is decided on the rendered clock, not the zone identifier
///
/// `America/Toronto` and `America/New_York` are two names for one clock. Deciding
/// by identifier would put the label on every row of a workspace that texts across
/// a state line into the same hour. Comparing what a reader would READ is also
/// correct across DST on its own, with no offset arithmetic — and right for the
/// half-hour zones, where an hours-apart number is wrong every day rather than
/// twice a year.
///
/// ## The split with the formatter
///
/// This owns the RULE and the WORDS. Turning an instant into a wall clock stays
/// with `DateFormatter`, because a date rendered by hand in three languages is
/// three chances to disagree about a locale.
enum TwoClocks {

    /// What the destination's clock is called, in the product's voice.
    static let there = "their time"

    /// ...and the reader's own. Not "my time": the screen is talking TO them.
    static let here = "yours"

    /// Are these two rendered wall clocks the same moment on the same clock face?
    ///
    /// Takes the FORMATTED strings rather than the zones, so the comparison is
    /// whatever the caller is about to put on the screen. Trimmed first, because a
    /// formatter that pads one zone differently from another would otherwise force
    /// the label on for a difference nobody can see.
    static func sameClock(_ a: String, _ b: String) -> Bool {
        a.trimmingCharacters(in: .whitespacesAndNewlines)
            == b.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The line to show for one instant.
    ///
    /// `mine` may be nil when the caller already knows the reader's clock is not
    /// worth naming. Passing the same string twice is the same as passing nil,
    /// which is what makes this safe to call unconditionally from a body.
    ///
    /// The separator is a middot rather than a bracket or a slash: it reads as one
    /// line of two facts, which is what it is, and it survives a narrow row without
    /// looking like a truncation.
    static func bothClocks(_ theirs: String, _ mine: String? = nil) -> String {
        let t = theirs.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let mine, !sameClock(t, mine) else { return t }
        return "\(t) \(there) · \(mine.trimmingCharacters(in: .whitespacesAndNewlines)) \(here)"
    }

    /// The same two facts spelled out, for VoiceOver.
    ///
    /// A middot is announced as "middle dot" or skipped entirely depending on the
    /// reader, and "8:00 AM their time middle dot 11:00 AM yours" is not a
    /// sentence.
    static func bothClocksSpoken(_ theirs: String, _ mine: String? = nil) -> String {
        let t = theirs.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let mine, !sameClock(t, mine) else { return t }
        let m = mine.trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(t) \(there), which is \(m) \(here)"
    }

    /// Which clock a typed time is being read in — the switch #539 asks for
    /// ("why cant i choose? let me switch?").
    ///
    /// Two values, not a zone picker. The question a sender actually has is "did I
    /// mean 8am here or 8am there", and offering 400 IANA zones to answer it would
    /// be a worse version of the same confusion.
    enum Choice: String, CaseIterable, Identifiable {
        case theirs
        case yours

        var id: String { rawValue }

        var label: String {
            switch self {
            case .theirs: return "Their time"
            case .yours: return "Your time"
            }
        }
    }

    /// The default side for a typed time, and why it is the reader's own.
    ///
    /// A native date-and-time picker reads and writes the DEVICE's zone. Defaulting
    /// to theirs would mean the value shown is not the value held, which is a worse
    /// bug than the one this switch exists to fix.
    static let defaultChoice: Choice = .yours
}
