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
                    kind == .followUp
                        // The cancellation is the reassuring half, and the half
                        // nobody believes until it is written down.
                        ? "It comes back then as something to chase — unless they "
                            + "reply first, in which case there is nothing to chase "
                            + "and the reminder disappears."
                        : "It comes back to your inbox then — and immediately if "
                            + "the customer replies before that."
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

                TextField("Why? (optional)", text: $note)
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
            .navigationTitle(kind == .followUp ? "Remind me to chase" : "Snooze until")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(kind == .followUp ? "Remind me" : "Snooze") {
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
