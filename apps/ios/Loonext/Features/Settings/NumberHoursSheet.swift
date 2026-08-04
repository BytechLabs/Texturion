import SwiftUI

/// #307 — "When this line is open".
///
/// Hand-port of `apps/web/src/components/settings/number-hours-dialog.tsx` and
/// `NumberHoursDialog.kt`. A Vancouver line and a Toronto line in one
/// workspace shared a clock, so the away reply was wrong for one of them and
/// no screen could fix it.
///
/// A SECOND sheet rather than five more rows in "How this line answers". That
/// one is already five fields; a timezone picker and a seven-row week would
/// double it, and the two questions get asked at different times.
///
/// Inheritance is stated for the WEEK, not per day. `business_hours` is one
/// column, so a line either keeps its own week or follows the workspace's. A
/// per-day badge would imply you can take Tuesday from the workspace and keep
/// Monday, which the storage cannot express and the resolver would not honour.
struct NumberHoursSheet: View {
    let scope: SettingsScope
    let number: PhoneNumberSummary
    let onDismiss: @MainActor () -> Void

    @State private var loaded: LoadState<NumberIdentity> = .loading
    @State private var retryKey = 0
    @State private var zone = ""
    @State private var days: [DayForm] = []
    @State private var initialDays: [DayForm] = []
    @State private var picking = false
    @State private var pending = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    Text(
                        "The after-hours reply on this number follows this clock. "
                            + "Leave it alone and it follows your workspace."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                    switch loaded {
                    case .loading:
                        ProgressView()
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    case .failed(let message):
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .padding(.top, 12)
                        Button("Try again") { retryKey += 1 }
                            .buttonStyle(.bordered)
                            .padding(.top, 8)
                    case .ready(let identity):
                        inheritHeader(
                            title: "Timezone",
                            inherited: identity.timezone.inherited,
                            restore: { restore("timezone") }
                        )
                        Button(zone.isEmpty ? "Choose a timezone" : zone) {
                            picking = true
                        }
                        .disabled(pending)

                        inheritHeader(
                            title: "Open hours",
                            inherited: identity.business_hours.inherited,
                            restore: { restore("business_hours") }
                        )
                        ForEach($days, id: \.weekday) { $day in
                            WeekdayRow(day: $day, enabled: !pending)
                        }
                    }
                    InlineError(error)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
            .navigationTitle("When this line is open")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { onDismiss() }
                        .disabled(pending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(pending ? "Saving…" : "Save") { save() }
                        .disabled(!isReady || pending)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(pending)
        .sheet(isPresented: $picking) {
            TimezonePickerSheet(current: zone) { picked in
                zone = picked
                picking = false
            } onDismiss: {
                picking = false
            }
        }
        .task(id: "\(number.id)|\(retryKey)") {
            loaded = .loading
            do {
                let identity = try await scope.repo.numberIdentity(
                    scope.companyId,
                    numberId: number.id
                )
                seed(identity)
                loaded = .ready(identity)
            } catch {
                loaded = .failed(error.userMessage)
            }
        }
    }

    /// One setting's name, and whether this line follows the workspace for it.
    @ViewBuilder
    private func inheritHeader(
        title: String,
        inherited: Bool,
        restore: @escaping @MainActor () -> Void
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title).font(.subheadline.weight(.medium))
            Spacer()
            if inherited {
                Text("Same as your workspace")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                Button("Use the workspace's") { restore() }
                    .font(.caption)
                    .disabled(pending)
            }
        }
        .padding(.top, 14)
    }

    private var isReady: Bool {
        if case .ready = loaded { return true }
        return false
    }

    /// The grid starts at the hours this line actually keeps.
    private func seed(_ identity: NumberIdentity) {
        zone = identity.timezone.value ?? ""
        let week = toFormState(identity.business_hours.value ?? [:])
        days = week
        initialDays = week
    }

    /// Send null for ONE setting: that is what "use the workspace's" means.
    private func restore(_ field: String) {
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                let next = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: .object([field: .null])
                )
                seed(next)
                loaded = .ready(next)
            } catch {
                self.error = error.userMessage
            }
        }
    }

    /// Only what CHANGED.
    ///
    /// Posting the resolved week back would turn an inherited clock into an
    /// override just by opening this sheet, and the line would stop following
    /// the workspace with nothing looking wrong until somebody changed the
    /// workspace hours and one number ignored them.
    private func patchBody(_ current: NumberIdentity) -> JSONValue {
        var body: [String: JSONValue] = [:]
        if zone != (current.timezone.value ?? "") {
            body["timezone"] = .string(zone)
        }
        if days != initialDays {
            var week: [String: JSONValue] = [:]
            for day in days where day.enabled {
                week[day.weekday] = .object([
                    "open": .string(day.open),
                    "close": .string(day.close),
                ])
            }
            body["business_hours"] = .object(week)
        }
        return .object(body)
    }

    private func save() {
        guard case .ready(let current) = loaded else { return }
        Task { @MainActor in
            pending = true
            error = nil
            defer { pending = false }
            do {
                _ = try await scope.repo.setNumberIdentity(
                    scope.companyId,
                    numberId: number.id,
                    body: patchBody(current)
                )
                onDismiss()
            } catch {
                self.error = error.userMessage
            }
        }
    }
}
