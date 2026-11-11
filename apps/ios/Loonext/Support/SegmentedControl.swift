import SwiftUI

/// One choice in a `SegmentedControl`: a title, an icon, or both. An icon-only choice
/// still needs an `accessibilityLabel` so VoiceOver can say what it is.
struct SegmentedOption<Value: Hashable> {
    let value: Value
    var title: String?
    var systemImage: String?
    var accessibilityLabel: String?

    init(
        _ value: Value,
        title: String? = nil,
        systemImage: String? = nil,
        accessibilityLabel: String? = nil
    ) {
        self.value = value
        self.title = title
        self.systemImage = systemImage
        self.accessibilityLabel = accessibilityLabel
    }
}

/// #733: the one segmented control, the Paper & Olive one: an inset capsule track with
/// an ink pill under the chosen segment and muted labels on the rest (web:
/// `SegmentedControl`). It is not the flat grey system `.segmented` Picker, which the
/// guard now refuses.
///
/// `fill` stretches the segments across the width the track is given; off, the track
/// hugs its labels. `compact` is the smaller size for a header row. Reach it with a
/// binding, or with `selected` and `onSelect` where a choice has a side effect.
struct SegmentedControl<Value: Hashable>: View {
    enum Size { case regular, compact }

    let options: [SegmentedOption<Value>]
    let selected: Value
    let onSelect: @MainActor (Value) -> Void
    var size: Size
    var fill: Bool
    /// What VoiceOver says for the whole group, such as "Theme".
    var label: String?

    init(
        options: [SegmentedOption<Value>],
        selected: Value,
        size: Size = .regular,
        fill: Bool = true,
        label: String? = nil,
        onSelect: @escaping @MainActor (Value) -> Void
    ) {
        self.options = options
        self.selected = selected
        self.size = size
        self.fill = fill
        self.label = label
        self.onSelect = onSelect
    }

    init(
        options: [SegmentedOption<Value>],
        selection: Binding<Value>,
        size: Size = .regular,
        fill: Bool = true,
        label: String? = nil
    ) {
        self.init(
            options: options,
            selected: selection.wrappedValue,
            size: size,
            fill: fill,
            label: label,
            onSelect: { next in selection.wrappedValue = next }
        )
    }

    var body: some View {
        HStack(spacing: 4) {
            ForEach(options, id: \.value) { option in
                segment(option)
            }
        }
        .padding(4)
        .background(BrandColor.insetDeep, in: Capsule())
        .animation(.easeInOut(duration: 0.15), value: selected)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label ?? "")
    }

    private func segment(_ option: SegmentedOption<Value>) -> some View {
        let isSelected = option.value == selected
        return Button {
            onSelect(option.value)
        } label: {
            segmentLabel(option, isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(option.accessibilityLabel ?? option.title ?? "")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    private func segmentLabel(_ option: SegmentedOption<Value>, isSelected: Bool) -> some View {
        let tight = size == .compact
        return HStack(spacing: 5) {
            if let systemImage = option.systemImage {
                Image(systemName: systemImage)
                    .font(.scaled(tight ? 13 : 15, weight: .medium))
            }
            if let title = option.title {
                Text(title)
                    .font(.golos(tight ? 12 : 12.5, weight: .semibold))
                    .lineLimit(1)
            }
        }
        .foregroundStyle(isSelected ? BrandColor.paper : BrandColor.muted700)
        .frame(maxWidth: fill ? CGFloat.infinity : nil)
        .padding(.horizontal, tight ? 12 : 14)
        .padding(.vertical, tight ? 7 : 9)
        .frame(minHeight: tight ? 32 : 36)
        .background(isSelected ? BrandColor.ink : Color.clear, in: Capsule())
        .contentShape(Capsule())
    }
}

#Preview("Segmented control") {
    @Previewable @State var choice = 1
    return VStack(spacing: 16) {
        SegmentedControl(
            options: [
                SegmentedOption(0, title: "Open"),
                SegmentedOption(1, title: "Mine"),
                SegmentedOption(2, title: "All"),
            ],
            selection: $choice
        )
        SegmentedControl(
            options: [
                SegmentedOption(0, systemImage: "list.bullet", accessibilityLabel: "List"),
                SegmentedOption(1, systemImage: "map", accessibilityLabel: "Map"),
            ],
            selection: $choice,
            fill: false
        )
    }
    .padding()
    .background(BrandColor.canvas)
}
