import SwiftUI

/// #693: the Repeat sheet.
///
/// Two kinds, in plain words: "On a schedule" (fixed dates, whether or not the
/// last one got done) and "After it's done" (the next one starts when this one
/// is finished). A schedule counts from the due date, so without one it is
/// switched off and says why instead of failing later. Pause and Stop live here
/// too, but only for a repeat that already exists.
@MainActor
struct TaskRepeatSheet: View {
    let hasDue: Bool
    let isEditing: Bool
    let onSave: @MainActor (TaskRepeatDraft) -> Void
    let onRemove: @MainActor () -> Void

    @State private var draft: TaskRepeatDraft

    @Environment(\.dismiss) private var dismiss
    @Environment(\.appLocale) private var appLocale

    init(
        initial: TaskRepeatDraft,
        hasDue: Bool,
        isEditing: Bool,
        onSave: @escaping @MainActor (TaskRepeatDraft) -> Void,
        onRemove: @escaping @MainActor () -> Void
    ) {
        self.hasDue = hasDue
        self.isEditing = isEditing
        self.onSave = onSave
        self.onRemove = onRemove
        _draft = State(initialValue: initial)
    }

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                header
                kindSection
                intervalSection
                if draft.kind == TaskRepeatKind.schedule {
                    scheduleSection
                }
                endsSection
                if isEditing {
                    editingSection
                }
                problemLine
                saveButton
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(BrandColor.canvas)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    // MARK: Sections

    private var header: some View {
        HStack(alignment: .top) {
            Text(t("contactsTasks.repeat"))
                .font(.golos(21, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.scaled(13, weight: .semibold))
                    .foregroundStyle(BrandColor.muted700)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(BrandColor.inset))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(t("common.cancel"))
        }
    }

    private var kindSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            kindRow(
                kind: TaskRepeatKind.schedule,
                titleKey: "contactsTasks.repeatKindSchedule",
                subtitle: hasDue
                    ? t("contactsTasks.repeatKindScheduleHint")
                    : t("contactsTasks.repeatNeedsDue"),
                enabled: hasDue
            )
            kindRow(
                kind: TaskRepeatKind.afterDone,
                titleKey: "contactsTasks.repeatKindAfterDone",
                subtitle: t("contactsTasks.repeatKindAfterDoneHint"),
                enabled: true
            )
        }
    }

    private func kindRow(
        kind: String,
        titleKey: String,
        subtitle: String,
        enabled: Bool
    ) -> some View {
        let selected = draft.kind == kind
        return Button {
            if enabled {
                Haptics.tap()
                draft.setKind(kind)
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.scaled(20))
                    .foregroundStyle(selected ? BrandColor.ink : BrandColor.muted250)
                VStack(alignment: .leading, spacing: 2) {
                    Text(t(titleKey))
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Text(subtitle)
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 15)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(
                BrandColor.paper,
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(selected ? BrandColor.ink : Color.clear, lineWidth: 2)
            )
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.55)
        .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : [])
    }

    private var intervalSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(
                label: t(
                    draft.kind == TaskRepeatKind.afterDone
                        ? "contactsTasks.repeatAfterLabel"
                        : "contactsTasks.repeatEveryLabel"
                )
            )
            Stepper(value: $draft.every, in: 1 ... 99) {
                Text(String(draft.every))
                    .font(.golos(16, weight: .semibold))
                    .foregroundStyle(BrandColor.ink)
                    .monospacedDigit()
            }
            .frame(minHeight: 44)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(TaskRepeatDraft.units(for: draft.kind), id: \.self) { unit in
                        TaskChoiceChip(
                            title: t(unitKey(unit)),
                            selected: draft.unit == unit
                        ) { draft.unit = unit }
                    }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
        }
    }

    private func unitKey(_ unit: String) -> String {
        switch unit {
        case TaskRepeatUnit.week: return "contactsTasks.repeatUnitWeeks"
        case TaskRepeatUnit.month: return "contactsTasks.repeatUnitMonths"
        case TaskRepeatUnit.year: return "contactsTasks.repeatUnitYears"
        default: return "contactsTasks.repeatUnitDays"
        }
    }

    @ViewBuilder
    private var scheduleSection: some View {
        if draft.unit == TaskRepeatUnit.week {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(label: t("contactsTasks.repeatOnDays"))
                weekdayChips(selected: draft.weekdays, multiple: true) { day in
                    toggleWeekday(day)
                }
            }
        } else if draft.unit == TaskRepeatUnit.month {
            monthSection
        }
    }

    private var monthSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(label: t("contactsTasks.repeatOnLabel"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    TaskChoiceChip(
                        title: t("contactsTasks.repeatModeDay"),
                        selected: draft.monthMode == .day
                    ) { draft.monthMode = .day }
                    TaskChoiceChip(
                        title: t("contactsTasks.repeatModeNth"),
                        selected: draft.monthMode == .nth
                    ) { draft.monthMode = .nth }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
            if draft.monthMode == .day {
                Stepper(value: $draft.monthDay, in: 1 ... 31) {
                    Text(t("contactsTasks.repeatDayN", ["day": String(draft.monthDay)]))
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                }
                .frame(minHeight: 44)
            } else {
                nthChips
                weekdayChips(selected: [draft.nthWeekday], multiple: false) { day in
                    draft.nthWeekday = day
                }
            }
        }
    }

    private var nthChips: some View {
        let options: [(Int, String)] = [
            (1, "contactsTasks.nthFirst"),
            (2, "contactsTasks.nthSecond"),
            (3, "contactsTasks.nthThird"),
            (4, "contactsTasks.nthFourth"),
            (-1, "contactsTasks.nthLast"),
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(options.enumerated()), id: \.offset) { _, option in
                    TaskChoiceChip(
                        title: t(option.1),
                        selected: draft.nth == option.0
                    ) { draft.nth = option.0 }
                }
            }
            .padding(.horizontal, 1)
            .padding(.vertical, 2)
        }
    }

    private func weekdayChips(
        selected: [Int],
        multiple: Bool,
        onTap: @escaping @MainActor (Int) -> Void
    ) -> some View {
        let keys = [
            "contactsTasks.weekdayMon", "contactsTasks.weekdayTue", "contactsTasks.weekdayWed",
            "contactsTasks.weekdayThu", "contactsTasks.weekdayFri", "contactsTasks.weekdaySat",
            "contactsTasks.weekdaySun",
        ]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(keys.enumerated()), id: \.offset) { index, key in
                    TaskChoiceChip(
                        title: t(key),
                        selected: selected.contains(index + 1)
                    ) { onTap(index + 1) }
                }
            }
            .padding(.horizontal, 1)
            .padding(.vertical, 2)
        }
    }

    private func toggleWeekday(_ day: Int) {
        if draft.weekdays.contains(day) {
            draft.weekdays.removeAll { $0 == day }
        } else {
            draft.weekdays = (draft.weekdays + [day]).sorted()
        }
    }

    private var endsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(label: t("contactsTasks.repeatEnds"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    TaskChoiceChip(
                        title: t("contactsTasks.repeatEndsNever"),
                        selected: draft.endsKind == "never"
                    ) { draft.endsKind = "never" }
                    TaskChoiceChip(
                        title: t("contactsTasks.repeatEndsOn"),
                        selected: draft.endsKind == "on"
                    ) { draft.endsKind = "on" }
                    TaskChoiceChip(
                        title: t("contactsTasks.repeatEndsAfter"),
                        selected: draft.endsKind == "after"
                    ) { draft.endsKind = "after" }
                }
                .padding(.horizontal, 1)
                .padding(.vertical, 2)
            }
            if draft.endsKind == "on" {
                DatePicker(
                    t("contactsTasks.repeatEndsOn"),
                    selection: $draft.endsOn,
                    displayedComponents: [.date]
                )
                .frame(minHeight: 44)
            } else if draft.endsKind == "after" {
                Stepper(value: $draft.endsAfter, in: 1 ... 999) {
                    Text(t("contactsTasks.repeatTimes", ["count": String(draft.endsAfter)]))
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                }
                .frame(minHeight: 44)
            }
        }
    }

    private var editingSection: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(isOn: $draft.paused) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(t("contactsTasks.repeatPause"))
                        .font(.golos(14, weight: .semibold))
                        .foregroundStyle(BrandColor.ink)
                    Text(t("contactsTasks.repeatPauseHint"))
                        .font(.golos(12))
                        .foregroundStyle(BrandColor.muted500)
                }
            }
            .frame(minHeight: 44)
            Button(role: .destructive) {
                onRemove()
                dismiss()
            } label: {
                Text(t("contactsTasks.repeatStop"))
                    .font(.golos(13.5, weight: .semibold))
                    .foregroundStyle(BrandColor.destructive)
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private var problemLine: some View {
        if let problem = draft.problem(hasDue: hasDue) {
            Text(t(problem.messageKey))
                .font(.golos(12))
                .foregroundStyle(BrandColor.overdueAmber)
        }
    }

    private var saveButton: some View {
        let blocked = draft.problem(hasDue: hasDue) != nil
        return Button {
            Haptics.confirm()
            onSave(draft)
            dismiss()
        } label: {
            HStack(spacing: 10) {
                Text(t("common.save"))
                    .font(.golos(15, weight: .semibold))
                    .foregroundStyle(BrandColor.canvas)
                Spacer()
                Image(systemName: "checkmark")
                    .font(.scaled(15, weight: .bold))
                    .foregroundStyle(BrandColor.onLime)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(BrandColor.lime))
            }
            .padding(.leading, 22)
            .padding(.trailing, 8)
            .padding(.vertical, 8)
            .background(Capsule().fill(BrandColor.ink))
        }
        .buttonStyle(.plain)
        .disabled(blocked)
        .opacity(blocked ? 0.5 : 1)
        .accessibilityLabel(t("common.save"))
    }
}

// MARK: - New-task rows

/// Priority, Labels and Repeat for the New task sheet, under More. Title stays
/// first; all three have a default, so none has to be touched.
@MainActor
struct TaskDraftMetaSection: View {
    @Binding var meta: TaskDraftMeta
    let tags: [Tag]
    let due: Date?
    /// A job tied to a customer defaults to "after it's done".
    let linkedToCustomer: Bool

    @State private var repeatOpen = false

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        AppStrings.translate(appLocale, key, vars)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 15) {
            priorityBlock
            labelsBlock
            repeatBlock
        }
        .sheet(isPresented: $repeatOpen) {
            TaskRepeatSheet(
                initial: meta.repeatDraft ?? TaskRepeatDraft.starting(
                    due: due,
                    afterDone: linkedToCustomer
                ),
                hasDue: due != nil,
                isEditing: meta.repeatDraft != nil,
                onSave: { meta.repeatDraft = $0 },
                onRemove: { meta.repeatDraft = nil }
            )
        }
    }

    private var priorityBlock: some View {
        VStack(alignment: .leading, spacing: 0) {
            SectionHeader(label: t("contactsTasks.priority"))
            TaskPriorityChips(selection: meta.priority) { meta.priority = $0 }
        }
    }

    private var labelsBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(label: t("contactsTasks.labels"))
            TaskLabelsEditor(
                labels: meta.displayLabels(available: tags),
                available: tags,
                onAdd: { tagId, name in
                    meta.addLabel(tagId: tagId, name: name, available: tags)
                },
                onRemove: { meta.removeLabel(id: $0) }
            )
        }
    }

    private var repeatBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionHeader(label: t("contactsTasks.repeat"))
            Button {
                repeatOpen = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "repeat")
                        .font(.scaled(13, weight: .medium))
                        .foregroundStyle(BrandColor.muted500)
                    Text(repeatValue)
                        .font(.golos(14, weight: meta.repeatDraft == nil ? .regular : .semibold))
                        .foregroundStyle(
                            meta.repeatDraft == nil ? BrandColor.muted500 : BrandColor.ink
                        )
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.scaled(12, weight: .medium))
                        .foregroundStyle(BrandColor.muted250)
                }
                .padding(.horizontal, 15)
                .padding(.vertical, 13)
                .frame(minHeight: 44)
                .background(
                    BrandColor.paper,
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if let draft = meta.repeatDraft, let problem = draft.problem(hasDue: due != nil) {
                Text(t(problem.messageKey))
                    .font(.golos(12))
                    .foregroundStyle(BrandColor.overdueAmber)
            }
        }
    }

    private var repeatValue: String {
        guard let draft = meta.repeatDraft else {
            return t("contactsTasks.repeatNone")
        }
        return taskRepeatDetailLine(draft.asRule(), locale: appLocale)
    }
}
