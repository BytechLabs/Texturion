import SwiftUI

/// #293 — "Pick a date…", the custom rung below the presets.
///
/// Smart Defaults: it opens on the next preset's instant, never on an empty
/// field or on "now". Nobody should have to scroll a wheel to defer a thread,
/// and a picker that starts at this second starts on a value the API refuses.
///
/// The Snooze button is disabled rather than hidden while the chosen instant is
/// invalid, because here the row IS the whole content — hiding it would leave a
/// sheet with nothing in it and no explanation. That is the opposite of the
/// preset ladder, where dropping a stale option leaves three good ones.
struct SnoozeDatePicker: View {
    /// Which ladder the reader came from — it changes what this promises.
    let kind: DeferralKind
    let onPick: @MainActor (Date, String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale
    @State private var picked: Date
    /// The reason, optional, and only here. A preset is one tap and stays one
    /// tap; somebody who has opened a date picker is already deliberating, and
    /// "waiting on the supplier" three days later is the difference between a
    /// list you can read and a list of names.
    @State private var note = ""

    init(kind: DeferralKind, onPick: @escaping @MainActor (Date, String?) -> Void) {
        self.kind = kind
        self.onPick = onPick
        // Smart Defaults: the wheel starts on the next rung of the ladder the
        // reader came from, never on "now" — which is a value the API refuses.
        let seed =
            (kind == .followUp
                ? followUpPresets().first?.at
                : snoozePresets().first?.at)
            ?? Date().addingTimeInterval(3600)
        _picked = State(initialValue: seed)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(
                    AppStrings.translate(
                        appLocale,
                        // The cancellation is the reassuring half, and the half
                        // nobody believes until it is written down.
                        kind == .followUp
                            ? "thread.followUpExplainer"
                            : "thread.snoozeExplainer"
                    )
                )
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted500)
                .fixedSize(horizontal: false, vertical: true)

                DatePicker(
                    AppStrings.translate(appLocale, "thread.returnDateTime"),
                    selection: $picked,
                    in: Date()...,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .datePickerStyle(.graphical)
                .labelsHidden()

                TextField(
                    AppStrings.translate(appLocale, "thread.whyOptional"),
                    text: $note
                )
                    .font(.golos(13.5))
                    .textFieldStyle(.roundedBorder)
                    // The column's CHECK. Stopping here turns a Postgres error
                    // into a field that simply stops taking characters.
                    .onChange(of: note) { _, next in
                        if next.count > SnoozeTiming.noteMax {
                            note = String(next.prefix(SnoozeTiming.noteMax))
                        }
                    }

                Spacer(minLength: 0)
            }
            .padding(18)
            .background(BrandColor.canvas)
            .navigationTitle(
                AppStrings.translate(
                    appLocale,
                    kind == .followUp
                        ? "thread.remindMeToChase"
                        : "thread.snoozeUntil"
                )
            )
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(
                        AppStrings.translate(
                            appLocale,
                            kind == .followUp ? "thread.remindMe" : "thread.snooze"
                        )
                    ) {
                        // The thread is about to leave the inbox on a promise
                        // to come back. That is a commitment, and the sheet
                        // dismissing is easy to miss on a phone held low.
                        Haptics.confirm()
                        let trimmed = note.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        onPick(picked, trimmed.isEmpty ? nil : trimmed)
                    }
                    .disabled(!isSnoozeTargetValid(picked))
                }
            }
        }
        .presentationDetents([.large])
    }
}
