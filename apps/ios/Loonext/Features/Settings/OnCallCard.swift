import SwiftUI

/// #244 — who is holding the phone tonight.
///
/// Design notes, and the principles behind them:
///
/// - **The empty state is the default, and it states the CONSEQUENCE.** Every
///   existing workspace has no rota, so a blank card would read as a gap
///   somebody forgot to fill. What an owner needs to know is what "nobody on
///   call" costs them — everyone gets woken. *Applying: Loss Aversion — frame
///   the choice around what the crew is currently losing, their nights.*
/// - **Three presets, not a datetime builder.** The real decision is "Dana has
///   tonight". *Applying: Chunking & Smart Defaults.*
/// - **The escalation promise is on the card.** Putting one person on call is
///   only a good decision if the owner knows what happens when that person
///   sleeps through it.
/// - **Ending a shift takes one tap and no confirmation.** It is instantly
///   reversible and it FAILS SAFE — with nobody on call everyone is woken,
///   which is the pre-#244 behaviour. *Applying: Ethical Friction, on the
///   irreversible edge only, and this edge is the opposite of that.*
///
/// Mirrors the web and Android cards; `OnCallCopyTests` keeps the sentences
/// identical.
@MainActor
struct OnCallCard: View {
    let scope: SettingsScope

    @State private var loaded = false
    @State private var shifts: [OnCallShift] = []
    @State private var roster: [Member] = []
    @State private var chosen: String?
    @State private var busy = false

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    private var live: OnCallShift? {
        let now = Date().timeIntervalSince1970
        return shifts.first {
            parseIso($0.starts_at) <= now && parseIso($0.ends_at) > now
        }
    }

    private var upcoming: [OnCallShift] {
        shifts.filter { $0.id != live?.id }
    }

    var body: some View {
        SettingsCard(title: "On call", description: OnCall.escalation) {
            if !loaded {
                Text("Checking the rota…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else if let live {
                HStack {
                    Text(OnCall.line(name(of: live.user_id), until: until(live.ends_at)))
                        .font(.subheadline)
                    Spacer(minLength: 8)
                    if canEdit {
                        Button("End shift") { end(live.id) }
                            .font(.footnote)
                            .disabled(busy)
                    }
                }
            } else {
                // Not "no shifts". The sentence says what the state costs.
                Text(OnCall.nobody)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            if !upcoming.isEmpty {
                Divider().padding(.vertical, 6)
                ForEach(upcoming) { shift in
                    HStack {
                        Text(
                            "\(name(of: shift.user_id)) · \(until(shift.starts_at)) → "
                                + until(shift.ends_at)
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        Spacer(minLength: 8)
                        if canEdit {
                            Button("Remove") { end(shift.id) }
                                .font(.footnote)
                                .disabled(busy)
                        }
                    }
                }
            }

            if canEdit {
                Divider().padding(.vertical, 8)
                Text("Put somebody on call")
                    .font(.caption.weight(.medium))
                Picker(
                    "Who",
                    selection: Binding(
                        get: { chosen ?? roster.first?.user_id ?? "" },
                        set: { chosen = $0 }
                    )
                ) {
                    ForEach(roster) { member in
                        Text(member.display_name).tag(member.user_id)
                    }
                }
                .pickerStyle(.menu)
                .disabled(roster.isEmpty)

                HStack(spacing: 6) {
                    ForEach(OnCall.presets, id: \.key) { preset in
                        Button(preset.label) { put(preset.key) }
                            .font(.footnote)
                            .buttonStyle(.bordered)
                            .disabled(busy || roster.isEmpty)
                    }
                }
                Text(
                    OnCall.presets
                        .map { "\($0.label): \($0.detail)" }
                        .joined(separator: " · ")
                )
                .font(.caption2)
                .foregroundStyle(.secondary)
            } else {
                Text(OnCall.readOnly)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 6)
            }
        }
        .task {
            if let members = try? await scope.repo.members(scope.companyId) {
                roster = members.data
            }
            await reload()
        }
    }

    private func name(of userId: String) -> String {
        roster.first { $0.user_id == userId }?.display_name ?? "Someone"
    }

    private func reload() async {
        if let response = try? await scope.repo.onCallShifts(scope.companyId) {
            shifts = response.data
        }
        loaded = true
    }

    private func put(_ preset: String) {
        guard !busy, let target = chosen ?? roster.first?.user_id else { return }
        busy = true
        Task {
            do {
                // `secondsFromGMT(for:)`, NOT the zone's standard offset: that
                // would put every shift out by an hour through the summer — a
                // "6pm" window starting at 5pm, silently, half the year.
                let at = Date()
                let offset = TimeZone.current.secondsFromGMT(for: at) / 60
                let window = OnCall.window(preset, now: at, offsetMinutes: offset)
                _ = try await scope.repo.createOnCallShift(
                    scope.companyId,
                    body: OnCallShiftBody(
                        user_id: target,
                        starts_at: window.startsAt,
                        ends_at: window.endsAt
                    )
                )
                await reload()
                scope.showMessage("\(name(of: target)) is on call")
            } catch {
                scope.showMessage(error.userMessage)
            }
            busy = false
        }
    }

    private func end(_ id: String) {
        guard !busy else { return }
        busy = true
        Task {
            do {
                try await scope.repo.endOnCallShift(scope.companyId, id: id)
                await reload()
            } catch {
                scope.showMessage(error.userMessage)
            }
            busy = false
        }
    }
}

/// Epoch seconds from an ISO instant, or 0 when it will not parse.
private func parseIso(_ value: String) -> TimeInterval {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let parsed = formatter.date(from: value) {
        return parsed.timeIntervalSince1970
    }
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.date(from: value)?.timeIntervalSince1970 ?? 0
}

/// "Sat 8:00 AM" — the crew's own clock, because that is when they wake up.
private func until(_ iso: String) -> String {
    let formatter = DateFormatter()
    formatter.dateFormat = "EEE h:mm a"
    return formatter.string(from: Date(timeIntervalSince1970: parseIso(iso)))
}
