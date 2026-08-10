import SwiftUI

/// #595 — the bookkeeper's usage export, on the phone.
///
/// The web card (#304) has shipped since March; neither phone had ANY export
/// surface at all — not usage, not the workspace dump, not contact history. So
/// this is two things at once: somewhere to ASK for the file, and somewhere the
/// finished file APPEARS. A phone with only the first half is a button that
/// posts a request into a screen that does not exist.
///
/// ## The rule lives in `packages/shared/src/usage-export.ts`
///
/// The default period, the capability and the words are owned there and this is
/// the hand-port. `ParityVectorsTests` holds `lastCompleteMonth` to
/// `packages/shared/vectors/last-complete-month.json`, and
/// `UsageExportCardTests` holds the three sentences to the TypeScript that
/// wrote them — change one side and the other side says so.
///
/// ## Design decisions, and the principle behind each
///
/// - **Never an empty form.** Opens on the last COMPLETE calendar month,
///   editable. `from` is required by the API, so a blank pair is a form that
///   cannot be submitted until somebody works out what to type. *Applying:
///   Smart Defaults.*
///
/// - **Collapsed until asked for.** The usage screen already carries the
///   fair-use state, delivery, the spending cap and the owner's Details drawer.
///   Pulling a file is deliberate and occasional, and does not earn permanent
///   space above any of that. *Applying: Zen of Clarity.*
///
/// - **The caveat before the button.** `EXPORT_USAGE_NOTE` says what the file is
///   NOT — it is not a copy of the Stripe invoice — and it sits where the
///   DECISION is made rather than in the file, where it would only ever be read
///   by somebody already disappointed. *Applying: Ethical Friction.*
///
/// - **Absent, not disabled.** Asked as a CAPABILITY (`billing.manage`), never
///   re-derived as a rank and never a hardcoded role list: #315 made roles
///   capability sets precisely so a role added later that holds `billing.manage`
///   gets this for free. Deliberately not `contacts.bulk`, which guards the
///   exports carrying customer data — gating it that way would lock out the
///   bookkeeper, the person this exists for.
///
/// - **The list has no role logic of its own.** `GET /v1/exports` already
///   returns only the kinds the caller may collect (#581/C13), decided in the
///   query rather than over its result. A second opinion here would be a second
///   implementation of one security decision, which is the drift D79 exists to
///   prevent.
enum UsageExport {

    // MARK: - The words

    // Hand-ported VERBATIM from `packages/shared/src/usage-export.ts`. Two of
    // the four clients import that file; this one cannot, so
    // `UsageExportCardTests` reads the TypeScript and compares it to these.
    // Never reworded here — reword it there, and the test will send you back.

    /// `EXPORT_USAGE_ACTION`.
    static let action = "Export usage"

    /// `EXPORT_USAGE_BLURB`.
    static let blurb =
        "Your texts, calls and storage for a period, as a file for whoever does "
        + "your books."

    /// `EXPORT_USAGE_NOTE`.
    static let note =
        "It counts what we measured \u{2014} it is not a copy of your Stripe invoice, and "
        + "nothing on it is priced. It is put together in the background and appears "
        + "under Data export."

    // MARK: - Who this exists for

    /// The capability that decides whether this surface exists for somebody.
    ///
    /// `USAGE_EXPORT_CAPABILITY` in the shared module, and the same gate the API
    /// puts on `POST /v1/exports/usage`.
    static let capability = Capability.billingManage

    /// Does this role get the export at all?
    ///
    /// Asked of the capability table, so a role invented later that holds
    /// `billing.manage` is answered correctly without this line changing. An
    /// unknown role holds nothing, which is the same fail-closed answer the
    /// server gives.
    static func isAvailable(to role: String?) -> Bool {
        MemberRole.has(role, capability)
    }

    // MARK: - The default period

    /// The last COMPLETE calendar month, as two `yyyy-mm-dd` days.
    ///
    /// Complete, not the current one: a bookkeeper reconciles a month that has
    /// finished, and defaulting to a period still accruing produces a file that
    /// is out of date before it finishes building.
    ///
    /// TAKES YEAR AND MONTH, NOT A DATE, and that is the portable part. The web
    /// original subtracted 86_400_000 milliseconds from local midnight — right
    /// almost everywhere, and a rule that each of three languages would have to
    /// re-derive rather than translate. Integers in, strings out; nothing about
    /// a time zone crosses this boundary, which is why the three clients can
    /// only agree.
    ///
    /// - Parameters:
    ///   - year: the calendar year the caller is currently in.
    ///   - month: the calendar month the caller is currently in, 1-12.
    static func lastCompleteMonth(year: Int, month: Int) -> UsageExportPeriod {
        // December rolls back to the previous year. Written out rather than
        // reached by modulo, because these two lines are what a reader checks
        // first.
        let previousYear = month == 1 ? year - 1 : year
        let previousMonth = month == 1 ? 12 : month - 1
        let last = daysInMonth(year: previousYear, month: previousMonth)
        return UsageExportPeriod(
            from: "\(pad(previousYear, 4))-\(pad(previousMonth, 2))-01",
            to: "\(pad(previousYear, 4))-\(pad(previousMonth, 2))-\(pad(last, 2))"
        )
    }

    /// The two dates the pickers open on.
    ///
    /// The Dates are local midnight of each day in `calendar`'s zone, which is
    /// what a `DatePicker` binds and what [instants] turns back into the pair
    /// the API is sent.
    static func defaultPeriod(
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> (from: Date, to: Date) {
        let period = lastCompleteMonth(
            year: calendar.component(.year, from: now),
            month: calendar.component(.month, from: now)
        )
        let start = day(period.from, calendar: calendar) ?? calendar.startOfDay(for: now)
        return (start, day(period.to, calendar: calendar) ?? start)
    }

    /// A `yyyy-mm-dd` day as the first instant of that day in `calendar`'s zone.
    static func day(_ value: String, calendar: Calendar) -> Date? {
        let parts = value.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let dayOfMonth = Int(parts[2])
        else { return nil }
        return calendar.date(
            from: DateComponents(year: year, month: month, day: dayOfMonth)
        )
    }

    // MARK: - The period, as the API wants it

    /// The picked days as the two ISO-8601 instants `POST /v1/exports/usage`
    /// takes.
    ///
    /// A date picker gives a DAY; the API wants an INSTANT. `from` is the first
    /// moment of its day and `to` is the last, so a period read off the screen as
    /// "the 1st to the 31st" includes the 31st — which is what anybody means by
    /// it, and what a month is. The web card does exactly this (`T00:00:00` and
    /// `T23:59:59.999`, local, serialised to UTC); a client that sent bare
    /// midnight for `to` would export a month a day short of the one on screen.
    ///
    /// Both edges are resolved through `calendar`, one day at a time, so a period
    /// spanning a clock change is still two whole days: March 1st opens at 05:00Z
    /// in Toronto and March 31st closes at 03:59:59.999Z, because the offset
    /// changed in between. Milliseconds of arithmetic could not have said that.
    static func instants(
        from: Date,
        to: Date,
        calendar: Calendar = .current
    ) -> (from: String, to: String) {
        (
            from: utc(calendar.startOfDay(for: from), fraction: "000"),
            to: utc(lastSecondOfDay(to, calendar: calendar), fraction: "999")
        )
    }

    // MARK: - What the list says

    /// Still being built — which is also the only reason to poll.
    ///
    /// Anything that is not finished counts, including a status this build has
    /// never heard of. The alternative reading — poll only on the two names we
    /// know — would leave a newer server's row spinning forever on an older
    /// phone. Polling is capped by [maxPolls] regardless, so the generous
    /// direction costs a bounded number of requests rather than an open-ended
    /// one.
    static func isBuilding(_ status: String) -> Bool {
        status != DataExportStatus.ready && status != DataExportStatus.failed
    }

    /// Is anything in this list still being built?
    static func isBuilding(_ exports: [DataExport]) -> Bool {
        exports.contains { isBuilding($0.status) }
    }

    /// Should the watcher ask the server again?
    ///
    /// The WHOLE stop condition, in one place a test can hold. It used to live
    /// inside the view's private loop as two guards over private state, and both
    /// could be deleted with every assertion still green: the suite tested
    /// `isBuilding` as a free predicate and `maxPolls` as a number, and neither
    /// of those is the decision. What that missed is what it costs — a screen
    /// left on a desk asking every fifteen seconds forever, each ready row
    /// signing storage URLs again.
    static func shouldAskAgain(polls: Int, exports: [DataExport]) -> Bool {
        polls < maxPolls && isBuilding(exports)
    }

    /// How a row says where it is up to. The default arm is the calm one, so a
    /// status added server-side reads as "not finished yet" rather than crashing
    /// or rendering a raw wire value at a customer.
    static func statusLabel(_ status: String) -> String {
        switch status {
        case DataExportStatus.ready: "Ready"
        case DataExportStatus.failed: "Didn't finish"
        default: "Being put together"
        }
    }

    /// How many times a screen left open will ask again before it stops.
    ///
    /// Fifteen seconds apart, matching the Android card, so three minutes of
    /// watching. An export that takes longer than that is not one somebody is
    /// holding the phone for, and a poll that never gives up is a request loop
    /// billed to a founder who cannot eat provider costs. When it runs out the
    /// card says so and offers the ask again, rather than pretending it is still
    /// watching.
    static let maxPolls = 12

    /// How long between polls.
    static let pollInterval: Duration = .seconds(15)

    // MARK: - Private

    /// Days in a month, from the Gregorian calendar itself.
    ///
    /// `Calendar.range(of:in:for:)` is the idiomatic form and gets the century
    /// rules right without spelling them out: 2100 is 28 days and 2000 is 29,
    /// both of which are in the parity vectors precisely because a `% 4`
    /// shortcut would be wrong there and right everywhere anybody would think to
    /// check.
    ///
    /// UTC on purpose. A month has the same number of days in every zone, and
    /// pinning one keeps the answer independent of the device.
    private static func daysInMonth(year: Int, month: Int) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        if let utc = TimeZone(secondsFromGMT: 0) { calendar.timeZone = utc }
        guard let first = calendar.date(
                  from: DateComponents(year: year, month: month, day: 1)
              ),
              let days = calendar.range(of: .day, in: .month, for: first)?.count
        else {
            // Foundation answers both of these for every Gregorian year and
            // month. The branch exists because the API is Optional, not because
            // there is a case — so it trips the debug build rather than quietly
            // reporting February.
            assertionFailure("no day count for \(year)-\(month)")
            return 28
        }
        return days
    }

    /// 23:59:59 on `date`'s day, in `calendar`'s zone.
    ///
    /// Built from components rather than by adding seconds to midnight: on the
    /// day the clocks go forward that day is 23 hours long, and arithmetic on
    /// the instant would land in the wrong one.
    private static func lastSecondOfDay(_ date: Date, calendar: Calendar) -> Date {
        var parts = calendar.dateComponents([.year, .month, .day], from: date)
        parts.hour = 23
        parts.minute = 59
        parts.second = 59
        return calendar.date(from: parts) ?? calendar.startOfDay(for: date)
    }

    /// An instant as UTC ISO-8601, with the milliseconds written rather than
    /// computed.
    ///
    /// `ISO8601DateFormatter`'s fractional-seconds option would be the obvious
    /// tool and is the wrong one here: the value it renders comes from a
    /// `Double`, and 0.999 of a second is not exactly representable, so whether
    /// the last millisecond of a month prints as `.999` or `.998` depends on a
    /// rounding decision inside Foundation. The three digits are a constant in
    /// this rule, so they are written as one.
    private static func utc(_ at: Date, fraction: String) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return "\(formatter.string(from: at)).\(fraction)Z"
    }

    /// Zero-padded to `width`, the `padStart` the shared module uses.
    private static func pad(_ value: Int, _ width: Int) -> String {
        let digits = "\(value)"
        guard digits.count < width else { return digits }
        return String(repeating: "0", count: width - digits.count) + digits
    }
}

/// The two `yyyy-mm-dd` days `lastCompleteMonth` returns.
///
/// A struct rather than a tuple so the parity test can compare one value against
/// one vector and name the input when it does not match.
struct UsageExportPeriod: Equatable, Sendable {
    let from: String
    let to: String
}

// MARK: - The card

/// The usage export, as a collapsed drawer in the Usage settings section.
///
/// Mounted unconditionally by `UsageSectionView`; the capability question is
/// answered HERE, once, so there is exactly one place to get it wrong. The
/// section itself is already behind `billing.manage`, and this does not lean on
/// that: a card that renders whatever its host lets through is one host change
/// away from being a leak.
@MainActor
struct UsageExportCard: View {
    let scope: SettingsScope

    /// Collapsed until asked for.
    @State private var open = false
    @State private var from: Date
    @State private var to: Date
    @State private var starting = false
    @State private var problem: String?
    @State private var recent: LoadState<[DataExport]> = .loading
    @State private var reloadKey = 0
    /// The poll gave up while something was still being built.
    @State private var stoppedWatching = false

    init(scope: SettingsScope) {
        self.scope = scope
        // Smart Defaults: the form opens filled in, on the month a bookkeeper
        // almost always wants, and stays editable.
        let period = UsageExport.defaultPeriod()
        _from = State(initialValue: period.from)
        _to = State(initialValue: period.to)
    }

    var body: some View {
        if UsageExport.isAvailable(to: scope.role) {
            card
        }
    }

    /// Titled with the words `UsageExport.note` promises a customer by name: it
    /// tells them the file "appears under Data export", and on a phone this is
    /// the only screen that could be. On the web that sentence points at a
    /// different card; here the request and the collect are the same card,
    /// because a phone with only the first half is a button that posts into a
    /// screen that does not exist.
    private var card: some View {
        SettingsCard(title: "Data export", description: open ? nil : UsageExport.blurb) {
            VStack(alignment: .leading, spacing: 12) {
                if open {
                    form
                } else {
                    openButton
                }
                // Below both states: a file somebody asked for yesterday is the
                // reason they opened this card, and making them expand a form to
                // find it would be a worse answer than the sentence that sent
                // them here.
                exports
            }
        }
        .task(id: "\(scope.companyId)|\(reloadKey)") { await watch() }
    }

    // MARK: - Collapsed

    private var openButton: some View {
        Button {
            open = true
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "doc")
                    .font(.footnote)
                Text(UsageExport.action)
                    .font(.subheadline.weight(.semibold))
                Spacer(minLength: 0)
                Image(systemName: "chevron.down")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .foregroundStyle(BrandColor.olive)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Open

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            DatePicker("From", selection: $from, displayedComponents: [.date])
                .datePickerStyle(.compact)
            // The end can never precede the start — the API refuses that pair,
            // and a picker that cannot express it is a better answer than an
            // error message explaining it.
            DatePicker("To", selection: $to, in: from..., displayedComponents: [.date])
                .datePickerStyle(.compact)

            // Ethical Friction: what this file is NOT, before the button rather
            // than inside the file.
            Text(UsageExport.note)
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)

            InlineError(problem)

            HStack(spacing: 10) {
                Button(starting ? "Starting…" : "Start it") { start() }
                    .buttonStyle(.borderedProminent)
                    .tint(BrandColor.olive)
                    .disabled(starting)
                Button("Cancel") { open = false }
                    .buttonStyle(.plain)
                    .foregroundStyle(BrandColor.muted700)
                    .disabled(starting)
            }
        }
        // Moving the start past the end carries the end with it, rather than
        // leaving a pair the server would refuse.
        .onChange(of: from) { _, next in
            if to < next { to = next }
        }
    }

    /// The exports this caller may collect, and nothing else.
    ///
    /// For a bookkeeper that is their usage summaries; for an owner it is every
    /// export the workspace has taken. The server decided that in the query
    /// (#581/C13) and it is not second-guessed here.
    ///
    /// An empty list renders NOTHING rather than an empty state. A workspace
    /// that has never taken an export is the ordinary case, and a line saying so
    /// would be permanent furniture explaining an absence nobody asked about.
    @ViewBuilder
    private var exports: some View {
        switch recent {
        case .loading:
            EmptyView()
        case .failed(let message):
            InlineError(message)
        case .ready(let rows):
            if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(rows) { row in
                        UsageExportRow(export: row)
                    }
                    if stoppedWatching {
                        // Honest about having stopped, rather than a spinner no
                        // longer attached to anything.
                        Text("Still building. We stopped checking to save your data.")
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                        Button("Check again") {
                            stoppedWatching = false
                            reloadKey += 1
                        }
                        .buttonStyle(.plain)
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                    }
                }
                .padding(.top, 4)
            }
        }
    }

    // MARK: - Behaviour

    /// Read once, then keep reading only while there is something to wait for.
    ///
    /// Three ways out and the loop continues through one of them: the read
    /// worked, something is still being built, and the cap has not run out.
    private func watch() async {
        var polls = 0
        while !Task.isCancelled {
            guard await load() else { return }
            guard UsageExport.shouldAskAgain(polls: polls, exports: rowsOnScreen)
            else {
                // Only the CAP is worth telling somebody about. Settling because
                // everything finished is the ordinary end of the loop.
                stoppedWatching = polls >= UsageExport.maxPolls
                return
            }
            try? await Task.sleep(for: UsageExport.pollInterval)
            polls += 1
        }
    }

    /// What the list currently holds, or nothing while it is loading or failed.
    private var rowsOnScreen: [DataExport] {
        if case .ready(let rows) = recent { return rows }
        return []
    }

    /// Reads the list. `false` means there is no point asking again.
    private func load() async -> Bool {
        do {
            recent = .ready(try await scope.repo.dataExports(scope.companyId).data)
            return true
        } catch {
            if Task.isCancelled { return false }
            // A poll that failed is not a reason to throw away rows already on
            // screen, including a download link somebody is about to tap — and a
            // read that failed must not become a read that fails every fifteen
            // seconds for as long as the screen is open.
            if case .ready = recent { return false }
            recent = .failed(error.userMessage)
            return false
        }
    }

    private func start() {
        guard !starting else { return }
        starting = true
        problem = nil
        stoppedWatching = false
        let period = UsageExport.instants(from: from, to: to)
        Task {
            do {
                let result = try await scope.repo.requestUsageExport(
                    scope.companyId,
                    from: period.from,
                    to: period.to
                )
                // The same two sentences the web card says, so a crew comparing
                // a laptop and a phone is told the same thing.
                scope.showMessage(
                    result.already_building
                        ? "One is already being put together. It will appear under "
                            + "Data export."
                        : "Being put together now. It will appear under Data export."
                )
                // The form has done its job; the list below is now the thing
                // worth looking at. Re-reading also restarts the poll, because
                // there is finally something in flight to watch.
                open = false
                reloadKey += 1
            } catch {
                problem = error.userMessage
            }
            starting = false
        }
    }
}

/// One recent export: where it is up to, and the file if there is one.
private struct UsageExportRow: View {
    let export: DataExport

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(UsageExport.statusLabel(export.status))
                    .font(.golos(12.5, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                Spacer(minLength: 8)
                Text(relativeTime(export.completed_at ?? export.requested_at))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
            }

            if export.status == DataExportStatus.failed {
                // The server's own sentence first, as everywhere else: it is
                // written to be read, and ours would be a guess about a failure
                // we were told the shape of.
                Text(export.error ?? "It didn't finish. Ask for another one.")
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.destructive)
            }

            ForEach(export.files) { file in
                Button {
                    // The signed link is minted for one hour and carries a
                    // download disposition, so the browser saves the file rather
                    // than rendering a CSV it might evaluate (#317).
                    openExternal(file.url)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.down.circle")
                            .font(.footnote)
                        Text(file.name)
                            .font(.golos(12.5, weight: .semibold))
                    }
                    .foregroundStyle(BrandColor.olive)
                }
                .buttonStyle(.plain)
            }

            if export.status == DataExportStatus.ready && export.files.isEmpty {
                Text(
                    "The links have expired and the copy has been deleted. Ask for a "
                        + "fresh one above."
                )
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted600)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(BrandColor.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
