import MapKit
import SwiftUI

/// /tasks Map view (#184/#186) — the field-service differentiator: the day's
/// jobs on a map. The iOS sibling of the Android TaskMap.kt and the web's
/// map-view.tsx.
///
/// Renderer: MapKit's modern SwiftUI `Map` (iOS 17+) over the standard raster
/// style. The standard style is deliberately the same intent in both themes
/// (MapKit renders its own native light/dark tiles); no color-filter inversion.
///
/// Data: GET /v1/tasks?has_location=true drained to the last page — every row
/// embeds the source contact's cached geocode as `contact`, and coordinates are
/// guarded exactly like the web's `taskCoords` (finite, |lat| <= 90,
/// |lng| <= 180) so a bad geocode never plots. Tasks at the same contact fuse
/// into ONE pin whose peek card lists them all; tasks the join filtered out
/// surface as the quiet "N without a location" count instead of blocking the
/// view.
///
/// The map consumes ONLY the assignee chips (assignee + unassigned); the status
/// tabs and due chips do not narrow it (web parity — the map plots open AND done
/// tasks for the picked assignee scope).

// MARK: - Pure partition (unit-tested in TasksMapLogicTests)

/// One map pin: every located task at one contact, plotted once.
struct TaskPinGroup: Identifiable {
    let id: String
    let lat: Double
    let lng: Double
    let contactName: String?
    let tasks: [TaskItem]

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

/// The render model: fused pins plus the count the join left out.
struct TaskMapModel {
    let groups: [TaskPinGroup]
    let located: Int
    let missing: Int
}

/// The web's `taskCoords` guard, ported exactly: only finite, in-range
/// coordinates plot; everything else counts as "without a location".
func taskPinCoords(_ task: TaskItem) -> (lat: Double, lng: Double)? {
    guard let contact = task.contact, let lat = contact.lat, let lng = contact.lng else {
        return nil
    }
    guard lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else { return nil }
    return (lat, lng)
}

/// Partition rows into per-contact pin groups + the unlocated count. Group
/// order follows first appearance so the render is deterministic.
func buildTaskMapModel(_ rows: [TaskItem]) -> TaskMapModel {
    struct Located { let task: TaskItem; let lat: Double; let lng: Double }
    let located = rows.compactMap { task -> Located? in
        guard let coords = taskPinCoords(task) else { return nil }
        return Located(task: task, lat: coords.lat, lng: coords.lng)
    }
    var order: [String] = []
    var buckets: [String: [Located]] = [:]
    for item in located {
        let key = item.task.contact?.id ?? "\(item.lat),\(item.lng)"
        if buckets[key] == nil { order.append(key) }
        buckets[key, default: []].append(item)
    }
    let groups = order.map { key -> TaskPinGroup in
        let pins = buckets[key] ?? []
        let first = pins[0]
        let name = first.task.contact?.name
        return TaskPinGroup(
            id: key,
            lat: first.lat,
            lng: first.lng,
            contactName: (name?.isBlank ?? true) ? nil : name,
            tasks: pins.map(\.task)
        )
    }
    return TaskMapModel(groups: groups, located: located.count, missing: rows.count - located.count)
}

// MARK: - Map view

@MainActor
struct TaskMapView: View {
    let graph: AppGraph
    let companyId: String
    let assigneeChip: String?
    let unassignedChip: Bool
    let refreshKey: Int
    let onOpenTask: @MainActor (String) -> Void

    @State private var state: LoadState<[TaskItem]> = .loading
    @State private var localRefresh = 0

    private var fetchToken: String {
        [companyId, assigneeChip ?? "-", unassignedChip ? "u" : "", String(refreshKey), String(localRefresh)]
            .joined(separator: "|")
    }

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
            case .failed(let message):
                CenteredError(message: message) { localRefresh += 1 }
            case .ready(let rows):
                TaskMapContent(rows: rows, onOpenTask: onOpenTask)
            }
        }
        .task(id: fetchToken) { await reload() }
    }

    /// Drain EVERY page of located tasks so the map plots all pins, not just
    /// the first. One filter set for the whole drain, so the cursor is always
    /// passed back with the exact params that minted it. The page cap is a
    /// runaway guard (40 x 100 rows); the id de-dupe absorbs rows that shift
    /// pages mid-drain. Mirrors Android's drainLocatedTasks.
    ///
    /// `has_location=true` is itself an explicit filter param, so the route's
    /// Open·Mine default never re-applies here — both statuses arrive. This
    /// query is not in the TaskListFilters model (it has no `has_location`
    /// arm), so it is built directly against the shared ApiClient.
    private func reload() async {
        if case .ready = state {} else { state = .loading }
        // `assigneeAll` is UI sugar meaning "no assignee pin"; normalize it away
        // before it reaches the wire (the iOS chip is never "all", but the guard
        // matches the Android drain exactly).
        let assignee = assigneeChip == assigneeAll ? nil : assigneeChip
        let unassigned = unassignedChip && assigneeChip == nil
        var accumulated: [TaskItem] = []
        var cursor: String?
        var pages = 0
        do {
            repeat {
                let page: Page<TaskItem> = try await graph.api.get(
                    "/v1/tasks",
                    query: [
                        "has_location": "true",
                        "assigned_user_id": assignee,
                        "unassigned": unassigned ? "true" : nil,
                        "cursor": cursor,
                        "limit": "100",
                    ],
                    companyId: companyId
                )
                accumulated += page.data
                cursor = page.next_cursor
                pages += 1
            } while cursor != nil && pages < 40
            var seen = Set<String>()
            let deduped = accumulated.filter { seen.insert($0.id).inserted }
            state = .ready(deduped)
        } catch {
            if case .ready = state {} else { state = .failed(error.userMessage) }
        }
    }
}

/// Continental-US fallback (web parity: map-island.tsx) when nothing plots.
private let continentalUSRegion = MKCoordinateRegion(
    center: CLLocationCoordinate2D(latitude: 39.5, longitude: -98.35),
    span: MKCoordinateSpan(latitudeDelta: 55, longitudeDelta: 55)
)

private struct TaskMapContent: View {
    let rows: [TaskItem]
    let onOpenTask: @MainActor (String) -> Void

    @State private var camera: MapCameraPosition = .region(continentalUSRegion)
    @State private var selectedGroupId: String?

    private var model: TaskMapModel { buildTaskMapModel(rows) }

    /// A stable signature of the pin set — the camera refits only when this
    /// changes, so a silent revalidate returning the same rows never yanks the
    /// camera away from where the user panned.
    private var pinsKey: String {
        model.groups.map { "\($0.id)@\($0.lat),\($0.lng)#\($0.tasks.count)" }.joined(separator: "|")
    }

    var body: some View {
        VStack(spacing: 0) {
            if model.located > 0 {
                countLine
            }
            mapBody
        }
        .onChange(of: pinsKey, initial: true) { _, _ in
            camera = fitCamera(model.groups)
        }
    }

    private var countLine: some View {
        HStack(spacing: 5) {
            Image(systemName: "mappin")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(BrandColor.muted500)
            Text(countText)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 24)
        .padding(.bottom, 9)
    }

    private var countText: String {
        var text = "\(model.located) on the map"
        if model.missing > 0 { text += " · \(model.missing) without a location" }
        return text
    }

    private var mapBody: some View {
        ZStack {
            Map(position: $camera, selection: $selectedGroupId) {
                ForEach(model.groups) { group in
                    // #219: the marker is pinned to a theme-INDEPENDENT deep
                    // olive (BrandColor.mapPin), never the adaptive `olive` —
                    // that turns pale lime in dark mode and the pin (balloon +
                    // white glyph) goes illegible on the tiles. Deep olive reads
                    // in BOTH themes.
                    Marker(markerTitle(group), coordinate: group.coordinate)
                        .tint(BrandColor.mapPin)
                        .tag(group.id)
                }
            }
            .mapStyle(.standard)

            if model.groups.isEmpty {
                emptyOverlay
            }

            if let group = model.groups.first(where: { $0.id == selectedGroupId }) {
                VStack {
                    Spacer()
                    PinPeekCard(
                        group: group,
                        onOpenTask: onOpenTask,
                        onDismiss: { selectedGroupId = nil }
                    )
                    .padding(12)
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(BrandColor.inset, lineWidth: 1)
        )
        .padding(.horizontal, 18)
        .padding(.bottom, 18)
    }

    private var emptyOverlay: some View {
        VStack(spacing: 3) {
            Text("No located tasks yet.")
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(
                model.missing > 0
                    ? "\(model.missing) without a location"
                    : "Add an address to a contact and its tasks appear here."
            )
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.muted500)
            .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(BrandColor.paper)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(BrandColor.inset, lineWidth: 1)
        )
        .padding(.horizontal, 32)
    }

    private func markerTitle(_ group: TaskPinGroup) -> String {
        if let single = group.tasks.count == 1 ? group.tasks.first : nil {
            return single.title
        }
        return group.contactName ?? "\(group.tasks.count) tasks"
    }

    /// Fit every pin with padding, a sane single-pin span, and the
    /// continental-US fallback when nothing plots (web parity).
    private func fitCamera(_ groups: [TaskPinGroup]) -> MapCameraPosition {
        let coords = groups.map(\.coordinate)
        if coords.isEmpty { return .region(continentalUSRegion) }
        if coords.count == 1 {
            return .region(MKCoordinateRegion(
                center: coords[0],
                span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
            ))
        }
        let lats = coords.map(\.latitude)
        let lngs = coords.map(\.longitude)
        guard let minLat = lats.min(), let maxLat = lats.max(),
              let minLng = lngs.min(), let maxLng = lngs.max() else {
            return .region(continentalUSRegion)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
        )
        // Pad the span by 1.4x; floor so nearly-coincident pins don't zoom to max.
        let span = MKCoordinateSpan(
            latitudeDelta: max((maxLat - minLat) * 1.4, 0.02),
            longitudeDelta: max((maxLng - minLng) * 1.4, 0.02)
        )
        return .region(MKCoordinateRegion(center: center, span: span))
    }
}

/// The marker peek card, in the paper grammar: one task shows title + contact +
/// an Open action; a multi-task contact lists its tasks, each opening its own
/// detail.
private struct PinPeekCard: View {
    let group: TaskPinGroup
    let onOpenTask: @MainActor (String) -> Void
    let onDismiss: @MainActor () -> Void

    private var single: TaskItem? { group.tasks.count == 1 ? group.tasks.first : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(single?.title ?? (group.contactName ?? "This location"))
                        .font(.golos(13.5, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                        .lineLimit(2)
                    if let subline {
                        Text(subline)
                            .font(.golos(11.5))
                            .foregroundStyle(BrandColor.muted500)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            .padding(.horizontal, 15)
            .padding(.top, 12)

            if let single {
                Button {
                    onOpenTask(single.id)
                } label: {
                    Text("Open task")
                        .font(.golos(12.5, weight: .semibold))
                        .foregroundStyle(BrandColor.olive)
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 15)
                .padding(.top, 8)
                .padding(.bottom, 12)
            } else {
                RowDivider().padding(.top, 10)
                ForEach(Array(group.tasks.prefix(5).enumerated()), id: \.element.id) { index, task in
                    if index > 0 { RowDivider().padding(.horizontal, 15) }
                    Button {
                        onOpenTask(task.id)
                    } label: {
                        Text(task.title)
                            .font(.golos(12.5, weight: .medium))
                            .strikethrough(task.done)
                            .foregroundStyle(task.done ? BrandColor.muted400 : BrandColor.ink)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 15)
                            .padding(.vertical, 10)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if group.tasks.count > 5 {
                    Text("+\(group.tasks.count - 5) more")
                        .font(.golos(11.5))
                        .foregroundStyle(BrandColor.muted500)
                        .padding(.horizontal, 15)
                        .padding(.top, 2)
                        .padding(.bottom, 10)
                }
            }
        }
        .frame(maxWidth: 340)
        .background(BrandColor.paper)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(BrandColor.inset, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.10), radius: 6, y: 2)
    }

    private var subline: String? {
        if single != nil { return group.contactName }
        return "\(group.tasks.count) tasks here"
    }
}
