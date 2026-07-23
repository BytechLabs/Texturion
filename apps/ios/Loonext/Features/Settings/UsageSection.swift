import SwiftUI

/// #178 fair-use policy link — the same page the web and Android open.
private let fairUseUrl = "https://loonext.com/legal/fair-use"

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

// MARK: - #178 presentation decisions (mirror of Android SettingsLogic.kt)

/// Which card the server's `status` renders. Unknown values render the calm
/// 'quiet' state, so a lagging build never surfaces a meter it shouldn't.
enum UsagePresentation: Equatable {
    case quiet
    case pacing
    case capped
}

func usagePresentation(_ status: String) -> UsagePresentation {
    switch status {
    case UsageStatus.capped: .capped
    case UsageStatus.pacing: .pacing
    default: .quiet
    }
}

/// #178: which meter runs hot in the 'pacing' state, named plainly. Compares
/// each meter's use of its own allowance; names both only when both are past
/// their included amounts. Always a plural noun phrase, so "are" follows.
func pacingSubject(_ usage: Usage) -> String {
    let messages = usage.included_segments > 0
        ? Double(usage.used_segments) / Double(usage.included_segments)
        : 0
    let minutes = usage.voice.included_minutes > 0
        ? Double(usage.voice.used_minutes) / Double(usage.voice.included_minutes)
        : 0
    if messages >= 1.0 && minutes >= 1.0 { return "Messages and calling minutes" }
    if minutes > messages { return "Calling minutes" }
    return "Messages"
}

/// #178 'capped': how far along the owner-set spending cap the hotter meter is.
func capUseRatio(_ usage: Usage) -> Double {
    let messages: Double
    if let cap = usage.cap_segments, cap > 0 {
        messages = Double(usage.used_segments) / Double(cap)
    } else {
        messages = 0
    }
    let minutes: Double
    if let cap = usage.voice.cap_minutes, cap > 0 {
        minutes = Double(usage.voice.used_minutes) / Double(cap)
    } else {
        minutes = 0
    }
    return max(messages, minutes)
}

/// Whole-percent cap use for display, clamped to 100.
func capUsePercent(_ usage: Usage) -> Int {
    min(max(Int(capUseRatio(usage) * 100), 0), 100)
}

/// Usage (#178): the fair-use section. The server's `status` decides everything
/// the customer sees, so product and marketing say the same thing:
///
///  - 'quiet' (the overwhelming default): one calm line and the fair-use
///    policy link. No meters, no "X of Y", no progress bars anywhere.
///  - 'pacing': the early, specific heads-up naming what runs hot and the
///    projected extra, with the spending cap framed as the protection it is.
///  - 'capped': how close the owner-set cap is and what pauses there.
///
/// The raw numbers, 6-month history, and storage live behind the owner-only
/// "Details" affordance, collapsed by default in every status. The owner cap
/// control stays reachable in all three.
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
                    let isOwner = SettingsRoleGate.canChangeOverageCap(scope.role)
                    switch usagePresentation(usage.status) {
                    case .capped:
                        CappedCard(usage: usage)
                    case .pacing:
                        PacingCard(usage: usage)
                    case .quiet:
                        QuietCard()
                    }
                    // The owner's cap control is reachable in every status.
                    // Members only meet the cap when it actually matters
                    // (pacing/capped); in the quiet state they see nothing that
                    // reads like a limit.
                    if isOwner || usage.status != UsageStatus.quiet {
                        CapCard(
                            scope: scope,
                            company: company,
                            usage: usage,
                            onCompanyUpdated: { updated in
                                onCompanyUpdated(updated)
                                // The cap lives in both views. Revalidate the
                                // usage so the pause point reflects the new
                                // multiplier.
                                refreshKey += 1
                            }
                        )
                    }
                    if isOwner {
                        DetailsCard(usage: usage)
                    }
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

// MARK: - Quiet (the calm default)

/// 'quiet': the calm fair-use line, echoing the marketing promise verbatim.
private struct QuietCard: View {
    var body: some View {
        SettingsCard(title: "Usage") {
            Text(
                "Well within fair use this month. Almost every crew stays inside "
                    + "what their plan covers, and we reach out early if usage ever "
                    + "paces past it."
            )
            .font(.callout)
            Spacer().frame(height: 4)
            Button("See the fair use policy") { openExternal(fairUseUrl) }
                .buttonStyle(.borderless)
                .tint(BrandColor.olive)
        }
    }
}

// MARK: - Pacing (the early heads-up)

/// 'pacing': the early heads-up. Specific about what and how much, never alarmed.
private struct PacingCard: View {
    let usage: Usage

    var body: some View {
        let projected = usage.overage_projection.projected_overage_cents
        SettingsCard(title: "Heads up") {
            Text(
                "\(pacingSubject(usage)) are pacing past what your plan includes "
                    + "this period."
                    + (projected > 0
                        ? " At the current pace, that adds about \(formatCents(projected)) "
                            + "in overage to your next invoice."
                        : "")
            )
            .font(.callout)
            Spacer().frame(height: 8)
            Text(
                "This is the early flag, not a surprise bill. Your spending cap "
                    + "below is the backstop: sending and calling pause there, and "
                    + "nothing bills past it."
            )
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Capped (approaching or reached)

/// 'capped': the owner-set cap is close or reached. Plain about what pauses.
private struct CappedCard: View {
    let usage: Usage

    var body: some View {
        let reached = capUseRatio(usage) >= 1.0
        SettingsCard(
            title: reached ? "At your spending cap" : "Approaching your spending cap"
        ) {
            Text(
                reached
                    ? "You've reached the spending cap you set. Sending and calling "
                        + "are paused until you raise the cap. Nothing bills past it."
                    : "You've used \(capUsePercent(usage))% of the spending cap you "
                        + "set. At the cap, sending and calling pause until you "
                        + "raise it. Nothing bills past it."
            )
            .font(.callout)
        }
    }
}

// MARK: - Spending cap (owner sets it; members see it read-only when it matters)

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
            title: "Spending cap",
            description: "Your protection against surprise bills. The cap is a "
                + "multiple of your included usage. At the cap, sending and calling "
                + "pause until you raise it. Nothing bills past it."
        ) {
            if !isOwner {
                ReadOnlyLine(
                    "Spending cap: \(capLabel(current)) your included usage. "
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
                                            ? AnyShapeStyle(BrandColor.muted900)
                                            : AnyShapeStyle(Color.primary)
                                    )
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 7)
                                    .background(
                                        selected
                                            ? AnyShapeStyle(BrandColor.avatarTint)
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
                scope.showMessage("Spending cap set to \(capLabel(next)).")
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

// MARK: - Details (owner-only, collapsed by default in every status)

/// The owner-only "Details" affordance (#178): a quiet expandable card,
/// collapsed by default in every status, holding the raw numbers, the 6-month
/// history bars, storage, and the counting explainer. Explicitly opened, so
/// "X of Y" is welcome inside.
private struct DetailsCard: View {
    let usage: Usage

    @State private var expanded = false

    var body: some View {
        SettingsCard(title: "Details", description: "The raw numbers, month by month, if you want them.") {
            Button {
                expanded.toggle()
            } label: {
                HStack {
                    Text(expanded ? "Hide the numbers" : "Show the numbers")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrandColor.olive)
                    Spacer(minLength: 0)
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)
            if expanded {
                VStack(alignment: .leading, spacing: 14) {
                    MessagesDetail(usage: usage)
                    VoiceDetail(usage: usage)
                    StorageDetail(usage: usage)
                    if !usage.history.isEmpty {
                        HistoryDetail(history: usage.history)
                    }
                    CountingDetail()
                }
                .padding(.top, 12)
            }
        }
    }
}

private struct MessagesDetail: View {
    let usage: Usage

    var body: some View {
        let range = periodRange(usage)
        let pausePoint = usage.cap_segments
            ?? capSegments(includedSegments: usage.included_segments, multiplier: nil)
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("Messages")
            DetailLine(
                "\(groupDigits(usage.used_segments)) of "
                    + "\(groupDigits(usage.included_segments)) included messages used"
                    + (range.map { ", \($0)" } ?? "") + "."
            )
            if usage.overage_segments > 0 {
                DetailLine(
                    "\(groupDigits(usage.overage_segments)) over your included amount: "
                        + "\(formatCents(usage.projected_overage_cents)) in overage on your "
                        + "next invoice."
                )
            } else {
                DetailLine("No overage this period. $0.00 extra so far.")
            }
            DetailLine(
                "Sending pauses at \(groupDigits(pausePoint)) messages"
                    + (usage.cap_segments == nil
                        ? ", the maximum, which is 10 times your included messages."
                        : ".")
            )
            if usage.inbound_segments > 0 {
                DetailLine(
                    "\(groupDigits(usage.inbound_segments)) messages received this period. "
                        + "Inbound is always free."
                )
            }
        }
    }
}

private struct VoiceDetail: View {
    let usage: Usage

    var body: some View {
        let voice = usage.voice
        if voice.included_minutes > 0 || voice.used_minutes > 0 {
            VStack(alignment: .leading, spacing: 2) {
                DetailHeader("Calling minutes")
                DetailLine(
                    "\(groupDigits(voice.used_minutes)) of "
                        + "\(groupDigits(voice.included_minutes)) included minutes used."
                )
                if voice.overage_minutes > 0 {
                    DetailLine(
                        "\(groupDigits(voice.overage_minutes)) extra minutes so far: "
                            + "\(formatCents(voice.projected_overage_cents)) on your next invoice."
                    )
                }
                DetailLine(
                    voice.overage_billed
                        ? "Past your included minutes, extra minutes bill at 1¢ each. Calling "
                            + "pauses at your spending cap, never mid-call."
                        : "Extra minutes aren't billed on your plan."
                )
            }
        }
    }
}

private struct StorageDetail: View {
    let usage: Usage

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("Storage")
            DetailLine(
                "Photos and attachments use "
                    + "\(formatBytes(usage.storage.attachments_bytes + usage.storage.mms_bytes)). "
                    + "Storage is free and never adds to your bill."
            )
        }
    }
}

private struct HistoryDetail: View {
    let history: [UsageMonth]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("Last 6 months")
            DetailLine("Outbound messages by calendar month.")
            Spacer().frame(height: 8)
            HistoryBars(history: history)
        }
    }
}

private struct CountingDetail: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("How messages are counted")
            DetailLine(
                "A text up to 160 characters counts as one message; longer texts "
                    + "split into 160-character segments (70 with emoji or accents). "
                    + "A photo message counts as three. Incoming messages are always "
                    + "free."
            )
        }
    }
}

private struct DetailHeader: View {
    let label: String

    init(_ label: String) {
        self.label = label
    }

    var body: some View {
        Text(label)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(Color.primary)
    }
}

private struct DetailLine: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 1)
    }
}

private struct HistoryBars: View {
    let history: [UsageMonth]

    var body: some View {
        let months = Array(history.suffix(6))
        let maxSegments = max(months.map(\.segments).max() ?? 1, 1)
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
                            .fill(BrandColor.olive.opacity(index == months.count - 1 ? 1 : 0.45))
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
