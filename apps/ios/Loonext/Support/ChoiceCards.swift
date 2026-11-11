import SwiftUI

/// One option in `ChoiceCards`. `detail` says what choosing it means.
struct ChoiceOption<Value: Hashable> {
    let value: Value
    let title: String
    var detail: String?

    init(_ value: Value, title: String, detail: String? = nil) {
        self.value = value
        self.title = title
        self.detail = detail
    }
}

/// #746: the one described choice, for a few options that each have a consequence worth
/// reading before choosing: who rings, what happens after hours, who may use a number
/// (web: `ChoiceCards`). A radio row for each option with its detail under the title.
/// Choosing the chosen option again does nothing. Three or four words with no
/// consequence are a `SegmentedControl`; a longer list is a `SelectField`.
///
/// `ChoiceCardsPatternGuardTests` fails on a hand-built radio row elsewhere.
struct ChoiceCards<Value: Hashable>: View {
    let options: [ChoiceOption<Value>]
    let selected: Value?
    var enabled: Bool
    let onSelect: @MainActor (Value) -> Void

    init(
        options: [ChoiceOption<Value>],
        selected: Value?,
        enabled: Bool = true,
        onSelect: @escaping @MainActor (Value) -> Void
    ) {
        self.options = options
        self.selected = selected
        self.enabled = enabled
        self.onSelect = onSelect
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(options.indices, id: \.self) { index in
                row(options[index])
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func row(_ option: ChoiceOption<Value>) -> some View {
        let isSelected = option.value == selected
        return Button {
            guard !isSelected else { return }
            onSelect(option.value)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                    .foregroundStyle(isSelected ? BrandColor.olive : Color.secondary)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(option.title)
                        .font(.body)
                        .foregroundStyle(Color.primary)
                    if let detail = option.detail {
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
