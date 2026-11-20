import MapKit
import SwiftUI

private struct DispatchMember: Codable, Identifiable, Sendable {
    let id: String
    let name: String?
    let shifts: [String: DispatchShift]?
}

private struct DispatchWindow: Codable, Equatable, Sendable {
    let start: String
    let end: String
}

private struct DispatchShift: Codable, Sendable {
    var start: String? = nil
    var end: String? = nil
    var breaks: [DispatchWindow] = []

    var json: JSONValue {
        .object([
            "start": start.map(JSONValue.string) ?? .null,
            "end": end.map(JSONValue.string) ?? .null,
            "breaks": .array(breaks.map { .object(["start": .string($0.start), "end": .string($0.end)]) }),
        ])
    }
}

private struct DispatchTask: Codable, Identifiable, Sendable {
    let id: String
    let title: String
    let due_on: String?
    let due_at: String?
    let address: String?
    let lat: Double?
    let lng: Double?
    let dispatch_estimate: Int?
    let assigned_user_id: String?
    let scheduled_count: Int
    let updated_at: String
    let done: Bool
    let windows: [DispatchWindow]
}

private struct DispatchBlock: Codable, Identifiable, Sendable {
    let id: String
    let task_id: String
    let assignee_id: String
    let starts_at: String
    let ends_at: String
    let visit: Bool
    let locked: Bool
    let address_confirmed: Bool
}

private struct DispatchDay: Decodable, Sendable {
    let date: String
    let start: String
    let end: String
    let opens_at: String?
}

private struct DispatchCell: Decodable, Sendable {
    let date: String
    let assignee_id: String
    let booked: Double
    let available: Double?
    let overloaded: Bool?
}

private struct DispatchIssue: Decodable, Identifiable, Sendable {
    let id: String
    let reason: String
}

private struct DispatchRoute: Decodable, Sendable {
    let before: Int
    let after: Int
    let skipped: [DispatchIssue]
    let proposal: [DispatchBlock]
}

private struct DispatchPlan: Decodable, Sendable {
    let revision: Int
    let timezone: String
    let members: [DispatchMember]
    let days: [DispatchDay]
    let tasks: [DispatchTask]
    let blocks: [DispatchBlock]

    func day(_ date: String) -> DispatchDay? { days.first { $0.date == date } }

    func tasksFor(_ date: String) -> [DispatchBlock] {
        guard let day = day(date) else { return [] }
        return blocks.filter { dispatchInstant($0.starts_at) < dispatchInstant(day.end) &&
            dispatchInstant($0.ends_at) > dispatchInstant(day.start) }
    }
}

private struct DispatchPayload: Decodable, Sendable {
    let plan: DispatchPlan
    let workload: [DispatchCell]
    let slots: [DispatchBlock]?
    let route: DispatchRoute?
    let conflicts: [DispatchIssue]?
    let notify: [String]?
}

private struct DispatchEdit: Encodable, Identifiable, Sendable {
    let id: String
    let task_id: String
    let updated_at: String
    var remove = false
    var reschedule = false
    var assignee_id: String?
    var starts_at: String?
    var ends_at: String?
    var locked = false
    var visit = false
    var confirm_address = false

    init(id: String, task: DispatchTask) {
        self.id = id
        task_id = task.id
        updated_at = task.updated_at
    }

    init(block: DispatchBlock, task: DispatchTask) {
        self.init(id: block.id, task: task)
        assignee_id = block.assignee_id
        starts_at = block.starts_at
        ends_at = block.ends_at
        locked = block.locked
        visit = block.visit
        confirm_address = block.address_confirmed
    }
}

private struct DispatchDetail: Encodable, Identifiable, Sendable {
    var id: String { task_id }
    let task_id: String
    let updated_at: String
    let estimate: Int?
    let windows: [DispatchWindow]
}

private struct DispatchSlot: Encodable, Sendable {
    let id: String
    let task_id: String
    let duration: Int
    let visit: Bool
    let confirm_address: Bool
    let assignee_id: String?
}

private struct DispatchRouteRequest: Encodable, Sendable {
    let assignee_id: String
    let optimize: Bool = true
    var order: [String]?
}

private struct DispatchRequest: Encodable, Sendable {
    let day: String
    var focus: String
    let revision: Int
    var task: String?
    var blocks: [DispatchEdit]
    var details: [DispatchDetail]
    var slot: DispatchSlot?
    var route: DispatchRouteRequest?
}

private struct DispatchSelection: Identifiable {
    let task: String
    let block: String?
    var id: String { block ?? task }
}

private enum DispatchPane: String, CaseIterable {
    case schedule, workload, routes, myDay

    var key: String { "contactsTasks.\(rawValue)" }

    var icon: String {
        switch self {
        case .schedule: "calendar"
        case .workload: "square.grid.2x2"
        case .routes: "map"
        case .myDay: "person"
        }
    }
}

private func dispatchInstant(_ value: String) -> Date {
    parseWireTimestamp(value) ?? .distantPast
}

private func dispatchISO(_ date: Date) -> String {
    ISO8601DateFormatter().string(from: date)
}

private func dispatchClock(_ iso: String, zone: TimeZone, locale: String) -> String {
    TimestampFormat.clock(dispatchInstant(iso), locale: locale, timeZone: zone)
}

@MainActor
struct DispatchPlanner: View {
    let graph: AppGraph
    let companyId: String
    let me: Me
    var initialTask: String? = nil
    let onTask: (String) -> Void

    @Environment(\.appLocale) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()
    @State private var pane = DispatchPane.schedule
    @State private var base: DispatchPayload?
    @State private var draft: DispatchPayload?
    @State private var edits: [DispatchEdit] = []
    @State private var details: [DispatchDetail] = []
    @State private var slots: [DispatchBlock]?
    @State private var route: DispatchRoute?
    @State private var selection: DispatchSelection?
    @State private var person: String?
    @State private var busy = false
    @State private var review = false
    @State private var editingShift = false
    @State private var shiftFailure: String?
    @State private var failure: String?
    @State private var refresh = 0

    private var zone: TimeZone { TimeZone(identifier: me.company?.timezone ?? "") ?? .current }
    private var calendar: Calendar {
        var value = Calendar(identifier: .iso8601)
        value.timeZone = zone
        return value
    }
    private var week: Date { calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date }
    private var dirty: Bool { !edits.isEmpty || !details.isEmpty }
    private var editable: Bool {
        MemberRole.has(me.memberships.first { $0.company_id == companyId }?.role, Capability.conversationsNote)
    }
    private var canEditShifts: Bool {
        MemberRole.has(me.memberships.first { $0.company_id == companyId }?.role, Capability.settingsManage)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    ScreenTitle(text: text("contactsTasks.planner"))
                    Spacer()
                    Button(text("common.close")) { dismiss() }
                }
                SegmentedControl(
                    options: DispatchPane.allCases.map {
                        SegmentedOption($0, systemImage: $0.icon, accessibilityLabel: text($0.key))
                    },
                    selected: pane,
                    size: .compact,
                    fill: true,
                    onSelect: { pane = $0 }
                )
                DatePicker(text("contactsTasks.dispatchDate"), selection: Binding(
                    get: { date }, set: { selectDate($0) }
                ), displayedComponents: .date)
                    .disabled(busy)
                if let failure {
                    Text(failure).foregroundStyle(BrandColor.destructive)
                    Button(text("contactsTasks.dispatchReload")) {
                        clearDraft()
                        refresh += 1
                    }
                }
                if let base, let current = draft ?? self.base {
                    if canEditShifts, !base.plan.members.isEmpty, pane != .myDay {
                        Button(text("contactsTasks.dispatchShifts")) {
                            shiftFailure = nil
                            editingShift = true
                        }
                        .disabled(busy || dirty)
                    }
                    if dirty {
                        HStack {
                            Button(text("contactsTasks.dispatchDiscard"), action: clearDraft)
                            Spacer()
                            Button(text("contactsTasks.dispatchReview")) { review = true }
                                .disabled(busy || current.conflicts?.isEmpty == false)
                        }
                    }
                    ForEach(current.conflicts ?? []) { issue in
                        Text(text(issueKey(issue.reason))).foregroundStyle(BrandColor.destructive)
                    }
                    content(base: base, current: current)
                } else if failure == nil {
                    ProgressView()
                }
            }
            .padding(18)
        }
        .background(BrandColor.canvas.ignoresSafeArea())
        .environment(\.timeZone, zone)
        .task(id: "\(key(week)):\(refresh)") { await load() }
        .sheet(isPresented: $review) { publishReview }
        .sheet(isPresented: $editingShift) {
            if let base, let worker = person ?? base.plan.members.first?.id {
                DispatchShiftEditor(members: base.plan.members, worker: worker, date: date, calendar: calendar,
                    busy: busy, failure: shiftFailure) { id, weekday, shift in
                    await saveShift(base, worker: id, weekday: weekday, shift: shift)
                }
                .interactiveDismissDisabled(busy)
            }
        }
    }

    private func text(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(locale, key, vars)
    }

    private func key(_ date: Date) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private func selectDate(_ next: Date) {
        if dirty, calendar.dateInterval(of: .weekOfYear, for: next)?.start != week { return }
        date = next
        selection = nil
        route = nil
        slots = nil
    }

    private func clearDraft() {
        draft = nil
        edits = []
        details = []
        slots = nil
        route = nil
        selection = nil
        failure = nil
        review = false
    }

    private func load() async {
        base = nil
        failure = nil
        do {
            base = try await graph.api.get("/v1/dispatch", query: ["day": key(week), "task": initialTask], companyId: companyId)
            if let initialTask { selection = DispatchSelection(task: initialTask, block: nil) }
        } catch is CancellationError {
            return
        } catch {
            failure = error.userMessage
        }
    }

    private func saveShift(_ original: DispatchPayload, worker: String, weekday: Int, shift: DispatchShift?) async {
        guard !busy, !dirty else { return }
        busy = true
        shiftFailure = nil
        defer { busy = false }
        var body: [String: JSONValue] = [
            "day": .string(key(week)), "worker_id": .string(worker), "weekday": .number(Double(weekday)),
            "revision": .number(Double(original.plan.revision)), "shift": shift?.json ?? .null,
        ]
        if let initialTask { body["task"] = .string(initialTask) }
        do {
            base = try await graph.api.put("/v1/dispatch/shifts", body: body, companyId: companyId)
            route = nil
            slots = nil
            editingShift = false
        } catch {
            shiftFailure = error.userMessage
        }
    }

    private func run(_ action: @escaping () async throws -> Void) {
        guard !busy else { return }
        busy = true
        failure = nil
        Task {
            defer { busy = false }
            do { try await action() }
            catch is CancellationError { return }
            catch { failure = error.userMessage }
        }
    }

    private func request(_ blocks: [DispatchEdit]? = nil, _ updates: [DispatchDetail]? = nil) -> DispatchRequest {
        DispatchRequest(day: key(week), focus: key(date), revision: base?.plan.revision ?? 0,
            task: initialTask, blocks: blocks ?? edits, details: updates ?? details)
    }

    private func stage(_ blocks: [DispatchEdit], _ updates: [DispatchDetail]) {
        run {
            let next: DispatchPayload = try await graph.api.post("/v1/dispatch/preview",
                body: request(blocks, updates), companyId: companyId)
            edits = blocks
            details = updates
            draft = next
            route = nil
            slots = nil
            if next.conflicts?.isEmpty != false { selection = nil }
        }
    }

    private func replaceDetail(_ next: DispatchDetail) -> [DispatchDetail] {
        details.filter { $0.id != next.id } + [next]
    }

    @ViewBuilder
    private func content(base: DispatchPayload, current: DispatchPayload) -> some View {
        let plan = current.plan
        let today = key(date)
        let blocks = plan.tasksFor(today)
        let worker = person ?? plan.members.first?.id
        switch pane {
        case .schedule:
            if editable, let selection,
               let task = plan.tasks.first(where: { $0.id == selection.task }), let day = plan.day(today) {
                let booking = blocks.first { $0.id == selection.block }
                DispatchEditor(
                    plan: plan, day: day, task: task, booking: booking, worker: worker, zone: zone, slots: slots, busy: busy,
                    onFind: { find, details, focus in
                        run {
                            var body = request(nil, replaceDetail(details))
                            body.slot = find
                            body.focus = key(focus)
                            let result: DispatchPayload = try await graph.api.post("/v1/dispatch/preview", body: body, companyId: companyId)
                            slots = result.slots
                        }
                    },
                    onSave: { edit, detail in stage(edits.filter { $0.id != edit.id } + [edit], replaceDetail(detail)) },
                    onDetails: { stage(edits, replaceDetail($0)) },
                    onRemove: {
                        guard let booking else { return }
                        var next = edits.filter { $0.id != booking.id }
                        if let old = base.plan.blocks.first(where: { $0.id == booking.id }) {
                            var edit = DispatchEdit(id: old.id, task: task)
                            edit.remove = true
                            edit.reschedule = old.locked
                            next.append(edit)
                        }
                        stage(next, details)
                    }
                )
                .id(selection.id + today)
            }
            let pending = plan.tasks.filter { !$0.done && $0.scheduled_count == 0 }
            SectionLabel(text("contactsTasks.dispatchQueue"))
            if pending.isEmpty { Text(text("contactsTasks.dispatchQueueEmpty")) }
            ForEach(pending.prefix(200)) { task in
                taskRow(task, nil, allowEdit: editable)
            }
            ForEach(plan.members.sorted { $0.id == worker && $1.id != worker }) { member in
                SectionLabel(member.name ?? text("contactsTasks.dispatchAssignee"))
                let bookings = blocks.filter { $0.assignee_id == member.id }
                if bookings.isEmpty { Text(text("contactsTasks.dispatchNoBookings")) }
                ForEach(bookings) { block in
                    if let task = plan.tasks.first(where: { $0.id == block.task_id }) {
                        taskRow(task, block, allowEdit: editable)
                    }
                }
            }
        case .workload:
            workload(current)
        case .routes:
            routes(plan, blocks: blocks, worker: worker)
        case .myDay:
            let schedule = base.plan.tasksFor(today).filter { $0.assignee_id == me.user_id }
            SectionLabel(text("contactsTasks.myDay"))
            if schedule.isEmpty { Text(text("contactsTasks.dispatchNoBookings")) }
            ForEach(schedule) { block in
                if let task = base.plan.tasks.first(where: { $0.id == block.task_id }) { taskRow(task, block) }
            }
        }
    }

    @ViewBuilder
    private func taskRow(_ task: DispatchTask, _ block: DispatchBlock?, allowEdit: Bool = false) -> some View {
        PaperCard {
            VStack(alignment: .leading, spacing: 6) {
                Button(task.title) {
                    dismiss()
                    onTask(task.id)
                }
                .font(.headline)
                if let block {
                    Text(dispatchClock(block.starts_at, zone: zone, locale: locale)
                        + " – " + dispatchClock(block.ends_at, zone: zone, locale: locale))
                    if block.locked { Label(text("contactsTasks.dispatchLocked"), systemImage: "lock") }
                    if block.visit, block.address_confirmed, let address = task.address {
                        Text(address)
                        if let url = directions(address) {
                            Link(text("contactsTasks.dispatchInstructions"), destination: url)
                        }
                    }
                } else {
                    Text(task.dispatch_estimate.map { text("contactsTasks.dispatchDurationValue", ["minutes": String($0)]) }
                        ?? text("contactsTasks.dispatchEstimateMissing"))
                }
                if allowEdit {
                    Button(text(block == nil ? "contactsTasks.dispatchNewBlock" : "contactsTasks.dispatchEditBlock")) {
                        selection = DispatchSelection(task: task.id, block: block?.id)
                        slots = nil
                    }
                    .frame(minHeight: 44)
                }
            }
            .font(.subheadline)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        }
    }

    private func directions(_ address: String) -> URL? {
        var url = URLComponents()
        url.scheme = "https"
        url.host = "maps.apple.com"
        url.queryItems = [URLQueryItem(name: "daddr", value: address)]
        return url.url
    }

    @ViewBuilder
    private func workload(_ payload: DispatchPayload) -> some View {
        SectionLabel(text("contactsTasks.dispatchBooked"))
        ForEach(payload.plan.members) { member in
            PaperCard {
                VStack(alignment: .leading, spacing: 8) {
                    Text(member.name ?? text("contactsTasks.dispatchAssignee")).font(.headline)
                    ScrollView(.horizontal) {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(payload.workload.filter { $0.assignee_id == member.id }, id: \.date) { cell in
                                Button {
                                    if let day = payload.plan.day(cell.date) {
                                        selectDate(dispatchInstant(day.start))
                                        person = member.id
                                        pane = .schedule
                                    }
                                } label: {
                                    VStack(alignment: .leading) {
                                        Text(cell.date.suffix(5))
                                        Text(text("contactsTasks.dispatchDurationValue", ["minutes": String(Int(cell.booked))]))
                                        Text(cell.available.map {
                                            text("contactsTasks.dispatchDurationValue", ["minutes": String(Int($0))])
                                        } ?? text("contactsTasks.dispatchAvailabilityUnknown"))
                                        if cell.overloaded ?? (cell.available.map { cell.booked > $0 } ?? false) {
                                            Text(text("contactsTasks.dispatchOverload")).foregroundStyle(BrandColor.destructive)
                                        }
                                    }
                                    .padding(8)
                                }
                            }
                        }
                    }
                }
                .padding(12)
            }
        }
        SectionLabel(text("contactsTasks.unassigned"))
        let first = payload.plan.days.first
        let last = payload.plan.days.last
        let unassigned = payload.plan.tasks.filter { task in
            guard !task.done, task.assigned_user_id == nil, task.scheduled_count == 0, let first, let last else { return false }
            if let due = task.due_on { return due >= first.date && due <= last.date }
            guard let due = task.due_at else { return false }
            return dispatchInstant(due) >= dispatchInstant(first.start) && dispatchInstant(due) < dispatchInstant(last.end)
        }
        if unassigned.isEmpty { Text(text("contactsTasks.dispatchQueueEmpty")) }
        ForEach(unassigned) { taskRow($0, nil) }
    }

    @ViewBuilder
    private func routes(_ plan: DispatchPlan, blocks: [DispatchBlock], worker: String?) -> some View {
        let candidate = Dictionary(uniqueKeysWithValues: (route?.proposal ?? []).map { ($0.id, $0) })
        let schedule = blocks.filter { $0.assignee_id == worker }.map { candidate[$0.id] ?? $0 }
            .sorted { dispatchInstant($0.starts_at) < dispatchInstant($1.starts_at) }
        let stops = schedule.filter { $0.visit && $0.address_confirmed }
        let flexible = stops.filter { !$0.locked }
        let label = text("contactsTasks.dispatchAssignee")
        SelectField(
            options: plan.members.map { SelectOption($0.id, title: $0.name ?? label) },
            selected: worker ?? "",
            label: label,
            enabled: !busy
        ) {
            person = $0
            route = nil
        }
        if editable {
            Button(text("contactsTasks.dispatchOptimize")) { optimize(worker) }
                .disabled(busy || flexible.isEmpty)
        }
        if let route {
            Text(text("contactsTasks.dispatchDrive", ["before": String(route.before), "after": String(route.after)]))
            ForEach(route.skipped) { issue in
                let task = plan.tasks.first { $0.id == blocks.first { $0.id == issue.id }?.task_id }
                Text([task?.title, text(issue.reason == "capacity" ? "contactsTasks.dispatchRouteCapacity" :
                    "contactsTasks.dispatchRouteAddress")].compactMap { $0 }.joined(separator: " · "))
            }
            if !candidate.isEmpty {
                Button(text("contactsTasks.dispatchApplyRoute")) {
                    let changed = route.proposal.compactMap { block in
                        plan.tasks.first { $0.id == block.task_id }.map { DispatchEdit(block: block, task: $0) }
                    }
                    stage(edits.filter { candidate[$0.id] == nil } + changed, details)
                }
                .disabled(busy)
            }
        }
        SectionLabel(text("contactsTasks.routes"))
        if stops.isEmpty { Text(text("contactsTasks.dispatchStopsEmpty")) }
        let pins = stops.compactMap { block -> DispatchPin? in
            guard let task = plan.tasks.first(where: { $0.id == block.task_id }), let lat = task.lat, let lng = task.lng else { return nil }
            return DispatchPin(id: block.id, title: task.title, coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng))
        }
        if !pins.isEmpty {
            Map {
                ForEach(pins) { Marker($0.title, coordinate: $0.coordinate) }
            }
            .frame(height: 210)
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .accessibilityLabel(text("contactsTasks.routes"))
        }
        ForEach(stops) { stop in
            if let task = plan.tasks.first(where: { $0.id == stop.task_id }) { taskRow(task, stop) }
            if editable, let index = flexible.firstIndex(where: { $0.id == stop.id }) {
                HStack {
                    reorderButton(worker, flexible, index: index, change: -1)
                    reorderButton(worker, flexible, index: index, change: 1)
                }
            }
        }
        let commitments = schedule.filter { !$0.visit || !$0.address_confirmed }
        if !commitments.isEmpty { SectionLabel(text("contactsTasks.dispatchOtherWork")) }
        ForEach(commitments) { block in
            if let task = plan.tasks.first(where: { $0.id == block.task_id }) { taskRow(task, block) }
        }
    }

    private func optimize(_ worker: String?, order: [String]? = nil) {
        guard let worker else { return }
        run {
            var body = request()
            body.route = DispatchRouteRequest(assignee_id: worker, order: order)
            let result: DispatchPayload = try await graph.api.post("/v1/dispatch/preview", body: body, companyId: companyId)
            route = result.route
        }
    }

    private func reorderButton(_ worker: String?, _ blocks: [DispatchBlock], index: Int, change: Int) -> some View {
        Button(text(change < 0 ? "contactsTasks.dispatchEarlier" : "contactsTasks.dispatchLater")) {
            var order = blocks.map(\.id)
            order.swapAt(index, index + change)
            optimize(worker, order: order)
        }
        .disabled(busy || !blocks.indices.contains(index + change))
    }

    private var publishReview: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScreenTitle(text: text("contactsTasks.dispatchPreview"))
            ScrollView {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(edits) { edit in
                        let previous = base?.plan.blocks.first { $0.id == edit.id }
                        let task = base?.plan.tasks.first { $0.id == edit.task_id }
                        let member = base?.plan.members.first { $0.id == (edit.assignee_id ?? previous?.assignee_id) }
                        let reason = text(edit.remove ? "contactsTasks.dispatchRemoved" : previous == nil ?
                            "contactsTasks.dispatchAdded" : "contactsTasks.dispatchMoved")
                        Text([reason, task?.title, member?.name,
                            edit.starts_at.map { dispatchClock($0, zone: zone, locale: locale) }].compactMap { $0 }.joined(separator: " · "))
                    }
                    ForEach(details) { entry in
                        let name = base?.plan.tasks.first { $0.id == entry.id }?.title
                        Text([text("contactsTasks.dispatchDetails"), name].compactMap { $0 }.joined(separator: " · "))
                    }
                    if let crew = draft?.notify, !crew.isEmpty {
                        let names = base?.plan.members.filter { crew.contains($0.id) }.compactMap(\.name) ?? []
                        Text(text("contactsTasks.dispatchNotify") + " · " + names.joined(separator: ", "))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Button(text("contactsTasks.dispatchPublish")) {
                review = false
                run {
                    base = try await graph.api.post("/v1/dispatch/publish", body: request(), companyId: companyId)
                    clearDraft()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(busy)
        }
        .padding(18)
        .background(BrandColor.canvas.ignoresSafeArea())
    }

    private func issueKey(_ reason: String) -> String {
        switch reason {
        case "address": "apiRefusals.dispatchAddress"
        case "hours": "apiRefusals.dispatchHours"
        case "overlap": "apiRefusals.dispatchOverlap"
        case "travel": "apiRefusals.dispatchTravel"
        default: "apiRefusals.dispatchWindow"
        }
    }
}

private struct DispatchShiftEditor: View {
    let members: [DispatchMember]
    let date: Date
    let calendar: Calendar
    let busy: Bool
    let failure: String?
    let onSave: @MainActor (String, Int, DispatchShift?) async -> Void

    @Environment(\.appLocale) private var locale
    @Environment(\.dismiss) private var dismiss
    @State private var worker: String
    @State private var mode: String
    @State private var shift: DispatchShift

    init(members: [DispatchMember], worker: String, date: Date, calendar: Calendar, busy: Bool,
         failure: String?, onSave: @escaping @MainActor (String, Int, DispatchShift?) async -> Void) {
        self.members = members
        self.date = date
        self.calendar = calendar
        self.busy = busy
        self.failure = failure
        self.onSave = onSave
        let weekday = (calendar.component(.weekday, from: date) + 5) % 7 + 1
        let existing = members.first { $0.id == worker }?.shifts?[String(weekday)]
        _worker = State(initialValue: worker)
        _mode = State(initialValue: existing == nil ? "workspace" : existing?.start == nil ? "off" : "shift")
        _shift = State(initialValue: existing?.start == nil ? Self.defaultShift : existing ?? Self.defaultShift)
    }

    private static let defaultShift = DispatchShift(start: "09:00", end: "17:00")
    private var weekday: Int { (calendar.component(.weekday, from: date) + 5) % 7 + 1 }
    private func text(_ key: String) -> String { AppStrings.translate(locale, key) }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker(text("contactsTasks.dispatchAssignee"), selection: $worker) {
                        ForEach(members) { member in Text(member.name ?? text("contactsTasks.dispatchAssignee")).tag(member.id) }
                    }
                    Picker(text("contactsTasks.dispatchAvailability"), selection: $mode) {
                        Text(text("contactsTasks.dispatchWorkspaceHours")).tag("workspace")
                        Text(text("contactsTasks.dispatchCustomShift")).tag("shift")
                        Text(text("contactsTasks.dispatchDayOff")).tag("off")
                    }
                    if mode == "shift" {
                        TextField(text("contactsTasks.dispatchShiftStart"), text: Binding(get: { shift.start ?? "" }, set: { shift.start = $0 }))
                        TextField(text("contactsTasks.dispatchShiftEnd"), text: Binding(get: { shift.end ?? "" }, set: { shift.end = $0 }))
                        ForEach(shift.breaks.indices, id: \.self) { index in
                            if shift.breaks.indices.contains(index) {
                                TextField(text("contactsTasks.dispatchBreakStart"), text: breakTime(index, start: true))
                                TextField(text("contactsTasks.dispatchBreakEnd"), text: breakTime(index, start: false))
                                Button(text("contactsTasks.dispatchRemoveBreak")) { shift.breaks.remove(at: index) }
                            }
                        }
                        Button(text("contactsTasks.dispatchAddBreak")) { shift.breaks.append(DispatchWindow(start: "12:00", end: "12:30")) }
                            .disabled(shift.breaks.count >= 6)
                    }
                    if let failure { Text(failure).foregroundStyle(BrandColor.destructive) }
                } header: {
                    Text(AppStrings.translate(locale, "contactsTasks.dispatchShiftWeekday", ["day":
                        TimestampFormat.weekday(date, locale: locale, timeZone: calendar.timeZone)]))
                }
            }
            .navigationTitle(text("contactsTasks.dispatchShifts"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(locale, "common.cancel")) { dismiss() }.disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(locale, "common.save")) {
                        let result = mode == "shift" ? shift : mode == "off" ? DispatchShift() : nil
                        Task { await onSave(worker, weekday, result) }
                    }.disabled(busy)
                }
            }
            .onChange(of: worker) { _, id in
                let existing = members.first { $0.id == id }?.shifts?[String(weekday)]
                mode = existing == nil ? "workspace" : existing?.start == nil ? "off" : "shift"
                shift = existing?.start == nil ? Self.defaultShift : existing ?? Self.defaultShift
            }
        }
    }

    private func breakTime(_ index: Int, start: Bool) -> Binding<String> {
        Binding(get: {
            guard shift.breaks.indices.contains(index) else { return "" }
            let pause = shift.breaks[index]
            return start ? pause.start : pause.end
        }, set: { value in
            guard shift.breaks.indices.contains(index) else { return }
            let pause = shift.breaks[index]
            shift.breaks[index] = start ? DispatchWindow(start: value, end: pause.end)
                : DispatchWindow(start: pause.start, end: value)
        })
    }
}

private struct DispatchPin: Identifiable {
    let id: String
    let title: String
    let coordinate: CLLocationCoordinate2D
}

private struct EditableDispatchWindow: Identifiable {
    let id = UUID()
    var start: Date
    var end: Date
}

@MainActor
private struct DispatchEditor: View {
    let plan: DispatchPlan
    let day: DispatchDay
    let job: DispatchTask
    let booking: DispatchBlock?
    let zone: TimeZone
    let slots: [DispatchBlock]?
    let busy: Bool
    let onFind: (DispatchSlot, DispatchDetail, Date) -> Void
    let onSave: (DispatchEdit, DispatchDetail) -> Void
    let onDetails: (DispatchDetail) -> Void
    let onRemove: () -> Void

    @Environment(\.appLocale) private var locale
    @State private var id: String
    @State private var who: String
    @State private var start: Date
    @State private var duration: String
    @State private var estimate: String
    @State private var windows: [EditableDispatchWindow]
    @State private var visit: Bool
    @State private var confirmed: Bool
    @State private var locked: Bool

    init(plan: DispatchPlan, day: DispatchDay, task: DispatchTask, booking: DispatchBlock?, worker: String?,
         zone: TimeZone, slots: [DispatchBlock]?, busy: Bool, onFind: @escaping (DispatchSlot, DispatchDetail, Date) -> Void,
         onSave: @escaping (DispatchEdit, DispatchDetail) -> Void, onDetails: @escaping (DispatchDetail) -> Void,
         onRemove: @escaping () -> Void) {
        self.plan = plan
        self.day = day
        job = task
        self.booking = booking
        self.zone = zone
        self.slots = slots
        self.busy = busy
        self.onFind = onFind
        self.onSave = onSave
        self.onDetails = onDetails
        self.onRemove = onRemove
        _id = State(initialValue: booking?.id ?? UUID().uuidString.lowercased())
        _who = State(initialValue: booking?.assignee_id ?? task.assigned_user_id ?? worker ?? "")
        _start = State(initialValue: dispatchInstant(booking?.starts_at ?? day.opens_at ?? day.start))
        _duration = State(initialValue: booking.map {
            String(Int(dispatchInstant($0.ends_at).timeIntervalSince(dispatchInstant($0.starts_at)) / 60))
        } ?? task.dispatch_estimate.map(String.init) ?? "")
        _estimate = State(initialValue: task.dispatch_estimate.map(String.init) ?? "")
        _windows = State(initialValue: task.windows.map { EditableDispatchWindow(start: dispatchInstant($0.start), end: dispatchInstant($0.end)) })
        _visit = State(initialValue: booking?.visit ?? false)
        _confirmed = State(initialValue: booking?.address_confirmed ?? false)
        _locked = State(initialValue: booking?.locked ?? false)
    }

    var body: some View {
        let length = Int(duration).flatMap { (5...720).contains($0) ? $0 : nil }
        let estimated = Int(estimate).flatMap { (5...720).contains($0) ? $0 : nil }
        let details = DispatchDetail(task_id: job.id, updated_at: job.updated_at, estimate: estimated,
            windows: windows.map { DispatchWindow(start: dispatchISO($0.start), end: dispatchISO($0.end)) })
        let valid = (estimate.isEmpty || estimated != nil) && windows.allSatisfy { $0.start < $0.end }
        let minDate = dispatchInstant(plan.days.first?.start ?? day.start)
        let maxDate = dispatchInstant(plan.days.last?.end ?? day.end).addingTimeInterval(-1)
        let label = text("contactsTasks.dispatchAssignee")
        let crew = plan.members.map { SelectOption($0.id, title: $0.name ?? label) }
        PaperCard {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel(text(booking == nil ? "contactsTasks.dispatchNewBlock" : "contactsTasks.dispatchEditBlock"))
                Text(job.title).font(.headline)
                SelectField(
                    options: [SelectOption("", title: text("contactsTasks.unassigned"))] + crew,
                    selected: who,
                    label: label,
                    enabled: !busy
                ) {
                    who = $0
                }
                DatePicker(text("contactsTasks.dispatchStart"), selection: $start, in: minDate...maxDate)
                TextField(text("contactsTasks.dispatchDuration"), text: $duration).keyboardType(.numberPad)
                TextField(text("contactsTasks.dispatchEstimate"), text: $estimate).keyboardType(.numberPad)
                Toggle(text("contactsTasks.dispatchOnsite"), isOn: $visit)
                if visit {
                    if let address = job.address {
                        Toggle(text("contactsTasks.dispatchConfirmAddress"), isOn: $confirmed)
                        Text(address).font(.subheadline)
                    } else {
                        Text(text("contactsTasks.dispatchNoAddress"))
                    }
                }
                Toggle(text("contactsTasks.dispatchLock"), isOn: $locked)
                SectionLabel(text("contactsTasks.dispatchWindows"))
                ForEach($windows) { $window in
                    DatePicker(text("contactsTasks.dispatchWindowStart"), selection: $window.start)
                    DatePicker(text("contactsTasks.dispatchWindowEnd"), selection: $window.end)
                    Button(text("contactsTasks.dispatchWindowRemove")) { windows.removeAll { $0.id == window.id } }
                }
                Button(text("contactsTasks.dispatchNewWindow")) {
                    windows.append(EditableDispatchWindow(start: start, end: start.addingTimeInterval(3600)))
                }
                .disabled(windows.count >= 20)
                if let slots {
                    if slots.isEmpty { Text(text("contactsTasks.dispatchSlotEmpty")) }
                    ForEach(slots, id: \.assignee_id) { slot in
                        Button([
                            plan.members.first { $0.id == slot.assignee_id }?.name,
                            dispatchClock(slot.starts_at, zone: zone, locale: locale),
                        ].compactMap { $0 }.joined(separator: " · ")) {
                            who = slot.assignee_id
                            start = dispatchInstant(slot.starts_at)
                        }
                    }
                }
                Button(text("contactsTasks.dispatchFindSlot")) {
                    if let length {
                        onFind(DispatchSlot(id: id, task_id: job.id, duration: length, visit: visit,
                            confirm_address: confirmed, assignee_id: who.isEmpty ? nil : who), details, start)
                    }
                }
                .disabled(busy || !valid || length == nil || (visit && (!confirmed || job.address == nil)))
                Button(text("contactsTasks.dispatchAddDraft")) {
                    guard let length else { return }
                    var edit = DispatchEdit(id: id, task: job)
                    edit.reschedule = booking?.locked == true
                    edit.assignee_id = who
                    edit.starts_at = dispatchISO(start)
                    edit.ends_at = dispatchISO(start.addingTimeInterval(Double(length) * 60))
                    edit.locked = locked
                    edit.visit = visit
                    edit.confirm_address = visit && confirmed
                    onSave(edit, details)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || !valid || who.isEmpty || length == nil || (visit && (!confirmed || job.address == nil)))
                Button(text("contactsTasks.dispatchSaveDetails")) { onDetails(details) }.disabled(busy || !valid)
                if booking != nil { Button(text("contactsTasks.dispatchUnscheduled"), action: onRemove).disabled(busy) }
            }
            .tint(BrandColor.olive)
            .padding(12)
        }
    }

    private func text(_ key: String) -> String { AppStrings.translate(locale, key) }
}
