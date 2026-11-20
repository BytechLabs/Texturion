import SwiftUI

struct TaskPlannerHeader: View {
    let selected: TaskViewKind
    let onBack: @MainActor () -> Void
    let onSelect: @MainActor (TaskViewKind) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                ScreenTitle(text: AppStrings.translate(appLocale, "shell.navPlanner"))
                Spacer()
                Button(AppStrings.translate(appLocale, "shell.navTasks"), action: onBack)
            }
            SegmentedControl(
                options: [
                    SegmentedOption(.calendar, title: AppStrings.translate(appLocale, "shell.plannerSchedule")),
                    SegmentedOption(.board, title: AppStrings.translate(appLocale, "shell.plannerWorkload")),
                    SegmentedOption(.map, title: AppStrings.translate(appLocale, "shell.plannerRoutes")),
                ],
                selected: selected,
                onSelect: onSelect
            )
        }
        .padding(.horizontal, 18)
    }
}
