import SwiftUI

/// #214 — the shared typable country picker used by BOTH the make-task sheet
/// (apps/ios/Loonext/Features/Thread/ThreadView.swift) and the task-detail
/// address section (apps/ios/Loonext/Features/Tasks/TaskDetailView.swift). It
/// renders like the address text fields (inset well, matching padding/type) but
/// is a tappable control: tapping opens a `.searchable` list of `COUNTRIES`;
/// typing filters it; selecting a row writes the name and dismisses.
///
/// An off-list value already present (e.g. an enrichment's "CA", which isn't a
/// canonical list entry) is shown verbatim in the collapsed field AND surfaced
/// as the current, checked row in the sheet, so it is never silently dropped.
///
/// `onSelect` fires AFTER the binding is written, letting each call site treat a
/// selection like a field edit — flip provenance to "manual" and (in the
/// task-detail section) commit the save.
@MainActor
struct CountryField: View {
    @Binding var value: String
    var placeholder: String = "Country"
    var onSelect: (@MainActor () -> Void)? = nil

    @State private var picking = false

    var body: some View {
        Button {
            picking = true
        } label: {
            HStack(spacing: 8) {
                Text(value.isEmpty ? placeholder : value)
                    .font(.golos(13))
                    .foregroundStyle(value.isEmpty ? BrandColor.muted500 : BrandColor.ink)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.down")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(BrandColor.muted400)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                BrandColor.inset,
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Country")
        .accessibilityValue(value.isEmpty ? "Not set" : value)
        .sheet(isPresented: $picking) {
            CountryPickerSheet(current: value) { picked in
                value = picked
                onSelect?()
            }
        }
    }
}

/// The searchable country list presented by `CountryField`. Selecting a row
/// hands the name back and dismisses; `Cancel` leaves the value untouched.
@MainActor
private struct CountryPickerSheet: View {
    let current: String
    let onPick: @MainActor (String) -> Void

    @State private var query = ""
    @Environment(\.dismiss) private var dismiss

    private var trimmedQuery: String {
        query.trimmingCharacters(in: .whitespaces)
    }

    /// `COUNTRIES` filtered by the search query (case-insensitive substring).
    private var filtered: [String] {
        let needle = trimmedQuery
        if needle.isEmpty { return COUNTRIES }
        return COUNTRIES.filter { $0.range(of: needle, options: .caseInsensitive) != nil }
    }

    /// A current value that isn't a canonical list entry (e.g. "CA" from
    /// enrichment) — surfaced as its own row so it stays visible and selectable.
    private var offListCurrent: String? {
        let trimmed = current.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return nil }
        let inList = COUNTRIES.contains { $0.caseInsensitiveCompare(trimmed) == .orderedSame }
        guard !inList else { return nil }
        let needle = trimmedQuery
        guard needle.isEmpty || trimmed.range(of: needle, options: .caseInsensitive) != nil else {
            return nil
        }
        return trimmed
    }

    private func isCurrent(_ name: String) -> Bool {
        !current.isEmpty && name.caseInsensitiveCompare(current) == .orderedSame
    }

    var body: some View {
        NavigationStack {
            List {
                if let off = offListCurrent {
                    countryRow(off, checked: true)
                }
                if filtered.isEmpty && offListCurrent == nil {
                    Text("No countries match \"\(trimmedQuery)\".")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filtered, id: \.self) { name in
                        countryRow(name, checked: isCurrent(name))
                    }
                }
            }
            .listStyle(.plain)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search countries"
            )
            .navigationTitle("Country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func countryRow(_ name: String, checked: Bool) -> some View {
        Button {
            onPick(name)
            dismiss()
        } label: {
            HStack {
                Text(name)
                    .font(.callout)
                    .foregroundStyle(checked ? BrandColor.olive : Color.primary)
                Spacer(minLength: 0)
                if checked {
                    Image(systemName: "checkmark")
                        .foregroundStyle(BrandColor.olive)
                }
            }
        }
    }
}

/// Stateful wrapper so the preview can exercise the binding (a listed value, an
/// off-list enrichment value, and empty).
private struct CountryFieldPreviewHarness: View {
    @State private var listed = "Canada"
    @State private var offList = "CA"
    @State private var empty = ""

    var body: some View {
        VStack(spacing: 12) {
            CountryField(value: $listed)
            CountryField(value: $offList)
            CountryField(value: $empty)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrandColor.canvas)
    }
}

#Preview("Country field") {
    CountryFieldPreviewHarness()
}
