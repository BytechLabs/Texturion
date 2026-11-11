import SwiftUI

/// One row in a `SearchablePickerSheet`. `searchText` is what typing matches (the title
/// by default); `detail` is a line beside the title, such as a zone's current time.
struct PickerOption<Value: Hashable> {
    let value: Value
    let title: String
    var detail: String?
    var searchText: String

    init(_ value: Value, title: String, detail: String? = nil, searchText: String? = nil) {
        self.value = value
        self.title = title
        self.detail = detail
        self.searchText = searchText ?? title
    }
}

/// #746: the one searchable picker's sheet, for a long list somebody finds by typing:
/// time zones, teammates (web: `SearchablePicker`). A system search drawer over a plain
/// list, a check on the chosen row, and one tap to choose.
///
/// `SearchablePickerPatternGuardTests` fails on a second sheet with a search drawer over
/// a list elsewhere.
struct SearchablePickerSheet<Value: Hashable>: View {
    let options: [PickerOption<Value>]
    let selected: Value?
    let title: String
    let searchPrompt: String
    let onPick: @MainActor (Value) -> Void
    let onDismiss: @MainActor () -> Void

    @State private var query = ""

    @Environment(\.appLocale) private var appLocale

    private var matches: [PickerOption<Value>] {
        let needle = query.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: " ", with: "_")
        if needle.isEmpty { return options }
        return options.filter {
            $0.searchText.range(of: needle, options: .caseInsensitive) != nil
                || $0.searchText.range(of: query.trimmingCharacters(in: .whitespaces), options: .caseInsensitive) != nil
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if matches.isEmpty {
                    Text(AppStrings.translate(appLocale, "common.pickerNoMatch"))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(matches.indices, id: \.self) { index in
                        row(matches[index])
                    }
                }
            }
            .listStyle(.plain)
            .searchable(
                text: $query,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: searchPrompt
            )
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(AppStrings.translate(appLocale, "common.cancel")) { onDismiss() }
                }
            }
        }
    }

    private func row(_ option: PickerOption<Value>) -> some View {
        let isSelected = option.value == selected
        return Button {
            onPick(option.value)
        } label: {
            HStack {
                Text(option.title)
                    .font(.callout)
                    .foregroundStyle(isSelected ? BrandColor.olive : Color.primary)
                Spacer()
                if let detail = option.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(BrandColor.olive)
                        .accessibilityHidden(true)
                }
            }
        }
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

/// The closed field for a `SearchablePickerSheet`: a bordered button with the chosen
/// title and a chevron, drawn like `SelectField`'s menu. It owns when the sheet shows.
struct SearchablePicker<Value: Hashable>: View {
    let options: [PickerOption<Value>]
    let selected: Value?
    let label: String
    let placeholder: String
    var enabled: Bool
    let onSelect: @MainActor (Value) -> Void

    @State private var open = false

    init(
        options: [PickerOption<Value>],
        selected: Value?,
        label: String,
        placeholder: String = "",
        enabled: Bool = true,
        onSelect: @escaping @MainActor (Value) -> Void
    ) {
        self.options = options
        self.selected = selected
        self.label = label
        self.placeholder = placeholder
        self.enabled = enabled
        self.onSelect = onSelect
    }

    @Environment(\.appLocale) private var appLocale

    private var shownTitle: String {
        options.first(where: { $0.value == selected })?.title ?? placeholder
    }

    var body: some View {
        Button {
            open = true
        } label: {
            HStack(spacing: 6) {
                Text(shownTitle)
                    .font(.subheadline)
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption2)
                    .accessibilityHidden(true)
            }
            .foregroundStyle(BrandColor.olive)
            .frame(minHeight: 44, alignment: .leading)
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityValue(shownTitle)
        .sheet(isPresented: $open) {
            SearchablePickerSheet(
                options: options,
                selected: selected,
                title: label,
                searchPrompt: AppStrings.translate(appLocale, "common.pickerSearch"),
                onPick: { value in
                    open = false
                    if value != selected { onSelect(value) }
                },
                onDismiss: { open = false }
            )
        }
    }
}
