import SwiftUI

struct ScheduleDecisionsSection: View {
    let api: ForYouApi
    let companyId: String
    let refreshKey: Int
    let onChanged: @MainActor () -> Void
    let onHasDecisions: @MainActor (Bool) -> Void

    @Environment(\.appLocale) private var appLocale
    @State private var rows: [ScheduleDecision] = []
    @State private var dismissed: Set<String> = []
    @State private var retry = 0
    @State private var loadFailed = false
    @State private var pendingId: String?
    @State private var failedId: String?
    @State private var moving: ScheduleDecision?

    private var visible: [ScheduleDecision] {
        rows.filter { !dismissed.contains($0.id) }
    }

    var body: some View {
        Group {
            if loadFailed {
                LoadError(message: text("calendarFeed.attentionLoadFailed"), variant: .inline) { retry += 1 }
            } else if !visible.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    SectionHeader(label: text("calendarFeed.attentionTitle"), count: visible.count)
                    PaperCard {
                        ForEach(Array(visible.enumerated()), id: \.element.id) { index, decision in
                            if index > 0 { RowDivider() }
                            row(decision)
                        }
                    }
                }
            }
        }
        .task(id: "\(companyId)/\(refreshKey)/\(retry)") { await load() }
        .onChange(of: rows.isEmpty, initial: true) { _, empty in onHasDecisions(!empty) }
        .sheet(item: $moving) { decision in
            if let zone = decision.timeZone {
                MovedScheduleSheet(decision: decision, timeZone: zone) { picked in
                    moving = nil
                    resolve(decision, action: "moved", date: picked)
                }
            }
        }
    }

    private func text(_ key: String) -> String { AppStrings.translate(appLocale, key) }

    private func row(_ decision: ScheduleDecision) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(decision.task.title).font(.headline)
            Text(text(decision.reasonKey)).font(.subheadline)
            if decision.state == "conflict" {
                if let ours = decision.ours {
                    snapshot(text("calendarFeed.loonextSchedule"), ours)
                }
                if let theirs = decision.theirs {
                    let provider = text(decision.connection.provider == "google" ? "calendarFeed.googleProvider" : "calendarFeed.microsoftProvider")
                    snapshot(AppStrings.translate(appLocale, "calendarFeed.providerSchedule", ["provider": provider]), theirs)
                }
            }
            actions(decision)
            if failedId == decision.id {
                Text(text("calendarFeed.resolutionFailed")).font(.footnote).foregroundStyle(.red)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
    }

    private func snapshot(_ label: String, _ version: ScheduleDecision.Snapshot) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption.weight(.semibold))
            Text(version.title).font(.footnote)
            if let zone = TimeZone(identifier: version.time_zone) {
                let start = TimestampFormat.exact(version.start, locale: appLocale, timeZone: zone)
                let end = TimestampFormat.exact(version.end, locale: appLocale, timeZone: zone)
                Text("\(start) – \(end)").font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private func actions(_ decision: ScheduleDecision) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if decision.state == "conflict", decision.allowed_actions.contains("resolve_conflict") {
                Button(text("calendarFeed.useLoonext")) { resolve(decision, action: "use_app") }
                if decision.provider_condition == "conflict" {
                    Button(text("calendarFeed.useCalendar")) { resolve(decision, action: "use_calendar") }
                }
            }
            if decision.state == "event_removed", decision.allowed_actions.contains("resolve_event_removed") {
                Button(text("calendarFeed.cancelJob"), role: .destructive) { resolve(decision, action: "cancelled") }
                if decision.timeZone != nil {
                    Button(text("calendarFeed.movedJob")) { moving = decision }
                }
            }
            if decision.allowed_actions.contains("resolve_conflict") || decision.allowed_actions.contains("resolve_event_removed") {
                Button(text("calendarFeed.notSure")) { resolve(decision, action: "not_sure") }
            }
            Button(text("calendarFeed.openTask")) { AppRouter.shared.openTaskId = decision.task.id }
        }
        .buttonStyle(.bordered)
        .disabled(pendingId != nil)
    }

    private func load() async {
        do {
            let response = try await api.scheduleDecisions(companyId: companyId)
            guard !Task.isCancelled else { return }
            rows = response.attention
            loadFailed = false
        } catch is CancellationError {
            return
        } catch {
            loadFailed = rows.isEmpty
        }
    }

    private func resolve(_ decision: ScheduleDecision, action: String, date: Date? = nil) {
        pendingId = decision.id
        failedId = nil
        let request = ScheduleDecisionRequest(action: action, new_due_at: date?.ISO8601Format())
        Task {
            defer { pendingId = nil }
            do {
                _ = try await api.resolveScheduleDecision(companyId: companyId, id: decision.id, decision: request)
                if action == "not_sure" {
                    dismissed.insert(decision.id)
                } else {
                    rows.removeAll { $0.id == decision.id }
                }
                onChanged()
            } catch {
                failedId = decision.id
            }
        }
    }
}

private struct MovedScheduleSheet: View {
    let timeZone: TimeZone
    let onSave: (Date) -> Void

    @Environment(\.appLocale) private var appLocale
    @Environment(\.dismiss) private var dismiss
    @State private var date: Date

    init(decision: ScheduleDecision, timeZone: TimeZone, onSave: @escaping (Date) -> Void) {
        self.timeZone = timeZone
        self.onSave = onSave
        _date = State(initialValue: parseWireTimestamp(decision.task.due_at) ?? Date())
    }

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(AppStrings.translate(appLocale, "calendarFeed.newDateLabel"), selection: $date)
                    .environment(\.timeZone, timeZone)
                Text(AppStrings.translate(appLocale, "calendarFeed.newDateTimeZone", ["zone": timeZone.identifier]))
                    .foregroundStyle(.secondary)
            }
            .navigationTitle(AppStrings.translate(appLocale, "calendarFeed.movedJob"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "calendarFeed.saveMovedDate")) { onSave(date) }
                }
            }
        }
    }
}

private extension ScheduleDecision {
    var reasonKey: String {
        switch state {
        case "conflict":
            switch provider_condition {
            case "event_removed": return "calendarFeed.conflictProviderRemoved"
            case "refused": return "calendarFeed.conflictProviderRefused"
            default: return "calendarFeed.conflictTitle"
            }
        case "event_removed": return "calendarFeed.removedTitle"
        default:
            switch refusal?.code {
            case "all_day": return "calendarFeed.refusedAllDayTitle"
            case "invalid_time": return "calendarFeed.refusedTimeTitle"
            case "invalid_title": return "calendarFeed.refusedTitleTitle"
            case "unknown_time_zone": return "calendarFeed.refusedZoneTitle"
            case "description_too_long": return "calendarFeed.refusedDescriptionTitle"
            case "outside_sync_window": return "calendarFeed.refusedWindowTitle"
            case "unsafe_meeting": return "calendarFeed.refusedMeetingTitle"
            case "recurrence": return "calendarFeed.refusedRecurrenceTitle"
            default: return "calendarFeed.refusedUnknownTitle"
            }
        }
    }
}
