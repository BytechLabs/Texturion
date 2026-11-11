import SwiftUI

/// One choice in a `SelectField`. `detail` is one line that says what the choice means.
struct SelectOption<Value: Hashable> {
    let value: Value
    let title: String
    var detail: String?

    init(_ value: Value, title: String, detail: String? = nil) {
        self.value = value
        self.title = title
        self.detail = detail
    }
}

/// #746: the one simple select, for a short list of single choices (web: `SimpleSelect`).
///
/// The closed field is the system menu picker and shows the chosen title and nothing
/// else. A choice's `detail` is drawn in one line under the field for the chosen option,
/// never inside the closed field, where it used to wrap. A `selected` value that is not
/// in `options` shows an empty field, so a caller adds the stored value to `options`.
///
/// A long list found by typing (time zones, teammates) is `SearchablePicker`; a few
/// options with consequences each are `ChoiceCards`. `SelectFieldPatternGuardTests`
/// fails on a hand-built `Picker` elsewhere.
struct SelectField<Value: Hashable>: View {
    let options: [SelectOption<Value>]
    let selected: Value
    /// The question the field answers, spoken with the answer by VoiceOver.
    let label: String
    var enabled: Bool
    /// Draw the chosen option's detail under the field. Off where the field sits in a
    /// crowded row and the detail is in the open list only.
    var showsDetail: Bool
    let onSelect: @MainActor (Value) -> Void

    init(
        options: [SelectOption<Value>],
        selected: Value,
        label: String,
        enabled: Bool = true,
        showsDetail: Bool = true,
        onSelect: @escaping @MainActor (Value) -> Void
    ) {
        self.options = options
        self.selected = selected
        self.label = label
        self.enabled = enabled
        self.showsDetail = showsDetail
        self.onSelect = onSelect
    }

    private var chosenDetail: String? {
        options.first(where: { $0.value == selected })?.detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Picker(
                label,
                selection: Binding(get: { selected }, set: { next in onSelect(next) })
            ) {
                ForEach(options.indices, id: \.self) { index in
                    Text(options[index].title).tag(options[index].value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(BrandColor.olive)
            .frame(minHeight: 44, alignment: .leading)
            .disabled(!enabled)
            .accessibilityLabel(label)
            if showsDetail, let chosenDetail {
                Text(chosenDetail)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
