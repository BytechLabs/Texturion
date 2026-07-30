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
                    // #426: the question that comes before cancelling. Above
                    // the cap because "are my texts landing" outranks "what
                    // will this cost" for somebody already worried.
                    DeliveryCard(usage: usage)
                    // Reachable in every status, for every role, as on the web.
                    // #178 says usage is never a wall, and this is not one: it
                    // is a plain line saying what the cap is and who can change
                    // it. Hiding it from members until they were already pacing
                    // meant the one question a member has about the bill had no
                    // answer on the calm day.
                    Group {
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

    @State private var pending: Double = 1
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
                // A slider, matching the web and Android: the multiple is the
                // mechanism but the pause point is the decision, so it reads
                // largest and counts as you drag. Presets could not express
                // 4.5x at all, which is the parity gap this closes.
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("SENDING PAUSES AT")
                                .font(.golos(10.5, weight: .semibold))
                                .foregroundStyle(BrandColor.muted500)
                            Text(groupDigits(capSegments(
                                includedSegments: usage.included_segments,
                                multiplier: pending
                            )))
                            .font(.golos(26, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            Text("messages this period")
                                .font(.golos(12))
                                .foregroundStyle(BrandColor.muted500)
                        }
                        Spacer()
                        Text(capLabel(pending))
                            .font(.golos(12.5, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    }

                    // Half-multiples: fine enough to land where you want,
                    // coarse enough to aim at with a thumb.
                    Slider(
                        value: $pending,
                        in: 1...maxCapMultiplier,
                        step: 0.5
                    )
                    .tint(BrandColor.olive)
                    .disabled(saving)

                    HStack {
                        Text("1x included")
                        Spacer()
                        Text("\(capLabel(maxCapMultiplier)) max")
                    }
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)

                    // Dragging proposes; it never saves. Money changes on purpose.
                    if pending != current {
                        Text(describeCapChange(
                            current: current,
                            next: pending,
                            includedSegments: usage.included_segments
                        ).summary)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.ink)

                        HStack(spacing: 10) {
                            Button(saving ? "Saving…" : "Save cap") { save(pending) }
                                .buttonStyle(.borderedProminent)
                                .disabled(saving)
                            Button("Cancel") { pending = current }
                                .buttonStyle(.plain)
                                .foregroundStyle(BrandColor.muted700)
                                .disabled(saving)
                        }
                    }

                    if let error {
                        Text(error)
                            .font(.golos(12.5))
                            .foregroundStyle(BrandColor.destructive)
                    }
                }
                .onAppear { pending = current }
                .onChange(of: current) { _, value in pending = value }
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
                    if !usage.ai.isEmpty {
                        AiUsageDetail(features: usage.ai)
                    }
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

    private var storageRows: [(label: String, bytes: Int)] {
        let storage = usage.storage
        var rows: [(label: String, bytes: Int)] = [
            ("Attachments received", storage.received_media_bytes),
            ("Attachments sent", storage.sent_media_bytes),
            ("Files on notes", storage.attachments_bytes),
            ("Voicemail recordings", storage.voicemail_bytes),
        ]
        if storage.other_bytes > 0 {
            rows.append(("Other files", storage.other_bytes))
        }
        return rows
    }

    var body: some View {
        // The old line added two figures together and called the result
        // "photos and attachments", which left voicemail recordings out of the
        // total entirely and called an audio message a photo. Every kind is
        // named now, with a catch-all that appears only when something is
        // unaccounted for. Deliberately not a meter: storage is free and
        // capless, so there is no maximum to fill.
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("Storage")
            DetailLine(
                "\(formatBytes(usage.storage.totalStored)) stored. "
                    + "Free on every plan, no caps."
            )
            ForEach(storageRows, id: \.label) { row in
                HStack {
                    Text(row.label)
                    Spacer()
                    Text(formatBytes(row.bytes))
                }
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted600)
            }
        }
    }
}

/// What Lou has done this month, per feature.
///
/// These limits were enforced server-side and shown nowhere: a crew reached one
/// mid-sentence, got a message saying that one thing had stopped, and had no
/// way to have seen it coming. Unlike storage this IS a meter, because an AI
/// limit is a hard stop rather than a fair-use line.
private struct AiUsageDetail: View {
    let features: [AiFeatureUsage]

    /// #431: the outcome line, or nil where there is honestly nothing to say.
    private func outcomeLine(_ feature: AiFeatureUsage) -> String? {
        guard feature.enabled else { return nil }
        if feature.outcomesRecorded > 0 {
            return feature.outcomes
                .map { "\($0.count) \($0.label)" }
                .joined(separator: " · ")
        }
        if feature.used > 0 {
            return "Nothing recorded yet about whether these got used."
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader("Lou this month")
            DetailLine(
                "What Lou has drafted, filled in, and written down. "
                    + "Each resets on the 1st."
            )
            ForEach(features) { feature in
                let pct = feature.cap > 0
                    ? min(100, Int((Double(feature.used) / Double(feature.cap)) * 100))
                    : 0
                // Say it before it bites, where the number already lives.
                let nearCap = feature.enabled && pct >= 80
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(feature.label.prefix(1).uppercased() + feature.label.dropFirst())
                        Spacer()
                        Text(feature.enabled ? "\(feature.used) of \(feature.cap)" : "Off")
                    }
                    .font(.golos(12.5))
                    .foregroundStyle(BrandColor.muted600)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(BrandColor.inset)
                            Capsule()
                                .fill(nearCap ? BrandColor.overdueAmber : BrandColor.olive)
                                .frame(
                                    width: geo.size.width
                                        * (feature.enabled ? CGFloat(pct) / 100 : 0)
                                )
                        }
                    }
                    .frame(height: 6)
                    if nearCap {
                        Text("Close to this month's limit. It resets on the 1st.")
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.overdueAmber)
                    }
                    // #431 ask 3: what it bought, under what it cost. An empty
                    // list is NOT zeroes — a feature used 40 times with nothing
                    // recorded is an instrumentation gap, and "0 sent as written"
                    // would report that gap as a verdict on the quality.
                    if let line = outcomeLine(feature) {
                        Text(line)
                            .font(.golos(12))
                            .foregroundStyle(BrandColor.muted600)
                    }
                }
                .padding(.top, 6)
            }
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

/// Human name for a destination bucket.
private func countryLabel(_ code: String) -> String {
    switch code {
    case "US": "United States"
    case "CA": "Canada"
    default: "Elsewhere"
    }
}

/// #426 — "are my texts arriving?"
///
/// The largest single reason buyers leave a texting provider is the suspicion
/// that messages are not landing, and a customer had no way to check. The
/// suspicion is what moves them, and it was unfalsifiable, so it won by default.
///
/// SMALL NUMBERS LIE, so below the sample floor the API sends a nil rate and
/// this shows COUNTS. One failure out of forty reads as 2.5%, which looks
/// alarming and usually means a disconnected number — manufacturing the exact
/// worry the figure exists to remove.
///
/// CARRIER-REPORTED is the honest name: a receipt means a carrier acknowledged
/// handoff, not that a person read it.
private struct DeliveryCard: View {
    let usage: Usage

    var body: some View {
        if let delivery = usage.delivery,
           delivery.delivered + delivery.failed + delivery.pending > 0 {
            let countries = delivery.by_country.filter {
                $0.delivered + $0.failed + $0.pending > 0
            }
            SettingsCard(
                title: "Are your texts arriving?",
                description: "Carrier-reported delivery this period. A carrier confirming "
                    + "it took the message is not the same as someone reading it, so this "
                    + "is the most we can honestly tell you."
            ) {
                Text(summaryLine(delivery))
                    .font(.golos(13.5))
                    .foregroundStyle(BrandColor.ink)

                // Only split when there IS more than one destination — a
                // single-country shop does not need a row telling it every
                // text went to Canada.
                if countries.count > 1 {
                    Spacer().frame(height: 8)
                    ForEach(countries, id: \.country) { row in
                        ReadOnlyLine("\(countryLabel(row.country)): \(rateText(row))")
                    }
                }

                Spacer().frame(height: 8)
                ReadOnlyLine(
                    delivery.failed > 0
                        ? "A text that doesn't get through is usually a disconnected "
                            + "number or a handset that has been off for days. Open the "
                            + "conversation and the message itself says what the carrier "
                            + "reported."
                        : "Nothing has bounced this period."
                )
            }
        }
    }

    private func summaryLine(_ d: UsageDelivery) -> String {
        var parts = ["\(d.delivered) confirmed delivered"]
        if d.failed > 0 { parts.append("\(d.failed) didn't get through") }
        if d.pending > 0 { parts.append("\(d.pending) still on their way") }
        return parts.joined(separator: " · ")
    }

    private func rateText(_ row: UsageDeliveryCountry) -> String {
        guard let rate = row.rate else {
            return "\(row.delivered) of \(row.delivered + row.failed)"
        }
        return "\(Int((rate * 100).rounded()))%"
    }
}
