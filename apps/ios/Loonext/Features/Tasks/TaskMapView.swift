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

/// The web's `taskCoords`, ported exactly (map-types.ts): PREFER the task's OWN
/// geocoded address (a job SITE — "CN Tower, Toronto") over the contact's saved
/// location (where the customer lives — "Calgary"), falling back to the contact
/// only when the task has none. Only finite, in-range coordinates plot;
/// everything else counts as "without a location".
func taskPinCoords(_ task: TaskItem) -> (lat: Double, lng: Double)? {
    if let own = validPin(task.lat, task.lng) { return own }
    return validPin(task.contact?.lat, task.contact?.lng)
}

/// Finite, on-Earth coordinates or nil (a bad geocode must never plot).
private func validPin(_ lat: Double?, _ lng: Double?) -> (lat: Double, lng: Double)? {
    guard let lat = lat, let lng = lng,
          lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 else {
        return nil
    }
    return (lat, lng)
}

/// Partition rows into per-location pin groups + the unlocated count. Group
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
        // Fuse by the RESOLVED coordinate, not the contact: a task now pins at
        // its OWN site, so two jobs for the same customer at different addresses
        // must be two pins (contact grouping collapsed them onto the first).
        let key = "\(item.lat),\(item.lng)"
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

/// Apple Maps driving-directions URL to the pin's exact coordinate — native,
/// always-present, no API key and no per-request cost. Web/Android use Google
/// Maps; iOS uses the platform-native Maps so the crew gets the app they
/// already navigate with. Built from the geocoded coordinate (not the free-text
/// address) so it lands on the job site.
func mapsDirectionsURL(lat: Double, lng: Double) -> URL? {
    URL(string: "http://maps.apple.com/?daddr=\(lat),\(lng)&dirflg=d")
}

// MARK: - Map view

@MainActor
struct TaskMapView: View {
    let graph: AppGraph
    let companyId: String
    let assigneeChip: String?
    let unassignedChip: Bool
    let dueChip: DueChip?
    let q: String
    let refreshKey: Int
    let onOpenTask: @MainActor (String) -> Void

    @State private var state: LoadState<[TaskItem]> = .loading
    @State private var localRefresh = 0

    private var fetchToken: String {
        [
            companyId,
            assigneeChip ?? "-",
            unassignedChip ? "u" : "",
            dueChip?.rawValue ?? "-",
            q,
            String(refreshKey),
            String(localRefresh),
        ].joined(separator: "|")
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
    ///
    /// The due chips and the search box refine it, the way they refine every
    /// other view. They used to be ignored here: the chips stayed lit and the
    /// map quietly plotted every located task regardless, which reads as "these
    /// are the ones due today" when it is not.
    private func reload() async {
        if case .ready = state {} else { state = .loading }
        // `assigneeAll` is UI sugar meaning "no assignee pin"; normalize it away
        // before it reaches the wire (the iOS chip is never "all", but the guard
        // matches the Android drain exactly).
        let assignee = assigneeChip == assigneeAll ? nil : assigneeChip
        let unassigned = unassignedChip && assigneeChip == nil
        let dueFilters = dueChip.map { dueChipFilters($0) } ?? TaskListFilters()
        let trimmedQuery = q.trimmingCharacters(in: .whitespacesAndNewlines)
        let query: String? = trimmedQuery.isEmpty ? nil : trimmedQuery
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
                        "due_before": dueFilters.dueBefore,
                        "due_after": dueFilters.dueAfter,
                        "overdue": dueFilters.overdue ? "true" : nil,
                        "q": query,
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

    @Environment(\.appLocale) private var appLocale

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
                .font(.scaled(11, weight: .medium))
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
        guard model.missing > 0 else {
            return AppStrings.translate(
                appLocale,
                "contactsTasks.mapCounts",
                ["located": String(model.located)]
            )
        }
        return AppStrings.translate(
            appLocale,
            "contactsTasks.mapCountsWithMissing",
            ["located": String(model.located), "missing": String(model.missing)]
        )
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
            // Where you are, against where the jobs are. The permission is
            // asked for on the tap, not on arrival, which is how web and
            // Android do it too: a map that demands your location before
            // showing you anything is a map you close.
            .mapControls {
                MapUserLocationButton()
            }

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

    /// Under the empty-map heading: the count of tasks that CANNOT be plotted
    /// when there is one, and how to get a pin on the map when there is not.
    private var emptySubline: String {
        guard model.missing > 0 else {
            return AppStrings.translate(appLocale, "contactsTasks.mapAddAnAddress")
        }
        return AppStrings.translate(
            appLocale,
            "contactsTasks.mapMissingCount",
            ["missing": String(model.missing)]
        )
    }

    private var emptyOverlay: some View {
        VStack(spacing: 3) {
            Text(AppStrings.translate(appLocale, "contactsTasks.mapNoLocatedTasks"))
                .font(.golos(13, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Text(emptySubline)
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
        if let contactName = group.contactName { return contactName }
        return AppStrings.translate(
            appLocale,
            "contactsTasks.mapMarkerTasks",
            ["count": String(group.tasks.count)]
        )
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

    @Environment(\.openURL) private var openURL
    @Environment(\.appLocale) private var appLocale

    private var single: TaskItem? { group.tasks.count == 1 ? group.tasks.first : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(
                        single?.title
                            ?? group.contactName
                            ?? AppStrings.translate(
                                appLocale, "contactsTasks.mapThisLocation"
                            )
                    )
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
                        .font(.scaled(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted500)
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(AppStrings.translate(appLocale, "common.close"))
            }
            .padding(.horizontal, 15)
            .padding(.top, 12)

            if let single {
                HStack(spacing: 16) {
                    Button {
                        onOpenTask(single.id)
                    } label: {
                        Text(AppStrings.translate(appLocale, "contactsTasks.mapOpenTask"))
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }
                    .buttonStyle(.plain)
                    // Field-crew convenience: navigate straight to the job site
                    // (native Apple Maps, web/Android parity). Uses the pin's
                    // exact coordinate so it lands on the site, not an address guess.
                    if let directions = mapsDirectionsURL(lat: group.lat, lng: group.lng) {
                        Button {
                            openURL(directions)
                        } label: {
                            Text(
                                AppStrings.translate(
                                    appLocale, "contactsTasks.mapDirections"
                                )
                            )
                                .font(.golos(12.5, weight: .semibold))
                                .foregroundStyle(BrandColor.olive)
                        }
                        .buttonStyle(.plain)
                    }
                }
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
                    Text(
                        AppStrings.translate(
                            appLocale,
                            "contactsTasks.mapMore",
                            ["count": String(group.tasks.count - 5)]
                        )
                    )
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
        return AppStrings.translate(
            appLocale,
            "contactsTasks.mapTasksHere",
            ["count": String(group.tasks.count)]
        )
    }
}
