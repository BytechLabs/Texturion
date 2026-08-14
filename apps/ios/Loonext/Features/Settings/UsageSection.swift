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

/// #178: which meter runs hot in the 'pacing' state, as a catalogue KEY.
///
/// Compares each meter's use of its own allowance; names both only when both are
/// past their included amounts. Always a plural noun phrase, so "are" follows.
///
/// #228 split the decision from the words, the same way `pacingSubjectKey` does
/// on Android: the rule about which meter is hotter is testable arithmetic and
/// has no language, and a function that returned an English phrase could only be
/// asserted against that phrase. The key names are Android's exactly.
func pacingSubjectKey(_ usage: Usage) -> String {
    let messages = usage.included_segments > 0
        ? Double(usage.used_segments) / Double(usage.included_segments)
        : 0
    let minutes = usage.voice.included_minutes > 0
        ? Double(usage.voice.used_minutes) / Double(usage.voice.included_minutes)
        : 0
    if messages >= 1.0 && minutes >= 1.0 { return "settingsMore.pacingBoth" }
    if minutes > messages { return "settingsMore.pacingMinutes" }
    return "settingsMore.pacingMessages"
}

/// The same answer in words, for one locale.
///
/// `locale` is defaulted so a caller with no reader in scope — every one of the
/// parity assertions in `SettingsLogicTests` — keeps reading English, which is
/// what all of them did before there was a choice. Android's twin is defaulted
/// for the same reason.
func pacingSubject(_ usage: Usage, locale: String? = nil) -> String {
    AppStrings.translate(locale, pacingSubjectKey(usage))
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

    @Environment(\.appLocale) private var appLocale

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
                    SettingsCard(
                        title: AppStrings.translate(appLocale, "settingsMore.usageTitle")
                    ) {
                        Text(AppStrings.translate(appLocale, "settingsMore.usageNone"))
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
                    // #595: the same numbers, as a file for whoever does the
                    // books. Last on the screen because pulling a file is
                    // occasional and deliberate, and mounted unconditionally
                    // because the card asks `billing.manage` for itself — a
                    // capability question answered in one place rather than two.
                    UsageExportCard(scope: scope)
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
    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(title: t("settingsMore.usageTitle")) {
            Text(t("settingsMore.usageQuiet"))
                .font(.callout)
            Spacer().frame(height: 4)
            Button(t("settingsMore.seeFairUse")) { openExternal(fairUseUrl) }
                .buttonStyle(.borderless)
                .tint(BrandColor.olive)
        }
    }
}

// MARK: - Pacing (the early heads-up)

/// 'pacing': the early heads-up. Specific about what and how much, never alarmed.
private struct PacingCard: View {
    let usage: Usage

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        let projected = usage.overage_projection.projected_overage_cents
        SettingsCard(title: t("settingsMore.headsUp")) {
            // The subject is a whole noun phrase substituted into the sentence
            // rather than glued to the front of it: "Les minutes d'appel"
            // carries its own article, which an English-shaped concatenation
            // has nowhere to put.
            Text(
                AppStrings.translate(
                    appLocale,
                    "settingsMore.pacingBody",
                    ["subject": t(pacingSubjectKey(usage))]
                )
                    + (projected > 0
                        ? AppStrings.translate(
                            appLocale,
                            "settingsMore.pacingProjection",
                            ["amount": formatCents(projected)]
                        )
                        : "")
            )
            .font(.callout)
            Spacer().frame(height: 8)
            Text(t("settingsMore.pacingReassurance"))
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Capped (approaching or reached)

/// 'capped': the owner-set cap is close or reached. Plain about what pauses.
private struct CappedCard: View {
    let usage: Usage

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        let reached = capUseRatio(usage) >= 1.0
        SettingsCard(
            title: t(reached ? "settingsMore.atCapTitle" : "settingsMore.nearCapTitle")
        ) {
            Text(
                reached
                    ? t("settingsMore.atCapBody")
                    : AppStrings.translate(
                        appLocale,
                        "settingsMore.nearCapBody",
                        ["percent": "\(capUsePercent(usage))"]
                    )
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    private var isOwner: Bool { SettingsRoleGate.canChangeOverageCap(scope.role) }
    private var current: Double { normalizeCapMultiplier(company.overageCapMultiplier) }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.spendingCap"),
            description: t("settingsMore.spendingCapDesc")
        ) {
            if !isOwner {
                ReadOnlyLine(
                    AppStrings.translate(
                        appLocale,
                        "settingsMore.capReadOnly",
                        ["cap": capLabel(current)]
                    )
                )
            } else {
                // A slider, matching the web and Android: the multiple is the
                // mechanism but the pause point is the decision, so it reads
                // largest and counts as you drag. Presets could not express
                // 4.5x at all, which is the parity gap this closes.
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t("settingsMore.sendingPausesAt"))
                                .font(.golos(10.5, weight: .semibold))
                                .foregroundStyle(BrandColor.muted500)
                            Text(groupDigits(capSegments(
                                includedSegments: usage.included_segments,
                                multiplier: pending
                            )))
                            .font(.golos(26, weight: .semibold))
                            .foregroundStyle(BrandColor.ink)
                            Text(t("settingsMore.messagesThisPeriod"))
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
                        Text(t("settingsMore.oneTimesIncluded"))
                        Spacer()
                        Text(
                            AppStrings.translate(
                                appLocale,
                                "settingsMore.capMax",
                                ["cap": capLabel(maxCapMultiplier)]
                            )
                        )
                    }
                    .font(.golos(10.5))
                    .foregroundStyle(BrandColor.muted500)

                    // Dragging proposes; it never saves. Money changes on purpose.
                    if pending != current {
                        Text(describeCapChange(
                            current: current,
                            next: pending,
                            includedSegments: usage.included_segments,
                            locale: appLocale
                        ).summary)
                        .font(.golos(12.5))
                        .foregroundStyle(BrandColor.ink)

                        HStack(spacing: 10) {
                            Button(saving ? t("common.saving") : t("settingsMore.saveCap")) {
                                save(pending)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(saving)
                            Button(t("common.cancel")) { pending = current }
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
        let locale = appLocale
        Task {
            do {
                let updated = try await scope.repo.updateCompany(
                    scope.companyId,
                    patch: .object(["overage_cap_multiplier": .number(next)])
                )
                onCompanyUpdated(updated)
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        "settingsMore.capSetTo",
                        ["cap": capLabel(next)]
                    )
                )
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        SettingsCard(
            title: t("settingsMore.details"),
            description: t("settingsMore.detailsBlurb")
        ) {
            Button {
                expanded.toggle()
            } label: {
                HStack {
                    Text(t(expanded ? "settingsMore.hideNumbers" : "settingsMore.showNumbers"))
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        // The date range is its own key so the comma travels with it: an absent
        // range must not leave a comma hanging in either language. Resolved into
        // a local rather than composed inside the dictionary literal below —
        // this file cannot be compiled here, and a closure nested in a literal
        // is the shape that makes Swift's type checker give up on it.
        let range = periodRange(usage)
        let rangeClause = range.map { t("settingsMore.commaRange", ["range": $0]) } ?? ""
        let pausePoint = usage.cap_segments
            ?? capSegments(includedSegments: usage.included_segments, multiplier: nil)
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader(t("settingsMore.messages"))
            DetailLine(
                t(
                    "settingsMore.messagesUsed",
                    [
                        "used": groupDigits(usage.used_segments),
                        "included": groupDigits(usage.included_segments),
                        "range": rangeClause,
                    ]
                )
            )
            if usage.overage_segments > 0 {
                DetailLine(
                    t(
                        "settingsMore.messagesOverage",
                        [
                            "over": groupDigits(usage.overage_segments),
                            "amount": formatCents(usage.projected_overage_cents),
                        ]
                    )
                )
            } else {
                DetailLine(t("settingsMore.messagesNoOverage"))
            }
            DetailLine(
                t("settingsMore.messagesPauseAt", ["count": groupDigits(pausePoint)])
                    + t(
                        usage.cap_segments == nil
                            ? "settingsMore.messagesPauseMax"
                            : "settingsMore.fullStop"
                    )
            )
            if usage.inbound_segments > 0 {
                DetailLine(
                    t(
                        "settingsMore.messagesInbound",
                        ["count": groupDigits(usage.inbound_segments)]
                    )
                )
            }
        }
    }
}

private struct VoiceDetail: View {
    let usage: Usage

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        let voice = usage.voice
        if voice.included_minutes > 0 || voice.used_minutes > 0 {
            VStack(alignment: .leading, spacing: 2) {
                DetailHeader(t("settingsMore.callingMinutes"))
                DetailLine(
                    t(
                        "settingsMore.minutesUsed",
                        [
                            "used": groupDigits(voice.used_minutes),
                            "included": groupDigits(voice.included_minutes),
                        ]
                    )
                )
                if voice.overage_minutes > 0 {
                    DetailLine(
                        t(
                            "settingsMore.minutesOverage",
                            [
                                "extra": groupDigits(voice.overage_minutes),
                                "amount": formatCents(voice.projected_overage_cents),
                            ]
                        )
                    )
                }
                DetailLine(
                    t(
                        voice.overage_billed
                            ? "settingsMore.minutesBilled"
                            : "settingsMore.minutesNotBilled"
                    )
                )
            }
        }
    }
}

private struct StorageDetail: View {
    let usage: Usage

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// The CATCH-ALL is filtered on its KEY rather than on its words, which is
    /// the note Android's twin leaves: comparing two translated labels is a
    /// condition that quietly stops matching the day somebody reads it in
    /// French.
    private var storageRows: [(key: String, bytes: Int)] {
        let storage = usage.storage
        let rows: [(key: String, bytes: Int)] = [
            ("settingsMore.storageReceived", storage.received_media_bytes),
            ("settingsMore.storageSent", storage.sent_media_bytes),
            ("settingsMore.storageNotes", storage.attachments_bytes),
            ("settingsMore.storageVoicemail", storage.voicemail_bytes),
            ("settingsMore.storageOther", storage.other_bytes),
        ]
        return rows.filter { $0.bytes > 0 || $0.key != "settingsMore.storageOther" }
    }

    var body: some View {
        // The old line added two figures together and called the result
        // "photos and attachments", which left voicemail recordings out of the
        // total entirely and called an audio message a photo. Every kind is
        // named now, with a catch-all that appears only when something is
        // unaccounted for. Deliberately not a meter: storage is free and
        // capless, so there is no maximum to fill.
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader(t("settingsMore.storage"))
            DetailLine(
                t(
                    "settingsMore.storedFree",
                    ["size": formatBytes(usage.storage.totalStored)]
                )
            )
            ForEach(storageRows, id: \.key) { row in
                HStack {
                    Text(t(row.key))
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    /// #431: the outcome line, or nil where there is honestly nothing to say.
    ///
    /// `$0.label` is the SERVER's word for the outcome and stays untranslated
    /// here for the reason every client renders `cause.message` verbatim: a
    /// catalogue entry for it would be a second copy of a vocabulary the API
    /// owns, and it would go stale the first time the API added a kind.
    private func outcomeLine(_ feature: AiFeatureUsage) -> String? {
        guard feature.enabled else { return nil }
        if feature.outcomesRecorded > 0 {
            return feature.outcomes
                .map { "\($0.count) \($0.label)" }
                .joined(separator: " · ")
        }
        if feature.used > 0 {
            return t("settingsMore.aiNoOutcomes")
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader(t("settingsMore.louThisMonth"))
            DetailLine(t("settingsMore.louThisMonthLine"))
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
                        Text(
                            feature.enabled
                                ? t(
                                    "settingsMore.usedOfCap",
                                    ["used": "\(feature.used)", "cap": "\(feature.cap)"]
                                )
                                : t("settingsMore.off")
                        )
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
                        Text(t("settingsMore.aiNearLimit"))
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

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader(AppStrings.translate(appLocale, "settingsMore.lastSixMonths"))
            DetailLine(AppStrings.translate(appLocale, "settingsMore.lastSixMonthsLine"))
            Spacer().frame(height: 8)
            HistoryBars(history: history)
        }
    }
}

private struct CountingDetail: View {
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DetailHeader(AppStrings.translate(appLocale, "settingsMore.howCounted"))
            DetailLine(AppStrings.translate(appLocale, "settingsMore.howCountedLine"))
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

/// Catalogue key for a destination bucket's human name.
private func countryLabelKey(_ code: String) -> String {
    switch code {
    case "US": "settingsMore.countryUs"
    case "CA": "settingsMore.countryCa"
    default: "settingsMore.countryElsewhere"
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

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        if let delivery = usage.delivery,
           delivery.delivered + delivery.failed + delivery.pending > 0 {
            let countries = delivery.by_country.filter {
                $0.delivered + $0.failed + $0.pending > 0
            }
            SettingsCard(
                title: t("settingsMore.deliveryTitle"),
                description: t("settingsMore.deliveryDesc")
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
                        // The colon rides inside the key: French puts a space
                        // before it and English does not.
                        ReadOnlyLine(
                            t(
                                "settingsMore.deliveryByCountry",
                                [
                                    "country": t(countryLabelKey(row.country)),
                                    "figure": rateText(row),
                                ]
                            )
                        )
                    }
                }

                Spacer().frame(height: 8)
                ReadOnlyLine(
                    t(
                        delivery.failed > 0
                            ? "settingsMore.deliveryFailureNote"
                            : "settingsMore.deliveryNothingBounced"
                    )
                )
            }
        }
    }

    /// The three counts, each carrying its own separator so an absent clause
    /// leaves no orphaned "·" behind it.
    private func summaryLine(_ d: UsageDelivery) -> String {
        var line = t("settingsMore.deliveryDelivered", ["count": "\(d.delivered)"])
        if d.failed > 0 {
            line += t("settingsMore.deliveryFailed", ["count": "\(d.failed)"])
        }
        if d.pending > 0 {
            line += t("settingsMore.deliveryPending", ["count": "\(d.pending)"])
        }
        return line
    }

    private func rateText(_ row: UsageDeliveryCountry) -> String {
        guard let rate = row.rate else {
            return t(
                "settingsMore.deliveryCounts",
                ["delivered": "\(row.delivered)", "total": "\(row.delivered + row.failed)"]
            )
        }
        return t(
            "settingsMore.deliveryPercent",
            ["percent": "\(Int((rate * 100).rounded()))"]
        )
    }
}
