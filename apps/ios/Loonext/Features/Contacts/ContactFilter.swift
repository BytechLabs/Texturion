import SwiftUI

/// #291 / #711 — narrow the contacts list to a tag, or to one answer in one of the
/// workspace's own fields, from the same Filter button the inbox and Tasks use.
///
/// Design notes, and the principles behind them:
///
/// - **Behind the Filter button, not in rows of chips.** The inbox, Tasks and Contacts
///   lists all answer "which ones am I looking at?" the same way: one Filter button, and
///   the applied filters as removable chips only while any is on. *Applying: Zen of
///   Clarity, and the Safety principle.*
/// - **Absent unless there is something worth filtering on.** Only a dropdown or a yes/no
///   field has a closed set of answers; a serial number does not, and offering to filter by
///   one would be a text box that returns nothing until it is typed perfectly — which is
///   search, and search already reads it. *Applying: Zen of Clarity, and Prioritize Intent.*
/// - **One field at a time.** Two conditions combined is a report, and a report is a
///   different screen with different expectations about accuracy.
/// - **The active filter is a chip you can see and clear.** A list quietly filtered is a
///   list that looks wrong: somebody scrolls for a customer who is not missing, they are
///   excluded. *Applying: the Safety principle — the state of the view is always legible.*
/// - **"Not set" is a choice**, and the most useful one: exactly the customers somebody
///   still has to ask.
@MainActor
struct ContactFilterSheet: View {
    let defs: [ContactFieldDef]
    let tags: [Tag]
    let active: ContactFieldFilter?
    let onChange: (ContactFieldFilter?) -> Void
    let activeTag: String?
    let onTagChange: (String?) -> Void

    @Environment(\.appLocale) private var appLocale
    @Environment(\.dismiss) private var dismiss

    /// Only the kinds with a closed set of answers.
    private var filterable: [ContactFieldDef] {
        contactFilterableFields(defs)
    }

    var body: some View {
        NavigationStack {
            Form {
                if !tags.isEmpty {
                    Section(AppStrings.translate(appLocale, "settingsMore.tagsTitle")) {
                        ForEach(tags, id: \.id) { tag in
                            choice(tag.name, selected: activeTag == tag.id) {
                                onTagChange(activeTag == tag.id ? nil : tag.id)
                            }
                        }
                    }
                }
                ForEach(filterable) { field in
                    Section(field.label) {
                        choice(contactFilterAll, selected: active?.key != field.key) {
                            onChange(nil)
                        }
                        // Empty is an ANSWER on a custom field, and the most useful filter
                        // of the lot: the customers still to ask.
                        ForEach([""] + answers(for: field), id: \.self) { value in
                            let chosen = active?.key == field.key && active?.value == value
                            choice(contactFilterAnswerLabel(value), selected: chosen) {
                                onChange(
                                    chosen ? nil : ContactFieldFilter(key: field.key, value: value)
                                )
                            }
                        }
                    }
                }
            }
            .navigationTitle(AppStrings.translate(appLocale, "inbox.filterAction"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "common.close")) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func choice(
        _ title: String,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack {
                Text(title)
                    .font(.golos(13.5))
                    .foregroundStyle(BrandColor.ink)
                Spacer()
                if selected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(BrandColor.olive)
                }
            }
        }
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }

    /// What a field can be filtered to. A yes/no field has two, not its options.
    private func answers(for field: ContactFieldDef) -> [String] {
        field.kind == "checkbox" ? ["yes", "no"] : (field.options ?? [])
    }
}

/// The fields a customer list can be narrowed by: a dropdown or a yes/no.
func contactFilterableFields(_ defs: [ContactFieldDef]) -> [ContactFieldDef] {
    defs.filter { $0.kind == "select" || $0.kind == "checkbox" }
}

/// "yes" and "no" are stored values; these are the words on screen.
func contactFilterAnswerLabel(_ value: String) -> String {
    switch value {
    case "": return contactFilterUnset
    case "yes": return "Yes"
    case "no": return "No"
    default: return value
    }
}

/// The applied field filter as a chip label: "Field: answer".
func contactFieldFilterChipLabel(_ defs: [ContactFieldDef], _ active: ContactFieldFilter) -> String {
    let name = defs.first(where: { $0.key == active.key })?.label ?? active.key
    return "\(name): \(contactFilterAnswerLabel(active.value))"
}

/// #291 — one field, one answer. Two conditions combined is a report.
struct ContactFieldFilter: Equatable {
    let key: String
    let value: String
}

/// The words this surface owns, kept where the parity test can read them.
///
/// The two CHIP labels are still spelled here, exactly as Android's
/// `CONTACT_FILTER_ALL` / `CONTACT_FILTER_UNSET` are:
/// `contact-filter-parity.test.ts` reads this file's BYTES and asserts both
/// against web's catalogue, and that test lives in a tree this change may not
/// touch. They move when all three clients do.
///
/// #228: the two EMPTY-STATE constants are catalogue KEYS, not sentences —
/// again matching Android. The same parity test looks for the IDENTIFIER on the
/// list screen rather than for the words, so `ContactsTab` reaching them
/// through `AppStrings.translate` keeps it honest: what it asks is whether the
/// filtered-empty state exists at all.
let contactFilterAll = "Everyone"
let contactFilterUnset = "Not set"
let contactFilterEmptyTitle = "contactsTasks.filterEmptyTitle"
let contactFilterEmptyBody = "contactsTasks.filterEmptyBody"
