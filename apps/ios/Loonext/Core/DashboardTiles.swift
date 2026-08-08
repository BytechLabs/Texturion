import Foundation

/// #540 — which queue the landing screen leads with.
///
/// The hand-port of `packages/shared/src/dashboard-tiles.ts`, rule for rule, and
/// the third copy of it after `core/dashboard/DashboardTiles.kt`. An owner who
/// learns that the most urgent queue is at the top on their laptop has to find the
/// same thing in the van; a phone that ordered its sections differently would mean
/// they had learned nothing.
///
/// ## What this is expressed as here
///
/// On web the order drives a strip of four tiles across the top, because
/// horizontal room is free there. A phone cannot afford two rows of chrome above
/// the work, so the same decision orders the SECTIONS — which is all the strip was
/// ever an index of. Same rule, same first answer to "what needs me first",
/// expressed in the layout each platform can afford.
enum DashboardTiles {

    /// The four queues a member can be behind on. Stable ids, not display order.
    enum Tile: CaseIterable {
        case unassigned
        case waiting
        case tasks
        case unread
    }

    /// When "waiting" becomes "waiting too long" — four hours.
    ///
    /// Not five minutes, which is #388's reply window and what the inbox itself
    /// shouts about. This is the landing screen, answering the morning triage
    /// question: earlier today is ordinary, before lunch is a customer wondering
    /// whether they were heard.
    static let agedSeconds: TimeInterval = 4 * 60 * 60

    /// What makes a count worth looking at.
    enum Signal: Equatable {
        /// Some are past their due date. The strongest signal there is.
        case overdue(count: Int)
        /// Nothing overdue, but the oldest has been waiting this long.
        case oldest(ageSeconds: TimeInterval)
    }

    struct Row {
        let ageSeconds: TimeInterval?
        let overdue: Bool

        init(ageSeconds: TimeInterval?, overdue: Bool) {
            self.ageSeconds = ageSeconds
            self.overdue = overdue
        }
    }

    struct Input {
        let unassignedAges: [TimeInterval]
        let waiting: [Row]
        let tasks: [Row]
        let unreadAges: [TimeInterval]
    }

    struct Ordered {
        let tile: Tile
        let count: Int
        let signal: Signal?
    }

    private static func signalFor(_ ages: [TimeInterval?], overdueCount: Int) -> Signal? {
        if overdueCount > 0 { return .overdue(count: overdueCount) }
        guard let oldest = ages.compactMap({ $0 }).max() else { return nil }
        return .oldest(ageSeconds: oldest)
    }

    /// How much attention a queue has earned, lower first.
    ///
    /// Coarse on purpose — overdue, then aged, then merely present, then empty —
    /// because an order that reshuffles on a five-minute difference has moved every
    /// time somebody looks at it, and then nobody can learn where anything is.
    private static func rank(_ entry: Ordered) -> Int {
        if entry.count == 0 { return 3 }
        if case .overdue = entry.signal { return 0 }
        if case .oldest(let age) = entry.signal, age >= agedSeconds { return 1 }
        return 2
    }

    /// The four queues, in the order they should be read.
    ///
    /// The fallback is the declaration order below, which is the order the sections
    /// have always appeared in — so with nothing to separate two queues, nothing
    /// moves.
    static func order(_ input: Input) -> [Ordered] {
        let entries: [Ordered] = [
            // Nobody owns these, so nothing about them can be overdue TO a person.
            // Age is the whole signal: unclaimed work going stale is the failure,
            // and calling it overdue would imply somebody had already been asked.
            Ordered(
                tile: .unassigned,
                count: input.unassignedAges.count,
                signal: signalFor(input.unassignedAges.map { Optional($0) }, overdueCount: 0)
            ),
            Ordered(
                tile: .waiting,
                count: input.waiting.count,
                signal: signalFor(
                    input.waiting.map(\.ageSeconds),
                    overdueCount: input.waiting.filter(\.overdue).count
                )
            ),
            Ordered(
                tile: .tasks,
                count: input.tasks.count,
                signal: signalFor(
                    input.tasks.map(\.ageSeconds),
                    overdueCount: input.tasks.filter(\.overdue).count
                )
            ),
            Ordered(
                tile: .unread,
                count: input.unreadAges.count,
                signal: signalFor(input.unreadAges.map { Optional($0) }, overdueCount: 0)
            ),
        ]

        return entries.enumerated()
            .sorted { left, right in
                let rankL = rank(left.element)
                let rankR = rank(right.element)
                if rankL != rankR { return rankL < rankR }
                // AGE BREAKS A TIE ONLY AMONG QUEUES ALREADY AGED. Within rank 1
                // everything is past four hours, so a swap means hours and is worth
                // showing. Below it, "today, fine" is the same answer for all of
                // them and the declaration order wins — sorting every rank by age
                // is the reshuffling the paragraph above refuses.
                if rankL == 1 {
                    let ageL = ageOf(left.element)
                    let ageR = ageOf(right.element)
                    if ageL != ageR { return ageL > ageR }
                }
                return left.offset < right.offset
            }
            .map(\.element)
    }

    private static func ageOf(_ entry: Ordered) -> TimeInterval {
        if case .oldest(let age) = entry.signal { return age }
        return 0
    }
}
