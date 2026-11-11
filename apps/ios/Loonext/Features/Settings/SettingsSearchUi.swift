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
