import SwiftUI

/// One choice in a `SelectField`. `detail` is one line that says what the choice means.
struct SelectOption<Value: Hashable> {
    let value: Value
    let title: String
    var detail: String?
    /// Shown in the open list but not choosable: a value another row already holds, or the
    /// "not answered yet" placeholder.
    var isDisabled: Bool
    var copyValue: String?

    init(_ value: Value, title: String, detail: String? = nil, isDisabled: Bool = false, copyValue: String? = nil) {
        self.value = value
        self.title = title
        self.detail = detail
        self.isDisabled = isDisabled
        self.copyValue = copyValue
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
    /// A header choice uses the paper icon button and speaks the selected value.
    var triggerIcon: String?
    let onSelect: @MainActor (Value) -> Void

    init(
        options: [SelectOption<Value>],
        selected: Value,
        label: String,
        enabled: Bool = true,
        showsDetail: Bool = true,
        triggerIcon: String? = nil,
        onSelect: @escaping @MainActor (Value) -> Void
    ) {
        self.options = options
        self.selected = selected
        self.label = label
        self.enabled = enabled
        self.showsDetail = showsDetail
        self.triggerIcon = triggerIcon
        self.onSelect = onSelect
    }

    private var chosen: SelectOption<Value>? {
        options.first(where: { $0.value == selected })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let triggerIcon {
                iconMenu(triggerIcon)
            } else if options.contains(where: { $0.copyValue != nil }) {
                HStack(spacing: 8) {
                    CopyablePhoneNumber(number: chosen?.copyValue, label: chosen?.title ?? label, minimumHeight: 44)
                    phoneMenu
                }
            } else {
                picker
            }
            if showsDetail, let detail = chosen?.detail {
                Text(detail)
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.muted600)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var selection: Binding<Value> {
        Binding(get: { selected }, set: { next in onSelect(next) })
    }

    private var pickerOptions: some View {
        ForEach(options.indices, id: \.self) { index in
            Text(options[index].title)
                .tag(options[index].value)
                .disabled(options[index].isDisabled)
        }
    }

    private var picker: some View {
        Picker(label, selection: selection) { pickerOptions }
        .pickerStyle(.menu)
        .labelsHidden()
        .tint(BrandColor.olive)
        .frame(minHeight: 44, alignment: .leading)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }

    private func iconMenu(_ systemImage: String) -> some View {
        Menu {
            Picker(label, selection: selection) { pickerOptions }
                .pickerStyle(.inline)
        } label: {
            PaperIconButton.icon(systemImage: systemImage, foreground: BrandColor.muted700)
                .contentShape(Circle())
        }
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityValue(chosen?.title ?? "")
    }

    private var phoneMenu: some View {
        Menu {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button {
                    onSelect(option.value)
                } label: {
                    if option.value == selected {
                        Label(option.title, systemImage: "checkmark")
                    } else {
                        Text(option.title)
                    }
                }
                .disabled(option.isDisabled)
            }
        } label: {
            Image(systemName: "chevron.up.chevron.down")
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .tint(BrandColor.olive)
        .frame(minHeight: 44, alignment: .leading)
        .disabled(!enabled)
        .accessibilityLabel(label)
        .accessibilityValue(chosen?.title ?? "")
    }
}
