import SwiftUI

/// #749: under a setting that can lose a customer, who chose the value it has
/// now and when, once it is off its default.
///
/// Silent at the default, and silent for a role without `settings.manage` (the
/// server refuses the list to them anyway). It reads again whenever `current`
/// changes, which is how a save refreshes it: the card hands back the updated
/// company, `current` moves, and the line follows the new value.
@MainActor
struct SettingChoiceNote: View {
    let scope: SettingsScope
    let settingKey: String
    /// The control's saved value, as the wire spells it.
    let current: JSONValue
    /// The default as this control names it, e.g. "Ring everyone".
    let defaultLabel: String

    @State private var choices: [SettingChoice] = []

    @Environment(\.appLocale) private var appLocale

    private var allowed: Bool {
        MemberRole.has(scope.role, Capability.settingsManage)
    }

    private var text: String? {
        guard allowed else { return nil }
        return settingChoiceText(
            choice: choices.first { $0.key == settingKey },
            current: current,
            defaultLabel: defaultLabel,
            locale: appLocale
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let text {
                Text(text)
                    .font(.golos(13))
                    .foregroundStyle(BrandColor.muted500)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 4)
            }
        }
        .task(id: "\(scope.companyId)|\(settingKey)|\(String(describing: current))") {
            await load()
        }
    }

    private func load() async {
        guard allowed else { return }
        if let fetched = try? await scope.repo.settingChoices(scope.companyId) {
            choices = fetched.data
        }
    }
}
