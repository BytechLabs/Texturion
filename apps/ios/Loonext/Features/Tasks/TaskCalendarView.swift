import SwiftUI

/// /tasks Calendar view (#184/#186) — the scheduling view in the paper & olive
/// grammar, the iOS sibling of the Android TaskCalendar.kt and the web's
/// calendar-view.tsx:
///
///  - ONE month paper card: month title + chevron nav (plus a quiet Today jump
///    when off the current month), Mon..Sun ISO column heads, day cells with up
///    to three task dots colored by done state (lime = done, olive = open),
///    today ringed in olive, the selected day filled on the avatar tint,
///    adjacent-month days muted but live.
///  - Tapping a day selects it and lists that day's tasks below the grid as
///    standard task rows; each opens the task detail, and the done ring writes
///    through the same derived-done path the list uses.
///  - Data is GET /v1/tasks with due_after/due_before spanning the visible
///    week-aligned grid (via the existing TaskListFilters due window), pages
///    drained so no dated task past page one drops off the grid. A due window
///    is an explicit param, so the route's Open·Mine default is off and BOTH
///    statuses arrive in one due-sorted query.
///  - Filters: the assignee dimension (the tab's Mine/All baseline, the
///    assignee chip, the unassigned chip) and the title search ride the FETCH;
///    the status tabs (Open/Done) and the due chips are applied CLIENT-SIDE
///    over the month rows — the month window already owns the due params, so a
///    due chip narrows within it.
///  - Undated tasks can never match a due window, so the quiet "N without a due
///    date" line is counted client-side from the scope's statusless arms,
///    capped.

// MARK: - Pure grid + filter helpers (unit-tested in TasksCalendarLogicTests)

/// First day of the month containing `date`, at the calendar's start of day.
func startOfMonth(_ date: Date, calendar: Calendar) -> Date {
    let comps = calendar.dateComponents([.year, .month], from: date)
    return calendar.date(from: comps) ?? calendar.startOfDay(for: date)
}

/// The ISO Monday on or before the first of `date`'s month (weekday: Sun=1..
/// Sat=7, so the Monday offset is `(weekday + 5) % 7`). Independent of the
/// calendar's locale `firstWeekday` — the grid is ALWAYS Mon..Sun.
func calendarGridStart(_ date: Date, calendar: Calendar) -> Date {
    let first = startOfMonth(date, calendar: calendar)
    let weekday = calendar.component(.weekday, from: first)
    let mondayOffset = (weekday + 5) % 7
    return calendar.date(byAdding: .day, value: -mondayOffset, to: first) ?? first
}

/// The Sunday on or after the last day of `date`'s month.
func calendarGridEnd(_ date: Date, calendar: Calendar) -> Date {
    let first = startOfMonth(date, calendar: calendar)
    let dayCount = calendar.range(of: .day, in: .month, for: first)?.count ?? 28
    let last = calendar.date(byAdding: .day, value: dayCount - 1, to: first) ?? first
    let weekday = calendar.component(.weekday, from: last)
    let untilSunday = (8 - weekday) % 7
    return calendar.date(byAdding: .day, value: untilSunday, to: last) ?? last
}

/// The whole visible grid as a flat list of start-of-day dates (4, 5, or 6
/// full Mon..Sun weeks). Capped at 42 as a runaway guard.
func calendarGridDays(_ date: Date, calendar: Calendar) -> [Date] {
    let start = calendarGridStart(date, calendar: calendar)
    let end = calendarGridEnd(date, calendar: calendar)
    var days: [Date] = []
    var cursor = start
    while cursor <= end && days.count < 42 {
        days.append(cursor)
        guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
        cursor = next
    }
    return days
}

/// The tab's assignee baseline for the calendar fetch (status goes client-side
/// once the calendar strips it): Open/Mine/Done pin `me`, All means every
/// assignee, and the chips override. Mirrors Android's taskCalendarBaseAssignee.
func taskCalendarBaseAssignee(
    tab: TasksTabKind,
    assigneeChip: String?,
    unassignedChip: Bool
) -> String? {
    if let assigneeChip { return assigneeChip }
    if unassignedChip { return nil }
    return tab == .all ? assigneeAll : assigneeMe
}

/// Does `task` pass the status dimension of `tab`? (Client-side on the grid.)
func matchesCalendarTab(_ task: TaskItem, tab: TasksTabKind) -> Bool {
    switch tab {
    case .open: return !task.done
    case .done: return task.done
    case .mine, .all: return true
    }
}

/// Does `task` pass the due chip? Client-side sibling of `dueChipFilters` so a
/// chip narrows the month grid without re-fetching. Undated tasks never match a
/// chip; no chip passes everything.
func matchesCalendarDueChip(
    _ task: TaskItem,
    chip: DueChip?,
    now: Date = Date(),
    calendar: Calendar = .current
) -> Bool {
    guard let chip else { return true }
    if chip == .overdue { return isOverdue(task, now: now) }
    guard let due = parseWireTimestamp(task.due_at) else { return false }
    let start = calendar.startOfDay(for: now)
    let days = chip == .today ? 1 : 7
    guard let end = calendar.date(byAdding: .day, value: days, to: start) else { return false }
    return due >= start && due < end
}

// MARK: - Calendar view

@MainActor
struct TaskCalendarView: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    let members: [Member]
    let tab: TasksTabKind
    let assigneeChip: String?
    let unassignedChip: Bool
    let dueChip: DueChip?
    let q: String
    let refreshKey: Int
    let onOpenTask: @MainActor (String) -> Void
    let onToggleDone: @MainActor (TaskItem, Bool) -> Void

    @State private var monthAnchor = Date()
    @State private var selectedDay: Date? = Calendar.current.startOfDay(for: Date())

    @State private var state: LoadState<Void> = .loading
    @State private var rows: [TaskItem] = []
    @State private var undatedOpen = 0
    @State private var undatedDone = 0
    @State private var undatedTruncated = false
    @State private var localRefresh = 0

    private var calendar: Calendar { .current }
    private var month: Date { startOfMonth(monthAnchor, calendar: calendar) }
    private var query: String? { q.isEmpty ? nil : q }
    private var baseAssignee: String? {
        taskCalendarBaseAssignee(tab: tab, assigneeChip: assigneeChip, unassignedChip: unassignedChip)
    }
    private var unassignedResolved: Bool { unassignedChip && assigneeChip == nil }
    private var isCurrentMonth: Bool { calendar.isDate(month, equalTo: Date(), toGranularity: .month) }

    /// The status tab and due chip are client-side, so they are deliberately
    /// OUT of the fetch token — flipping them repaints with no refetch.
    private var fetchToken: String {
        [
            companyId, monthKey, baseAssignee ?? "-", unassignedResolved ? "u" : "",
            query ?? "", String(refreshKey), String(localRefresh),
        ].joined(separator: "|")
    }

    private var monthKey: String {
        let comps = calendar.dateComponents([.year, .month], from: month)
        return "\(comps.year ?? 0)-\(comps.month ?? 0)"
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { localRefresh += 1 }
            case .ready:
                readyContent
            }
        }
        .task(id: fetchToken) { await reload() }
    }

    @ViewBuilder
    private var readyContent: some View {
        let visibleRows = rows.filter {
            matchesCalendarTab($0, tab: tab) && matchesCalendarDueChip($0, chip: dueChip)
        }
        let byDay = tasksByDay(visibleRows)
        let undatedCount = undatedCountForTab
        let daySelection = resolvedSelection(byDay: byDay)

        ScrollView {
            VStack(spacing: 0) {
                gridCard(byDay: byDay)
                if visibleRows.isEmpty {
                    emptyRangeCard
                }
                if !visibleRows.isEmpty || undatedCount > 0 {
                    countsLine(scheduled: visibleRows.count, undated: undatedCount)
                }
                if let daySelection {
                    daySection(day: daySelection.day, tasks: daySelection.tasks)
                }
            }
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
    }

    // MARK: Grid card

    @ViewBuilder
    private func gridCard(byDay: [Date: [TaskItem]]) -> some View {
        let today = calendar.startOfDay(for: Date())
        VStack(spacing: 0) {
            monthNavRow
            weekdayHeads
            RowDivider().padding(.horizontal, 12)
            ForEach(Array(weeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: 0) {
                    ForEach(week, id: \.self) { day in
                        dayCell(
                            day: day,
                            inMonth: calendar.isDate(day, equalTo: month, toGranularity: .month),
                            isToday: calendar.isDate(day, inSameDayAs: today),
                            isSelected: selectedDay.map { calendar.isDate(day, inSameDayAs: $0) } ?? false,
                            tasks: byDay[calendar.startOfDay(for: day)] ?? []
                        )
                        .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 8)
            }
            Spacer().frame(height: 6)
        }
        .background(BrandColor.paper)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 18)
    }

    private var weeks: [[Date]] {
        let days = calendarGridDays(month, calendar: calendar)
        return stride(from: 0, to: days.count, by: 7).map { start in
            Array(days[start..<min(start + 7, days.count)])
        }
    }

    private var monthNavRow: some View {
        HStack(spacing: 0) {
            Button {
                stepMonth(-1)
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandColor.muted500)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Previous month")

            Text(monthTitle)
                .font(.golos(14.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
                .frame(maxWidth: .infinity)
                .lineLimit(1)

            if !isCurrentMonth {
                Button {
                    monthAnchor = Date()
                    selectedDay = calendar.startOfDay(for: Date())
                } label: {
                    Text("Today")
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
                .buttonStyle(.plain)
            }

            Button {
                stepMonth(1)
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(BrandColor.muted500)
                    .frame(width: 40, height: 40)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Next month")
        }
        .padding(.horizontal, 6)
        .padding(.top, 6)
    }

    private var weekdayHeads: some View {
        HStack(spacing: 0) {
            ForEach(weekdayLabels, id: \.self) { head in
                Text(head.uppercased())
                    .font(.golos(9.5, weight: .bold))
                    .kerning(0.4)
                    .foregroundStyle(BrandColor.muted500)
                    .frame(maxWidth: .infinity)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
    }

    @ViewBuilder
    private func dayCell(
        day: Date,
        inMonth: Bool,
        isToday: Bool,
        isSelected: Bool,
        tasks: [TaskItem]
    ) -> some View {
        let dayNumber = calendar.component(.day, from: day)
        VStack(spacing: 4) {
            ZStack {
                if isSelected {
                    Circle().fill(BrandColor.avatarTint)
                }
                if isToday {
                    Circle().strokeBorder(BrandColor.olive, lineWidth: 1.5)
                }
                Text("\(dayNumber)")
                    .font(.golos(12.5, weight: isToday || isSelected ? .semibold : .regular))
                    .foregroundStyle(dayNumberColor(inMonth: inMonth, isSelected: isSelected))
                    .lineLimit(1)
            }
            .frame(width: 27, height: 27)

            HStack(spacing: 3) {
                ForEach(Array(tasks.prefix(3).enumerated()), id: \.offset) { _, task in
                    Circle()
                        .fill(task.done ? BrandColor.lime : BrandColor.olive)
                        .frame(width: 5, height: 5)
                }
            }
            .frame(height: 5)
        }
        .padding(.top, 5)
        .padding(.bottom, 4)
        .contentShape(Rectangle())
        .onTapGesture { toggleSelection(day) }
        .accessibilityLabel(cellAccessibilityLabel(day: day, count: tasks.count))
    }

    private func dayNumberColor(inMonth: Bool, isSelected: Bool) -> Color {
        if isSelected { return BrandColor.muted900 }
        if !inMonth { return BrandColor.muted400 }
        return BrandColor.ink
    }

    // MARK: Below-grid sections

    private var emptyRangeCard: some View {
        Text(
            "Nothing is scheduled in this range. A task appears here once it has "
                + "a due date. Set one from the task's detail screen."
        )
        .font(.golos(12.5))
        .foregroundStyle(BrandColor.muted500)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(BrandColor.paper)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .padding(.horizontal, 18)
        .padding(.top, 10)
    }

    private func countsLine(scheduled: Int, undated: Int) -> some View {
        let undatedText = undatedTruncated ? "\(undated)+" : "\(undated)"
        let text: String
        if scheduled > 0 && undated > 0 {
            text = "\(scheduled) scheduled · \(undatedText) without a due date"
        } else if scheduled > 0 {
            text = "\(scheduled) scheduled"
        } else {
            text = "\(undatedText) without a due date"
        }
        return Text(text)
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.muted500)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.top, 10)
    }

    @ViewBuilder
    private func daySection(day: Date, tasks: [TaskItem]) -> some View {
        SectionHeader(label: dayHeadingLabel(day), count: tasks.count)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 18)
            .padding(.top, 14)
        if tasks.isEmpty {
            Text("Nothing due this day.")
                .font(.golos(12))
                .foregroundStyle(BrandColor.muted500)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .padding(.top, 2)
        } else {
            PaperCard {
                ForEach(tasks, id: \.id) { task in
                    CalendarTaskRow(task: task, assigneeName: assigneeName(task)) { done in
                        onToggleDone(task, done)
                    }
                    .contentShape(Rectangle())
                    .onTapGesture { onOpenTask(task.id) }
                    if task.id != tasks.last?.id {
                        RowDivider()
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)
        }
    }

    // MARK: Derivations

    private func tasksByDay(_ tasks: [TaskItem]) -> [Date: [TaskItem]] {
        var map: [Date: [TaskItem]] = [:]
        for task in tasks {
            guard let due = parseWireTimestamp(task.due_at) else { continue }
            map[calendar.startOfDay(for: due), default: []].append(task)
        }
        return map
    }

    private var undatedCountForTab: Int {
        switch tab {
        case .open: return undatedOpen
        case .done: return undatedDone
        case .mine, .all: return undatedOpen + undatedDone
        }
    }

    /// The selected day's row list — only when the selection sits inside the
    /// visible grid (a selection that scrolled off is not shown).
    private func resolvedSelection(byDay: [Date: [TaskItem]]) -> (day: Date, tasks: [TaskItem])? {
        guard let selectedDay else { return nil }
        let gridStart = calendarGridStart(month, calendar: calendar)
        let gridEnd = calendarGridEnd(month, calendar: calendar)
        guard selectedDay >= gridStart && selectedDay <= gridEnd else { return nil }
        return (selectedDay, byDay[calendar.startOfDay(for: selectedDay)] ?? [])
    }

    private func toggleSelection(_ day: Date) {
        let normalized = calendar.startOfDay(for: day)
        if let selectedDay, calendar.isDate(selectedDay, inSameDayAs: normalized) {
            selectedDay = nil
        } else {
            selectedDay = normalized
        }
    }

    private func stepMonth(_ delta: Int) {
        guard let next = calendar.date(byAdding: .month, value: delta, to: month) else { return }
        monthAnchor = next
        // A selection that scrolled out of the new grid quietly clears — its
        // day list would otherwise show data the grid no longer explains.
        if let selectedDay {
            let start = calendarGridStart(next, calendar: calendar)
            let end = calendarGridEnd(next, calendar: calendar)
            if selectedDay < start || selectedDay > end {
                self.selectedDay = nil
            }
        }
    }

    /// The row's assignee initials come from the members roster — nil (no
    /// avatar) when unassigned or the name is blank.
    private func assigneeName(_ task: TaskItem) -> String? {
        guard let id = task.assigned_user_id else { return nil }
        if id == me.user_id { return me.display_name }
        let name = members.first { $0.user_id == id }?.display_name
        return (name?.isBlank ?? true) ? nil : name
    }

    // MARK: Labels

    private var weekdayLabels: [String] { ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] }

    private var monthTitle: String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.dateFormat = "MMMM yyyy"
        return formatter.string(from: month)
    }

    private func cellAccessibilityLabel(day: Date, count: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.dateFormat = "MMMM d"
        let word = count == 1 ? "task" : "tasks"
        return "\(formatter.string(from: day)), \(count) \(word)"
    }

    /// "Today" / "Tomorrow" / "Tue Jul 28" (+year off-year) for the day header.
    private func dayHeadingLabel(_ date: Date) -> String {
        let today = calendar.startOfDay(for: Date())
        if calendar.isDate(date, inSameDayAs: today) { return "Today" }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: today),
           calendar.isDate(date, inSameDayAs: tomorrow) {
            return "Tomorrow"
        }
        let sameYear = calendar.component(.year, from: date) == calendar.component(.year, from: today)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = calendar
        formatter.dateFormat = sameYear ? "EEE MMM d" : "EEE MMM d yyyy"
        return formatter.string(from: date)
    }

    // MARK: Fetch

    /// Drain the month window (dated rows), then count the scope's undated
    /// tasks. Fresh loaders per fetch — a cursor never crosses filter
    /// sets/orderings. Mirrors Android's fetchTaskCalendarSnapshot.
    private func reload() async {
        if rows.isEmpty { state = .loading }
        let cal = calendar
        let gridStart = calendarGridStart(month, calendar: cal)
        let gridEnd = calendarGridEnd(month, calendar: cal)
        let endExclusive = cal.date(byAdding: .day, value: 1, to: gridEnd) ?? gridEnd
        let monthArm = TaskListFilters(
            assignedUserId: baseAssignee,
            unassigned: unassignedResolved,
            dueBefore: isoOffsetString(endExclusive, timeZone: cal.timeZone),
            dueAfter: isoOffsetString(gridStart, timeZone: cal.timeZone),
            q: query
        )
        let undatedArms = taskListArms(
            tab: tab == .all ? .all : .mine,
            assigneeUserId: assigneeChip,
            unassigned: unassignedChip,
            due: nil,
            q: query
        )
        let api = graph.tasksApi
        let company = companyId
        let fetch: TaskListLoader.Fetch = { filters, cursor, limit in
            try await api.list(companyId: company, filters: filters, cursor: cursor, limit: limit)
        }
        let monthLoader = TaskListLoader(arms: [monthArm], limit: 100, fetch: fetch)
        let undatedLoader = TaskListLoader(arms: undatedArms, limit: 100, fetch: fetch)
        do {
            var accumulated: [TaskItem] = []
            var pages = 0
            repeat {
                accumulated += try await monthLoader.nextPage()
                pages += 1
            } while monthLoader.hasMore && pages < 12
            var open = 0
            var done = 0
            pages = 0
            repeat {
                for task in try await undatedLoader.nextPage() where task.due_at == nil {
                    if task.done { done += 1 } else { open += 1 }
                }
                pages += 1
            } while undatedLoader.hasMore && pages < 10
            rows = accumulated
            undatedOpen = open
            undatedDone = done
            undatedTruncated = undatedLoader.hasMore
            state = .ready(())
        } catch {
            if rows.isEmpty { state = .failed(error.userMessage) }
        }
    }
}

/// The selected day's task row — the list view's grammar (done ring, struck
/// title when done, overdue-amber due line, 28pt assignee avatar). A faithful
/// local copy of TasksTab's private row (which is not extractable without
/// touching that type-checker-fragile file).
private struct CalendarTaskRow: View {
    let task: TaskItem
    let assigneeName: String?
    let onToggleDone: @MainActor (Bool) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Button {
                onToggleDone(!task.done)
            } label: {
                ZStack {
                    if task.done {
                        Circle().fill(BrandColor.lime)
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(BrandColor.onLime)
                    } else {
                        Circle().strokeBorder(BrandColor.muted250, lineWidth: 1.8)
                    }
                }
                .frame(width: 22, height: 22)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel(task.done ? "Mark not done" : "Mark done")

            VStack(alignment: .leading, spacing: 3) {
                Text(task.title)
                    .font(.golos(13.5, weight: .semibold))
                    .lineLimit(1)
                    .strikethrough(task.done)
                    .foregroundStyle(
                        task.done
                            ? AnyShapeStyle(BrandColor.muted400)
                            : AnyShapeStyle(BrandColor.ink)
                    )
                if task.due_at != nil {
                    let overdue = isOverdue(task)
                    Text(
                        overdue
                            ? "Overdue · due \(formatDue(task.due_at))"
                            : "Due \(formatDue(task.due_at))"
                    )
                    .font(.golos(11.5, weight: overdue ? .semibold : .regular))
                    .foregroundStyle(
                        overdue
                            ? AnyShapeStyle(BrandColor.overdueAmber)
                            : AnyShapeStyle(BrandColor.muted400)
                    )
                }
            }
            Spacer(minLength: 0)
            if let assigneeName {
                InitialsAvatar(name: assigneeName, size: 28)
            }
        }
        .padding(.horizontal, 15)
        .padding(.vertical, 13)
    }
}
