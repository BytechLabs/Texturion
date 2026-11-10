import SwiftUI

/// #693: the small marks a task row wears, and the pickers that set them.
///
/// Zen of Clarity: a row shows a mark only when it says something. A normal
/// priority, an empty label list and a task that does not repeat draw nothing,
/// so the list reads the same as it did before and the exceptions stand out.

// MARK: - Marks on rows and cards

/// "High" / "Urgent" with a flag, in a label colour (never a fill, so it reads
/// in both themes). Low, normal and none draw nothing.
struct TaskPriorityMark: View {
    let priority: TaskPriority

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if priority.isFlagged {
            HStack(spacing: 3) {
                Image(systemName: "flag.fill")
                    .font(.scaled(10, weight: .semibold))
                Text(AppStrings.translate(appLocale, priority.labelKey))
                    .font(.golos(11, weight: .semibold))
            }
            .foregroundStyle(priority == .urgent ? BrandColor.destructive : BrandColor.overdueAmber)
            .accessibilityElement(children: .combine)
        }
    }
}

/// The repeat glyph. Spoken as "Repeating task" so the row says what the icon
/// means.
struct TaskRepeatMark: View {
    @Environment(\.appLocale) private var appLocale

    var body: some View {
        Image(systemName: "repeat")
            .font(.scaled(11, weight: .semibold))
            .foregroundStyle(BrandColor.muted500)
            .accessibilityLabel(AppStrings.translate(appLocale, "contactsTasks.repeatingTask"))
    }
}

/// Up to `limit` label chips, then "+N" for the rest.
struct TaskLabelChips: View {
    let labels: [TaskLabel]
    var limit: Int = 2

    var body: some View {
        if !labels.isEmpty {
            HStack(spacing: 4) {
                ForEach(Array(labels.prefix(limit)), id: \.id) { label in
                    chip(label.name)
                }
                if labels.count > limit {
                    chip("+\(labels.count - limit)")
                }
            }
        }
    }

    private func chip(_ text: String) -> some View {
        Text(text)
            .font(.golos(10.5, weight: .medium))
            .foregroundStyle(BrandColor.muted700)
            .lineLimit(1)
            .frame(maxWidth: 96)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(BrandColor.inset, in: Capsule())
    }
}

/// The one line under a list row's title or on a board card: priority, repeat
/// and labels. Draws nothing when none of them has anything to say.
struct TaskRowBadges: View {
    let task: TaskItem

    var body: some View {
        let priority = task.priorityValue
        let repeats = taskShowsRepeatIcon(task.repeatRule)
        if priority.isFlagged || repeats || !task.labelList.isEmpty {
            HStack(spacing: 8) {
                TaskPriorityMark(priority: priority)
                if repeats { TaskRepeatMark() }
                TaskLabelChips(labels: task.labelList)
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Pickers

/// A pill that is on or off, 44pt tall: the chip every #693 picker uses.
struct TaskChoiceChip: View {
    let title: String
    let selected: Bool
    var enabled: Bool = true
    let onTap: @MainActor () -> Void

    var body: some View {
        Button(action: onTap) {
            Text(title)
                .font(.golos(12.5, weight: selected ? .semibold : .medium))
                .foregroundStyle(selected ? BrandColor.ink : BrandColor.muted700)
                .padding(.horizontal, 13)
                .frame(minHeight: 44)
                .background(BrandColor.paper, in: Capsule())
                .overlay(
                    Capsule().strokeBorder(
                        selected ? BrandColor.ink : Color.clear,
                        lineWidth: 2
                    )
                )
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.5)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : [])
    }
}

/// Priority as a row of chips. `onPick` gets the new value.
struct TaskPriorityChips: View {
    let selection: TaskPriority
    let onPick: @MainActor (TaskPriority) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(TaskPriority.allCases) { priority in
                    TaskChoiceChip(
                        title: AppStrings.translate(appLocale, priority.labelKey),
                        selected: selection == priority
                    ) { onPick(priority) }
                }
            }
            .padding(.horizontal, 1)
            .padding(.vertical, 2)
        }
    }
}

/// The labels on a task, with a quiet "add" chip. Choosing an existing tag
/// calls `onAdd(id, nil)`; a typed name calls `onAdd(nil, name)`, and the host
/// decides whether that makes a tag now or when the task exists.
struct TaskLabelsEditor: View {
    let labels: [TaskLabel]
    let available: [Tag]
    var disabled: Bool = false
    let onAdd: (_ tagId: String?, _ name: String?) -> Void
    let onRemove: (_ tagId: String) -> Void

    @State private var creating = false
    @State private var draft = ""

    @Environment(\.appLocale) private var appLocale

    private var unattached: [Tag] {
        available.filter { tag in !labels.contains { $0.id == tag.id } }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(labels, id: \.id) { label in
                        labelChip(label)
                    }
                    if !disabled { addMenu }
                }
                .padding(.vertical, 1)
            }
            if creating { createRow }
        }
    }

    private func labelChip(_ label: TaskLabel) -> some View {
        Button {
            onRemove(label.id)
        } label: {
            HStack(spacing: 5) {
                Text(label.name)
                    .font(.golos(13))
                    .lineLimit(1)
                if !disabled {
                    Image(systemName: "xmark")
                        .font(.scaled(10, weight: .semibold))
                }
            }
            .padding(.horizontal, 11)
            .frame(minHeight: 44)
            .background(BrandColor.limeChip, in: Capsule())
            .foregroundStyle(BrandColor.onLimeChip)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(
            AppStrings.translate(
                appLocale, "contactsTasks.labelRemove", ["name": label.name]
            )
        )
    }

    private var addMenu: some View {
        Menu {
            ForEach(unattached, id: \.id) { tag in
                Button(tag.name) { onAdd(tag.id, nil) }
            }
            Button(AppStrings.translate(appLocale, "contactsTasks.labelNew")) {
                creating = true
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: "plus")
                    .font(.scaled(10, weight: .semibold))
                Text(AppStrings.translate(appLocale, "contactsTasks.labelAdd"))
                    .font(.golos(13))
            }
            .padding(.horizontal, 11)
            .frame(minHeight: 44)
            .background(BrandColor.inset, in: Capsule())
            .foregroundStyle(BrandColor.muted600)
        }
    }

    private var createRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField(
                AppStrings.translate(appLocale, "contactsTasks.labelFindOrCreate"),
                text: $draft
            )
            .font(.golos(13))
            .textFieldStyle(.roundedBorder)
            HStack(spacing: 12) {
                Button(AppStrings.translate(appLocale, "contactsTasks.tagCreate")) {
                    let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    onAdd(nil, name)
                    draft = ""
                    creating = false
                }
                .font(.golos(13, weight: .semibold))
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Button(AppStrings.translate(appLocale, "common.cancel")) {
                    draft = ""
                    creating = false
                }
                .font(.golos(13))
                .foregroundStyle(BrandColor.muted600)
            }
            .frame(minHeight: 44)
        }
    }
}
