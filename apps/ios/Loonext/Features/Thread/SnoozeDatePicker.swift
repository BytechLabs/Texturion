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
    let onPick: @MainActor (Date) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var picked: Date = snoozePresets().first?.at
        ?? Date().addingTimeInterval(3600)

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(
                    "It comes back to your inbox then — and immediately if the "
                        + "customer replies before that."
                )
                .font(.golos(12.5))
                .foregroundStyle(BrandColor.muted500)
                .fixedSize(horizontal: false, vertical: true)

                DatePicker(
                    "Return date and time",
                    selection: $picked,
                    in: Date()...,
                    displayedComponents: [.date, .hourAndMinute]
                )
                .datePickerStyle(.graphical)
                .labelsHidden()

                Spacer(minLength: 0)
            }
            .padding(18)
            .background(BrandColor.canvas)
            .navigationTitle("Snooze until")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Snooze") { onPick(picked) }
                        .disabled(!isSnoozeTargetValid(picked))
                }
            }
        }
        .presentationDetents([.large])
    }
}
