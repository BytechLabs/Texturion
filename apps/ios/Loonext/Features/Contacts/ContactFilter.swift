import SwiftUI

/// #291 — narrow the contacts list to one answer in one of the workspace's own
/// fields.
///
/// Design notes, and the principles behind them:
///
/// - **Absent unless there is something worth filtering on.** Only a dropdown
///   or a yes/no field has a closed set of answers; a serial number does not,
///   and offering to filter by one would be a text box that returns nothing
///   until it is typed perfectly — which is search, and search already reads
///   it. *Applying: Zen of Clarity, and Prioritize Intent.*
/// - **One field at a time.** Two conditions combined is a report, and a report
///   is a different screen with different expectations about accuracy.
/// - **The active filter is a chip you can see and clear.** A list quietly
///   filtered is a list that looks wrong: somebody scrolls for a customer who
///   is not missing, they are excluded. *Applying: the Safety principle — the
///   state of the view is always legible.*
/// - **"Not set" is a choice**, and the most useful one: exactly the customers
///   somebody still has to ask.
///
/// Chips rather than the web's two dropdowns, matching Android: a phone has
/// room for one row of taps and not for two pickers side by side.
/// `contact-filter-parity.test.ts` keeps the words the same.
struct ContactFilter: View {
    let defs: [ContactFieldDef]
    let active: ContactFieldFilter?
    let onChange: (ContactFieldFilter?) -> Void

    /// Only the kinds with a closed set of answers.
    private var filterable: [ContactFieldDef] {
        defs.filter { $0.kind == "select" || $0.kind == "checkbox" }
    }

    var body: some View {
        if filterable.isEmpty {
            EmptyView()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Button {
                        onChange(nil)
                    } label: {
                        chip(contactFilterAll, selected: active == nil)
                    }
                    .buttonStyle(.plain)

                    ForEach(filterable) { field in
                        Menu {
                            // Empty is an ANSWER on a custom field, and the
                            // most useful filter of the lot: the customers
                            // still to ask.
                            Button(contactFilterUnset) {
                                onChange(ContactFieldFilter(key: field.key, value: ""))
                            }
                            ForEach(answers(for: field), id: \.self) { choice in
                                Button(answerLabel(choice)) {
                                    onChange(
                                        ContactFieldFilter(key: field.key, value: choice)
                                    )
                                }
                            }
                        } label: {
                            chip(
                                active?.key == field.key
                                    ? "\(field.label): \(answerLabel(active?.value ?? ""))"
                                    : field.label,
                                selected: active?.key == field.key
                            )
                        }
                    }
                }
            }
        }
    }

    private func chip(_ text: String, selected: Bool) -> some View {
        Text(text)
            .font(.golos(13))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                selected ? BrandColor.limeChip : BrandColor.inset,
                in: Capsule()
            )
            .foregroundStyle(selected ? BrandColor.ink : BrandColor.muted600)
    }

    /// What a field can be filtered to. A yes/no field has two, not its options.
    private func answers(for field: ContactFieldDef) -> [String] {
        field.kind == "checkbox" ? ["yes", "no"] : (field.options ?? [])
    }

    /// "yes" and "no" are stored values; these are the words on screen.
    private func answerLabel(_ value: String) -> String {
        switch value {
        case "": return contactFilterUnset
        case "yes": return "Yes"
        case "no": return "No"
        default: return value
        }
    }
}

/// #291 — one field, one answer. Two conditions combined is a report.
struct ContactFieldFilter: Equatable {
    let key: String
    let value: String
}

/// The words this surface owns, kept where the parity test can read them.
let contactFilterAll = "Everyone"
let contactFilterUnset = "Not set"
let contactFilterEmptyTitle = "Nobody matches that yet"
let contactFilterEmptyBody =
    "No customer has that answer on file. Clear the filter to see everyone."
