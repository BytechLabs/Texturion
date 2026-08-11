import SwiftUI

/// #297 — how loud each kind of notification is.
///
/// Design notes, and the principles behind them:
///
/// - **The promise comes first, above every control.** "An emergency always
///   arrives straight away, whatever you choose here." Without that sentence
///   nobody picks a quieter setting, because the fear is missing the call that
///   mattered — and they go back to turning notifications off entirely, which
///   is the failure this feature exists to prevent.
///   *Applying: Loss Aversion, read the right way round.*
/// - **One row per category, one decision each.** Six categories times three
///   modes is eighteen controls; as six rows each holding one three-way choice
///   it is six small decisions. *Applying: Chunking.*
/// - **The window appears only when something is grouped.** *Applying: Zen of
///   Clarity, and progressive disclosure rather than a settings wall.*
///
/// Mirrors the web and Android cards; `OnCallCopyTests` keeps the words
/// identical.
struct DeliveryModesCard: View {
    let prefs: NotificationPrefs
    let onSave: (NotificationPrefs) -> Void

    @Environment(\.appLocale) private var appLocale

    /// An absent key means immediate — the SERVER's rule, restated here rather
    /// than reinvented, so the two cannot drift.
    private func mode(of category: String) -> String {
        prefs.delivery?[category] ?? "immediate"
    }

    private var anyBatched: Bool {
        OnCall.categoryLabels.contains { mode(of: $0.key) == "batched" }
    }

    private var anySummary: Bool {
        OnCall.categoryLabels.contains { mode(of: $0.key) == "summary" }
    }

    private func label(for mode: String) -> String {
        switch mode {
        case "batched": return OnCall.deliveryBatched
        case "summary": return OnCall.deliverySummary
        default: return OnCall.deliveryImmediate
        }
    }

    private func set(_ category: String, to mode: String) {
        var next = prefs.delivery ?? [:]
        // Immediate is stored as ABSENCE. Writing it would make a member who
        // chose the default look different from one who never touched this,
        // and they are the same thing.
        if mode == "immediate" {
            next.removeValue(forKey: category)
        } else {
            next[category] = mode
        }

        var updated = prefs
        updated.delivery = next
        updated.batch_window_minutes = next.values.contains("batched")
            ? (prefs.batch_window_minutes ?? OnCall.defaultBatchWindow)
            : nil
        onSave(updated)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(OnCall.deliveryHeading)
                .font(.golos(15, weight: .semibold))
            Text(OnCall.deliveryUrgentAlways)
                .font(.golos(13))
                .foregroundStyle(.secondary)
                .padding(.bottom, 4)

            ForEach(OnCall.categoryLabels, id: \.key) { entry in
                HStack {
                    Text(entry.label)
                        .font(.golos(14))
                    Spacer(minLength: 8)
                    HStack(spacing: 2) {
                        ForEach(OnCall.deliveryModes, id: \.self) { option in
                            Button(label(for: option)) {
                                set(entry.key, to: option)
                            }
                            .font(.golos(11.5, weight: .semibold))
                            .buttonStyle(.plain)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                mode(of: entry.key) == option
                                    ? BrandColor.olive
                                    : Color.clear
                            )
                            .foregroundStyle(
                                mode(of: entry.key) == option
                                    ? BrandColor.paperFixed
                                    : BrandColor.muted600
                            )
                            .clipShape(Capsule())
                        }
                    }
                }
                .padding(.vertical, 3)
            }

            if anySummary {
                Text(OnCall.deliverySummaryDetail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }

            if anyBatched {
                Divider().padding(.vertical, 6)
                HStack {
                    Text(AppStrings.translate(appLocale, "inbox.deliveryGroupEvery"))
                        .font(.golos(13))
                    Picker(
                        AppStrings.translate(appLocale, "inbox.deliveryGroupEvery"),
                        selection: Binding(
                            get: {
                                prefs.batch_window_minutes
                                    ?? OnCall.defaultBatchWindow
                            },
                            set: { minutes in
                                var updated = prefs
                                updated.batch_window_minutes = minutes
                                onSave(updated)
                            }
                        )
                    ) {
                        ForEach(OnCall.batchWindowChoices, id: \.self) { minutes in
                            Text(
                                AppStrings.translate(
                                    appLocale,
                                    "inbox.deliveryMinutes",
                                    ["minutes": String(minutes)]
                                )
                            ).tag(minutes)
                        }
                    }
                    .pickerStyle(.menu)
                }
            }
        }
        .padding(.top, 10)
    }
}
