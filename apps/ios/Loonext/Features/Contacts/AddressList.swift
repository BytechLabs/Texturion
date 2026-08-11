import SwiftUI

/// #291 — the other places this customer is.
///
/// Design notes, and the principles behind them:
///
/// - **It is absent until it has something to say.** Most contacts have one
///   address, which the row above already holds; an empty "other addresses"
///   list on every record would be a permanent question mark to serve the
///   property manager with forty. *Applying: Zen of Clarity, and Prioritize
///   Intent — complexity expands with the user's intent, not ahead of it.*
/// - **The primary one is NAMED, not just first.** "Which address" is the
///   question this list exists to answer, and ordering answers it only for
///   somebody who knows the ordering means something.
/// - **Removing takes one tap.** It is reversible by typing it again and
///   nothing has been sent anywhere. *Applying: Ethical Friction, on the
///   irreversible edge only.*
///
/// Mirrors the web and Android lists; `ContactAddressCopyTests` keeps the words
/// the same.
struct AddressList: View {
    let addresses: [ContactAddress]
    let onAdd: (String?, String) -> Void
    let onMakePrimary: (String) -> Void
    let onRemove: (String) -> Void

    @State private var adding = false
    @State private var draftLabel = ""
    @State private var draftAddress = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(addresses) { entry in
                HStack(spacing: 8) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.scaled(12, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                    Text(line(for: entry))
                        .font(.golos(13))
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if entry.is_primary {
                        Text(addressPrimaryLabel)
                            .font(.golos(11, weight: .semibold))
                            .foregroundStyle(BrandColor.olive)
                    } else {
                        Button(addressPromoteLabel) { onMakePrimary(entry.id) }
                            .font(.golos(11))
                            .buttonStyle(.plain)
                            .foregroundStyle(BrandColor.muted600)
                    }
                    Button {
                        onRemove(entry.id)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.scaled(11, weight: .medium))
                            .foregroundStyle(BrandColor.muted500)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(entry.address)")
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(BrandColor.canvas)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            if adding {
                TextField("Unit 4, Billing, the rooftop…", text: $draftLabel)
                    .textFieldStyle(.roundedBorder)
                    .font(.golos(13))
                TextField("Where the job is", text: $draftAddress)
                    .textFieldStyle(.roundedBorder)
                    .font(.golos(13))
                HStack(spacing: 8) {
                    Button("Add") {
                        let address = draftAddress.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        guard !address.isEmpty else { return }
                        let label = draftLabel.trimmingCharacters(
                            in: .whitespacesAndNewlines
                        )
                        onAdd(label.isEmpty ? nil : label, address)
                        draftLabel = ""
                        draftAddress = ""
                        adding = false
                    }
                    .font(.golos(13, weight: .semibold))
                    .disabled(
                        draftAddress.trimmingCharacters(in: .whitespacesAndNewlines)
                            .isEmpty
                    )
                    Button("Cancel") {
                        adding = false
                        draftLabel = ""
                        draftAddress = ""
                    }
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted600)
                }
            } else {
                Button {
                    adding = true
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.scaled(11, weight: .medium))
                        Text(addressAddLabel)
                            .font(.golos(13))
                    }
                    .foregroundStyle(BrandColor.muted600)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
    }

    private func line(for entry: ContactAddress) -> String {
        guard let label = entry.label, !label.isEmpty else { return entry.address }
        return "\(label) · \(entry.address)"
    }
}

/// #291: the primary one is named, not merely first.
let addressPrimaryLabel = "Where the van goes"

let addressPromoteLabel = "Make it the main one"

let addressAddLabel = "Add another address"
