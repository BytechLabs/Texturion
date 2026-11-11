import SwiftUI

/// What the search found: each setting with where it lives, "Group › Section".
/// A tap opens the section scrolled to the setting.
struct SettingsSearchResults: View {
    let query: String
    let visible: [SettingsSection]
    let onOpen: (SettingsSection, String) -> Void

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        let results = searchPhoneSettings(query, locale: appLocale, visible: visible)
        if results.isEmpty {
            EmptyState(
                title: AppStrings.translate(
                    appLocale,
                    "settingsMore.searchEmpty",
                    ["query": query.trimmingCharacters(in: .whitespaces)]
                ),
                size: .panel
            )
        } else {
            PaperCard {
                ForEach(Array(results.enumerated()), id: \.element.id) { index, result in
                    if index > 0 { RowDivider() }
                    Button {
                        onOpen(result.section, result.entry.anchor)
                    } label: {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(result.label)
                                .font(.golos(13.5, weight: .semibold))
                                .foregroundStyle(BrandColor.ink)
                            Text(
                                AppStrings.translate(
                                    appLocale,
                                    "settingsMore.searchPath",
                                    [
                                        "group": AppStrings.translate(appLocale, result.group.titleKey),
                                        "section": AppStrings.translate(appLocale, result.section.titleKey),
                                    ]
                                )
                            )
                            .font(.golos(11))
                            .foregroundStyle(BrandColor.muted600)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 15)
                        .padding(.vertical, 11)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// Settings searched for "time zone", as the real search draws it: the box,
/// then the results. For the #238 accessibility audit and its screenshots.
@MainActor
func settingsSearchFixture() -> some View {
    ScrollView {
        VStack(alignment: .leading, spacing: 13) {
            ScreenTitle(text: AppStrings.translate(nil, "shell.settings"))
            SearchField(
                query: .constant("time zone"),
                placeholder: AppStrings.translate(nil, "settingsMore.searchPlaceholder"),
                clearLabel: AppStrings.translate(nil, "settingsMore.searchClear")
            )
            SettingsSearchResults(
                query: "time zone",
                visible: Array(SettingsSection.allCases),
                onOpen: { _, _ in }
            )
        }
        .padding(.horizontal, 18)
        .padding(.top, 8)
        .padding(.bottom, 24)
    }
    .background(BrandColor.canvas)
}
