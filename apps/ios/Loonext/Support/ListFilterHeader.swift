import SwiftUI

/// #711: the header every filterable list shares. One row under the search box: the
/// list's own status tabs on the left, then the Filter button and the Views menu. The
/// applied filters show as removable chips only while any is on.
///
/// Applying: Zen of Clarity (secondary actions live in two controls and a menu), Chunking
/// (one control per concept) and the Safety principle (the inbox, Tasks and Contacts
/// lists all read the same).

/// One saved view in the Views menu.
struct ViewsMenuEntry: Identifiable, Equatable {
    let id: String
    let name: String
    /// The queue badge, or nil where the surface has none.
    let count: Int?
    let shared: Bool
    let isDefault: Bool
}

/// What the Views menu needs from a list. A list with no saved views passes nil.
struct ListViewsModel {
    let entries: [ViewsMenuEntry]
    /// The saved view the filters on screen equal, if any.
    let activeId: String?
    /// True only when something is filtered and no saved view matches it.
    let canSaveCurrent: Bool
    /// Sharing a view is workspace configuration, so it rides the capability the server
    /// gates it on.
    let canShare: Bool
    let onApply: @MainActor (String) -> Void
    let onSaveCurrent: @MainActor () -> Void
    let onDefault: @MainActor (String?) -> Void
    let onRename: @MainActor (String, String) -> Void
    let onShare: @MainActor (String, Bool) -> Void
    let onDelete: @MainActor (String) -> Void
}

/// The one row: the list's status tabs (scrollable), then Filter, then Views. `views` is
/// nil for a list that has no saved views.
@MainActor
struct ListFilterRow<Tabs: View>: View {
    let filterCount: Int
    let onFilter: @MainActor () -> Void
    let views: ListViewsModel?
    let tabs: Tabs

    init(
        filterCount: Int,
        onFilter: @escaping @MainActor () -> Void,
        views: ListViewsModel? = nil,
        @ViewBuilder tabs: () -> Tabs
    ) {
        self.filterCount = filterCount
        self.onFilter = onFilter
        self.views = views
        self.tabs = tabs()
    }

    var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 7) {
                    tabs
                }
                .padding(.vertical, 4)
            }
            ListFilterButton(count: filterCount, onTap: onFilter)
            if let views {
                ListViewsMenu(model: views)
            }
        }
        .padding(.horizontal, 18)
    }
}

/// The Filter button: an icon that says how many filters are on.
@MainActor
struct ListFilterButton: View {
    let count: Int
    let onTap: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    private var name: String {
        count > 0
            ? AppStrings.translate(appLocale, "inbox.filterActionCount", ["count": String(count)])
            : AppStrings.translate(appLocale, "inbox.filterAction")
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 5) {
                Image(systemName: "line.3.horizontal.decrease")
                    .font(.scaled(IconSize.standard, weight: .semibold))
                if count > 0 {
                    CountPill(count, tone: .primary)
                }
            }
            .foregroundStyle(BrandColor.muted700)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(BrandColor.paper, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(name)
    }
}

/// The Views menu: the saved views, "Save these filters as a view…" only when the filters
/// on screen match no saved view, and "Manage views".
@MainActor
struct ListViewsMenu: View {
    let model: ListViewsModel

    @Environment(\.appLocale) private var appLocale
    @State private var managing = false

    private var activeName: String {
        model.entries.first { $0.id == model.activeId }?.name
            ?? AppStrings.translate(appLocale, "inbox.viewsMenu")
    }

    private func entryTitle(_ entry: ViewsMenuEntry) -> String {
        guard let count = entry.count, count > 0 else { return entry.name }
        return "\(entry.name)  \(formatViewCount(count))"
    }

    var body: some View {
        Menu {
            if model.entries.isEmpty && !model.canSaveCurrent {
                Text(AppStrings.translate(appLocale, "inbox.viewsNone"))
            }
            ForEach(model.entries) { entry in
                Button {
                    model.onApply(entry.id)
                } label: {
                    if entry.id == model.activeId {
                        Label(entryTitle(entry), systemImage: "checkmark")
                    } else if entry.isDefault {
                        Label(entryTitle(entry), systemImage: "star")
                    } else {
                        Text(entryTitle(entry))
                    }
                }
            }
            if model.canSaveCurrent {
                Button(AppStrings.translate(appLocale, "inbox.viewsSaveCurrent")) {
                    model.onSaveCurrent()
                }
            }
            if !model.entries.isEmpty {
                Button(AppStrings.translate(appLocale, "inbox.viewsManage")) {
                    managing = true
                }
            }
        } label: {
            Image(systemName: "bookmark")
                .font(.scaled(IconSize.standard, weight: .semibold))
                .foregroundStyle(model.activeId != nil ? BrandColor.paper : BrandColor.muted700)
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .background(
                    model.activeId != nil ? BrandColor.ink : BrandColor.paper,
                    in: Capsule()
                )
                .contentShape(Capsule())
        }
        .accessibilityLabel(
            AppStrings.translate(appLocale, "inbox.viewsMenuAria", ["current": activeName])
        )
        .sheet(isPresented: $managing) {
            ManageViewsSheet(model: model)
        }
    }
}

/// Manage views: set the default, rename, share with the crew and delete. A view the crew
/// shares is not the person's to change unless they can manage the workspace, and deleting
/// one asks first because the rest of the crew opens it.
@MainActor
private struct ManageViewsSheet: View {
    let model: ListViewsModel

    @Environment(\.appLocale) private var appLocale
    @Environment(\.dismiss) private var dismiss
    @State private var renaming: ViewsMenuEntry?
    @State private var draft = ""
    @State private var deleting: ViewsMenuEntry?

    var body: some View {
        NavigationStack {
            List {
                ForEach(model.entries) { entry in
                    row(entry)
                }
            }
            .navigationTitle(AppStrings.translate(appLocale, "inbox.viewsManage"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(AppStrings.translate(appLocale, "common.close")) { dismiss() }
                }
            }
            .alert(
                AppStrings.translate(appLocale, "inbox.viewRenameTitle"),
                isPresented: Binding(
                    get: { renaming != nil },
                    set: { if !$0 { renaming = nil } }
                )
            ) {
                TextField(AppStrings.translate(appLocale, "inbox.viewNameLabel"), text: $draft)
                Button(AppStrings.translate(appLocale, "common.save")) {
                    if let entry = renaming, !draft.trimmingCharacters(in: .whitespaces).isEmpty {
                        model.onRename(entry.id, draft)
                    }
                    renaming = nil
                }
                Button(AppStrings.translate(appLocale, "common.cancel"), role: .cancel) {
                    renaming = nil
                }
            }
            .confirmDialog(
                AppStrings.translate(appLocale, "inbox.viewDeleteTitle"),
                item: $deleting,
                message: { entry in
                    AppStrings.translate(
                        appLocale,
                        "inbox.viewDeleteBody",
                        ["name": entry.name]
                    )
                },
                confirmLabel: AppStrings.translate(appLocale, "inbox.viewDeleteConfirm"),
                cancelLabel: AppStrings.translate(appLocale, "inbox.viewDeleteKeep")
            ) { entry in
                model.onDelete(entry.id)
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder
    private func row(_ entry: ViewsMenuEntry) -> some View {
        let canManage = !entry.shared || model.canShare
        VStack(alignment: .leading, spacing: 6) {
            Text(entry.name)
                .font(.golos(14, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            HStack(spacing: 14) {
                Button(
                    entry.isDefault
                        ? AppStrings.translate(appLocale, "inbox.viewStopOpeningHere")
                        : AppStrings.translate(appLocale, "inbox.viewOpenHereByDefault")
                ) {
                    model.onDefault(entry.isDefault ? nil : entry.id)
                }
                if canManage {
                    Button(AppStrings.translate(appLocale, "inbox.viewRename")) {
                        draft = entry.name
                        renaming = entry
                    }
                }
            }
            if canManage {
                HStack(spacing: 14) {
                    if model.canShare {
                        Button(
                            entry.shared
                                ? AppStrings.translate(appLocale, "inbox.viewMakeMine")
                                : AppStrings.translate(appLocale, "inbox.viewShareWithCrew")
                        ) {
                            model.onShare(entry.id, !entry.shared)
                        }
                    }
                    Button(AppStrings.translate(appLocale, "common.delete"), role: .destructive) {
                        if entry.shared {
                            deleting = entry
                        } else {
                            model.onDelete(entry.id)
                        }
                    }
                }
            }
        }
        .font(.golos(12.5, weight: .medium))
        .buttonStyle(.borderless)
        .padding(.vertical, 4)
    }
}

/// One applied filter, removable.
struct ActiveFilterChip: Identifiable {
    let id: String
    let label: String
    let onRemove: @MainActor () -> Void
}

/// The applied filters as one scrolling line of removable chips with "Clear all". Nothing
/// renders while no filter is applied.
@MainActor
struct ActiveFilterChips: View {
    let chips: [ActiveFilterChip]
    let onClearAll: @MainActor () -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        if !chips.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(chips) { chip in
                        Button(action: chip.onRemove) {
                            HStack(spacing: 6) {
                                Text(chip.label)
                                    .font(.golos(12, weight: .medium))
                                Image(systemName: "xmark")
                                    .font(.scaled(9, weight: .semibold))
                            }
                            .foregroundStyle(BrandColor.ink)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .background(BrandColor.paper, in: Capsule())
                            .contentShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(
                            AppStrings.translate(
                                appLocale, "inbox.removeFilterAria", ["label": chip.label]
                            )
                        )
                    }
                    Button(AppStrings.translate(appLocale, "inbox.clearAll"), action: onClearAll)
                        .font(.golos(12, weight: .semibold))
                        .foregroundStyle(BrandColor.muted700)
                        .frame(minHeight: 44)
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, 18)
            }
        }
    }
}
