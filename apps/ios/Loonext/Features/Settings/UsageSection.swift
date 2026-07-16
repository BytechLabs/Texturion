import SwiftUI

/// #85/#95: meters warn at the SAME 80% the usage-alert emails fire at.
private let meterWarnRatio = 0.8

private func periodRange(_ usage: Usage) -> String? {
    guard let start = usage.period_start, let end = usage.period_end,
          let startDate = parseWireTimestamp(start), let endDate = parseWireTimestamp(end)
    else { return nil }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMM d"
    return "\(formatter.string(from: startDate)) to \(formatter.string(from: endDate))"
}

/// "2026-03" → "Mar".
private func monthLabel(_ month: String) -> String {
    let parser = DateFormatter()
    parser.locale = Locale(identifier: "en_US_POSIX")
    parser.dateFormat = "yyyy-MM"
    guard let date = parser.date(from: month) else { return month }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "MMM"
    return formatter.string(from: date)
}

/// Usage (#163): hero tabular figures, the segments meter (petrol, amber at
/// 80%), the overage projection, voice minutes, the free storage line, the
/// 6-month history bars, and the owner-only overage-cap chips.
@MainActor
struct UsageSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var state: LoadState<Usage> = .loading
    @State private var refreshKey = 0

    var body: some View {
        Group {
            switch state {
            case .loading:
                CenteredLoading()
                    .frame(height: 200)
            case .failed(let message):
                CenteredError(message: message) { refreshKey += 1 }
                    .frame(height: 200)
            case .ready(let usage):
                if company.plan == nil || usage.included_segments == 0 {
                    SettingsCard(title: "Usage") {
                        Text(
                            "No usage yet. Finish setup under Billing to pick a plan and "
                                + "get your number."
                        )
                        .font(.callout)
                        .foregroundStyle(.secondary)
                    }
                } else {
                    MessagesCard(usage: usage)
                    if usage.overage_projection.trending_over {
                        ProjectionCard(usage: usage)
                    }
                    VoiceCard(usage: usage)
                    StorageCard(usage: usage)
                    if !usage.history.isEmpty {
                        HistoryCard(history: usage.history)
                    }
                    CapCard(scope: scope, company: company, usage: usage, onCompanyUpdated: onCompanyUpdated)
                    CountingExplainer()
                }
            }
        }
        .task(id: "\(scope.companyId)|\(refreshKey)") {
            if case .ready = state {} else { state = .loading }
            do {
                state = .ready(try await scope.repo.usage(scope.companyId))
            } catch {
                state = .failed(error.userMessage)
            }
        }
    }
}

// MARK: - Messages

private struct MessagesCard: View {
    let usage: Usage

    private var ratio: Double {
        usage.included_segments > 0
            ? Double(usage.used_segments) / Double(usage.included_segments)
            : 0
    }

    var body: some View {
        SettingsCard(title: "Messages") {
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(groupDigits(usage.used_segments))
                    .font(.system(size: 36, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                Text("of \(groupDigits(usage.included_segments)) included messages used")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if let range = periodRange(usage) {
                Text(range)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer().frame(height: 10)
            UsageMeter(ratio: ratio, warning: ratio >= meterWarnRatio)
            Spacer().frame(height: 10)
            if usage.overage_segments > 0 {
                Text(
                    "\(groupDigits(usage.overage_segments)) over your included amount: "
                        + "\(formatCents(usage.projected_overage_cents)) in overage on your "
                        + "next invoice."
                )
                .font(.callout)
            } else {
                Text("No overage this period. $0.00 extra so far.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            let pausePoint = usage.cap_segments
                ?? capSegments(includedSegments: usage.included_segments, multiplier: nil)
            Text(
                "Sending pauses at \(groupDigits(pausePoint)) messages"
                    + (usage.cap_segments == nil
                        ? ", the maximum, which is 10 times your included messages."
                        : ".")
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
            if usage.inbound_segments > 0 {
                Text(
                    "\(groupDigits(usage.inbound_segments)) messages received this period. "
                        + "Inbound is always free."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }
}

/// Petrol meter that flips amber at the 80% warning threshold.
private struct UsageMeter: View {
    let ratio: Double
    let warning: Bool

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color(.secondarySystemFill))
                let fraction = min(max(ratio, 0), 1)
                if fraction > 0 {
                    Capsule()
                        .fill(warning ? BrandColor.overdueAmber : BrandColor.petrol)
                        .frame(width: geo.size.width * CGFloat(fraction))
                }
            }
        }
        .frame(height: 10)
    }
}

private struct ProjectionCard: View {
    let usage: Usage

    var body: some View {
        SettingsCard(title: "Heads up") {
            Text(
                "You're on track to go past what your plan covers — about "
                    + "\(formatCents(usage.overage_projection.projected_overage_cents)) in "
                    + "overage by the end of this period at the current pace. Extra messages "
                    + "bill at the overage rate until sending pauses at your cap."
            )
            .font(.callout)
        }
    }
}

// MARK: - Voice

private struct VoiceCard: View {
    let usage: Usage

    var body: some View {
        let voice = usage.voice
        if voice.included_minutes > 0 || voice.used_minutes > 0 {
            let ratio = voice.included_minutes > 0
                ? Double(voice.used_minutes) / Double(voice.included_minutes)
                : 0
            SettingsCard(title: "Calling minutes") {
                HStack(alignment: .lastTextBaseline, spacing: 10) {
                    Text(groupDigits(voice.used_minutes))
                        .font(.system(size: 28, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                    Text("of \(groupDigits(voice.included_minutes)) included minutes used")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                Spacer().frame(height: 10)
                UsageMeter(ratio: ratio, warning: ratio >= meterWarnRatio)
                Spacer().frame(height: 10)
                if voice.overage_minutes > 0 {
                    Text(
                        "\(groupDigits(voice.overage_minutes)) extra minutes so far: "
                            + "\(formatCents(voice.projected_overage_cents)) on your next invoice."
                    )
                    .font(.callout)
                }
                Text(
                    voice.overage_billed
                        ? "Past your included minutes, extra minutes bill at 1¢ each. Calling "
                            + "pauses at your spending cap, never mid-call."
                        : "Extra minutes aren't billed on your plan."
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct StorageCard: View {
    let usage: Usage

    var body: some View {
        let total = usage.storage.attachments_bytes + usage.storage.mms_bytes
        SettingsCard(title: "Storage") {
            Text(
                "Photos and attachments use \(formatBytes(total)). Storage is free — "
                    + "it never adds to your bill."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}

// MARK: - History

private struct HistoryCard: View {
    let history: [UsageMonth]

    var body: some View {
        let months = Array(history.suffix(6))
        let maxSegments = max(months.map(\.segments).max() ?? 1, 1)
        SettingsCard(
            title: "Last 6 months",
            description: "Outbound messages by calendar month."
        ) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .bottom, spacing: 14) {
                    ForEach(Array(months.enumerated()), id: \.element.month) { index, month in
                        VStack(spacing: 2) {
                            Spacer(minLength: 0)
                            Text(groupDigits(month.segments))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            let fraction = min(max(Double(month.segments) / Double(maxSegments), 0.02), 1)
                            UnevenRoundedRectangle(topLeadingRadius: 4, topTrailingRadius: 4)
                                .fill(BrandColor.petrol.opacity(index == months.count - 1 ? 1 : 0.45))
                                .frame(width: 30, height: CGFloat(fraction) * 84)
                            Text(monthLabel(month.month))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(height: 120, alignment: .bottom)
                    }
                }
            }
        }
    }
}

// MARK: - Overage cap (owner-only)

private struct CapCard: View {
    let scope: SettingsScope
    let company: CompanyView
    let usage: Usage
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var proposed: Double?
    @State private var saving = false
    @State private var error: String?

    private var isOwner: Bool { SettingsRoleGate.canChangeOverageCap(scope.role) }
    private var current: Double { normalizeCapMultiplier(company.overageCapMultiplier) }

    var body: some View {
        SettingsCard(
            title: "Overage cap",
            description: "The cap is a multiple of your included messages. When you hit "
                + "it, sending pauses until you raise it. Nothing is billed past it."
        ) {
            if !isOwner {
                ReadOnlyLine(
                    "Overage cap: \(capLabel(current)) your included messages. "
                        + "Only the account owner can change it."
                )
            } else {
                let presets = capPresets.contains(current) ? capPresets : [current] + capPresets
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(presets, id: \.self) { preset in
                            let selected = preset == current
                            Button {
                                let change = describeCapChange(
                                    current: current,
                                    next: preset,
                                    includedSegments: usage.included_segments
                                )
                                if change.requiresConfirmation {
                                    error = nil
                                    proposed = preset
                                }
                            } label: {
                                Text(capLabel(preset))
                                    .font(.subheadline)
                                    .foregroundStyle(
                                        selected
                                            ? AnyShapeStyle(BrandColor.onPetrolContainer)
                                            : AnyShapeStyle(Color.primary)
                                    )
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(
                                        selected
                                            ? AnyShapeStyle(BrandColor.petrolContainer)
                                            : AnyShapeStyle(Color(.secondarySystemFill)),
                                        in: Capsule()
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(saving)
                        }
                    }
                }
            }
        }
        .sheet(isPresented: Binding(
            get: { proposed != nil },
            set: { open in
                if !open { proposed = nil }
            }
        )) {
            if let next = proposed {
                let change = describeCapChange(
                    current: current,
                    next: next,
                    includedSegments: usage.included_segments
                )
                ConfirmSheet(
                    title: change.title,
                    message: change.summary,
                    confirmLabel: "Set the cap",
                    pending: saving,
                    error: error,
                    onConfirm: { save(next) },
                    onDismiss: { proposed = nil }
                )
            }
        }
    }

    private func save(_ next: Double) {
        saving = true
        error = nil
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["overage_cap_multiplier": .number(next)])
                )
                onCompanyUpdated(updated)
                proposed = nil
                scope.showMessage("Overage cap set to \(capLabel(next)).")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

private struct CountingExplainer: View {
    var body: some View {
        SettingsCard(title: "How messages are counted") {
            Text(
                "A text up to 160 characters counts as one message; longer texts split "
                    + "into 160-character segments (70 with emoji or accents). A photo "
                    + "message counts as three. Incoming messages are always free."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}
