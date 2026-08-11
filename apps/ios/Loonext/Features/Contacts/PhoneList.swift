import SwiftUI

/// #291 — the other numbers this customer answers.
///
/// Design notes, and the principles behind them:
///
/// - **Absent until it has something to say.** Nearly every customer has one
///   line, which the row above already holds. An empty "other numbers" list on
///   every record would be a permanent question mark to serve the household
///   with two people in it. *Applying: Zen of Clarity, and Prioritize Intent.*
/// - **It says what adding one DOES.** This is not a notes field: a number
///   recorded here is matched against every inbound text and call. Said where
///   the decision is made, because otherwise the first time anyone learns it
///   is when a message arrives under a name they did not expect.
/// - **A label is optional and free text.** A fixed vocabulary is wrong for
///   the second trade that uses it — a household labels by person, a business
///   by which line it is.
/// - **Removing takes one tap.** It is reversible by typing it again, and the
///   conversations held with that number stay. *Applying: Ethical Friction, on
///   the irreversible edge only — and this edge is not one.*
///
/// Mirrors the web and Android lists; `phone-parity.test.ts` keeps the words
/// the same.
struct PhoneList: View {
    let phones: [ContactPhone]
    let onAdd: (String?, String) -> Void
    let onRemove: (String) -> Void

    @State private var adding = false
    @State private var draftLabel = ""
    @State private var draftPhone = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(phones) { entry in
                HStack(spacing: 8) {
                    Image(systemName: "phone")
                        .font(.scaled(12, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                    Text(line(for: entry))
                        .font(.golos(13))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Button {
                        onRemove(entry.id)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(entry.phone_e164)")
                }
            }

            if adding {
                // The placeholder IS the hint, as it is on the other two
                // clients. A separate line under the field would be the same
                // words taking twice the room on the smallest screen.
                TextField(phoneLabelPlaceholder, text: $draftLabel)
                    .font(.golos(13))
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Label")
                TextField(phoneNumberPlaceholder, text: $draftPhone)
                    .font(.golos(13))
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.phonePad)
                    .accessibilityLabel("Number")
                // What this actually does, said before it is done.
                Text(phoneMatchNote)
                    .font(.golos(11))
                    .foregroundStyle(BrandColor.muted500)
                HStack(spacing: 8) {
                    Button("Add") {
                        let phone = draftPhone.trimmingCharacters(in: .whitespaces)
                        guard !phone.isEmpty else { return }
                        let label = draftLabel.trimmingCharacters(in: .whitespaces)
                        onAdd(label.isEmpty ? nil : label, phone)
                        draftLabel = ""
                        draftPhone = ""
                        adding = false
                    }
                    .font(.golos(13, weight: .semibold))
                    .disabled(
                        draftPhone.trimmingCharacters(in: .whitespaces).isEmpty
                    )
                    Button("Cancel") {
                        adding = false
                        draftLabel = ""
                        draftPhone = ""
                    }
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                }
            } else {
                Button {
                    adding = true
                } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus")
                            .font(.scaled(10, weight: .semibold))
                        Text(phoneAddLabel).font(.golos(13))
                    }
                    .foregroundStyle(BrandColor.muted600)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func line(for entry: ContactPhone) -> String {
        guard let label = entry.label, !label.isEmpty else { return entry.phone_e164 }
        return "\(label) · \(entry.phone_e164)"
    }
}

/// The sentences this surface owns, kept where the parity test can read them.
let phoneAddLabel = "Add another number"
let phoneLabelPlaceholder = "Landline, the wife, the shop…"
let phoneNumberPlaceholder = "Another number they answer"
let phoneMatchNote =
    "Texts and calls from this number will show up under this customer, in "
    + "their own thread."
