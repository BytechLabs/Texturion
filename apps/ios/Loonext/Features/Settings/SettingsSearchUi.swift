import SwiftUI

/// #719: the search field at the top of the settings home.
struct SettingsSearchField: View {
    @Binding var query: String

    @Environment(\.appLocale) private var appLocale

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.scaled(14))
                .foregroundStyle(BrandColor.muted600)
                .accessibilityHidden(true)
            TextField(
                AppStrings.translate(appLocale, "settingsMore.searchPlaceholder"),
                text: $query
            )
            .font(.golos(14))
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.scaled(15))
                        .foregroundStyle(BrandColor.muted600)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(AppStrings.translate(appLocale, "settingsMore.searchClear"))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(BrandColor.paper, in: Capsule())
    }
}

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
            Text(
                AppStrings.translate(
                    appLocale,
                    "settingsMore.searchEmpty",
                    ["query": query.trimmingCharacters(in: .whitespaces)]
                )
            )
            .font(.golos(13))
            .foregroundStyle(BrandColor.muted600)
            .padding(.horizontal, 4)
            .padding(.vertical, 8)
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
