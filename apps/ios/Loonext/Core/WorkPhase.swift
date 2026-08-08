import Foundation

/// #294 — before and after, the one classification the trade actually uses.
///
/// The hand-port of `packages/shared/src/work-phase.ts`.
///
/// ## Where it lives, and why that is not an implementation detail
///
/// D28 decided attachments enter through exactly two doors — a text, or a note — and
/// that a task's files are a DERIVED view over those, never a third upload path. So
/// "mark this photo as an after" cannot be a property of the photo without inventing
/// the ingress D28 removed.
///
/// It is a property of the NOTE instead. A note is already the link between a set of
/// files and a job: it has an author, a moment, and a task. A tech does not photograph
/// one thing before and a different thing after — they take a handful when they arrive
/// and a handful when they finish, and each handful arrives together on one note.
///
/// ## Why grouping and attribution come free
///
/// Once the note carries the label, a job's photo set groups by note, orders by the
/// note's time, and attributes to the note's author with nothing further stored.
///
/// ## Why the order is chronological rather than before-then-after
///
/// A job record should read as what happened, in the order it happened. That puts the
/// befores first anyway, because that is when they were taken — and when somebody
/// mislabels one, the timeline stays honest instead of quietly reordering the day to
/// match the label.
enum WorkPhase {

    static let before = "before"
    static let after = "after"

    /// The two labels, in the order they appear on a job.
    static let all = [before, after]

    /// What each is called on screen.
    static func label(_ phase: String) -> String {
        switch phase {
        case before: return "Before"
        case after: return "After"
        default: return phase
        }
    }

    /// The choice offered when there is no label yet.
    ///
    /// Named rather than "None", because most notes are neither: a note saying the
    /// part is on order is not an unlabelled before. Offering "None" invites a tech to
    /// think they have failed to fill something in.
    static let unsetLabel = "Not a before or after"

    /// One line under the control, for somebody who has never seen it.
    static let hint =
        "Marks these photos as how it looked when you arrived, or how you left it."

    static func isPhase(_ value: String?) -> Bool {
        value == before || value == after
    }
}

/// The shape the grouping needs, so the rule does not depend on one screen's model.
protocol JobPhotoLike {
    var id: String { get }
    /// The note it arrived on. Nil for the customer's own texted media.
    var noteId: String? { get }
    var workPhase: String? { get }
    /// Who added it. Nil when the customer sent it.
    var addedByUserId: String? { get }
    var createdAt: String { get }
}

/// A set of files that arrived together, at one moment, from one person.
struct JobPhotoGroup<T: JobPhotoLike>: Identifiable {
    /// The note they came in on, or nil for the customer's own texted media. Also the
    /// group's identity: two notes written in the same second are still two visits'
    /// worth of photos and must not merge.
    let noteId: String?
    let workPhase: String?
    let addedByUserId: String?
    /// The earliest item in the group — what the group is ordered by.
    let at: String
    let items: [T]

    var id: String { noteId ?? "" }
}

/// Group a task's derived files into what a person would call visits.
///
/// Everything the customer texted lands in ONE group with a nil note, because it did
/// not arrive in visits and pretending otherwise would invent structure that is not
/// there. Everything else groups by the note it arrived on.
///
/// Stable: items keep their relative order inside a group, groups are ordered by their
/// earliest item, and ties break on the group key so two notes written in the same
/// second do not swap places between frames.
func groupJobPhotos<T: JobPhotoLike>(_ items: [T]) -> [JobPhotoGroup<T>] {
    var order: [String] = []
    var byKey: [String: [T]] = [:]
    for item in items {
        let key = item.noteId ?? ""
        if byKey[key] == nil {
            byKey[key] = []
            order.append(key)
        }
        byKey[key]?.append(item)
    }
    return order
        .compactMap { key -> JobPhotoGroup<T>? in
            guard let group = byKey[key], let head = group.first else { return nil }
            return JobPhotoGroup(
                noteId: head.noteId,
                workPhase: head.workPhase,
                addedByUserId: head.addedByUserId,
                // The group's time is its EARLIEST file, so a slow second upload does
                // not move a visit later in the day than it happened.
                at: group.map(\.createdAt).min() ?? head.createdAt,
                items: group
            )
        }
        .sorted { left, right in
            if left.at != right.at { return left.at < right.at }
            return (left.noteId ?? "") < (right.noteId ?? "")
        }
}

/// The one-line summary of a job's photo set: "3 before, 5 after".
///
/// Nil when there is nothing labelled, so a caller renders no summary at all rather
/// than "0 before, 0 after" — which reads as a broken count rather than as a job whose
/// photos nobody classified.
func jobPhaseSummary(_ items: [JobPhotoLike]) -> String? {
    let before = items.filter { $0.workPhase == WorkPhase.before }.count
    let after = items.filter { $0.workPhase == WorkPhase.after }.count
    if before == 0 && after == 0 { return nil }
    var parts: [String] = []
    if before > 0 { parts.append("\(before) before") }
    if after > 0 { parts.append("\(after) after") }
    return parts.joined(separator: ", ")
}
