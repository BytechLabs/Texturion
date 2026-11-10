import SwiftUI

/// #689 — "Automatic texts": how the texts we send for you behave.
///
/// Design notes, and the principles behind them:
///
/// - **Smart defaults, stated.** Every control shows its current value and
///   names its own default in a caption, so nobody has to guess what
///   "unchanged" means. *Applying: Smart Defaults.*
/// - **Chunking.** Three groups of three or four rows: what happens when the
///   customer replies first, the rating question, and how long things wait.
///   Tight spacing inside a group, wide between groups. *Applying: Chunking &
///   Relationship Strength.*
/// - **No free-text numbers.** Each integer is chosen from a short fixed list
///   (plus the saved value when it is not on the list), so there is nothing to
///   mistype and no range to explain. *Applying: Zen of Clarity.*
/// - **Saves per control**, like the switches in Notifications: there is no
///   text to get wrong, so a Save button would be ceremony. A failed save shows
///   the usual inline error and the control keeps the saved value.
///
/// Admin-only, gated by `SettingsSection.needs`, and every control also asks
/// `SettingsRoleGate.canEditWorkspace`. Same sentences as web and Android.
@MainActor
struct AutomaticTextsSectionView: View {
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @Environment(\.appLocale) private var appLocale

    private func t(_ key: String) -> String {
        AppStrings.translate(appLocale, key)
    }

    var body: some View {
        Text(t("domain.autoTextsIntro"))
            .font(.golos(12))
            .foregroundStyle(BrandColor.muted600)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.bottom, 6)

        replyGroup
        Spacer().frame(height: 14)
        ratingGroup
        Spacer().frame(height: 14)
        waitGroup

        Text(t("domain.autoTextsFixedRules"))
            .font(.golos(11.5))
            .foregroundStyle(BrandColor.muted500)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 10)
    }

    private var replyGroup: some View {
        SettingsCard(
            title: t("domain.autoTextsHoldTitle"),
            description: t("domain.autoTextsHoldIntro")
        ) {
            VStack(alignment: .leading, spacing: 10) {
                AutoTextSwitchRow(
                    flag: .holdScheduled, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextSwitchRow(
                    flag: .holdReminders, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextSwitchRow(
                    flag: .holdRating, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextSwitchRow(
                    flag: .holdUnverifiedCalendar, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
            }
        }
    }

    private var ratingGroup: some View {
        SettingsCard(title: t("domain.autoTextsRatingTitle")) {
            VStack(alignment: .leading, spacing: 10) {
                AutoTextSwitchRow(
                    flag: .ratingEnabled, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextPickerRow(
                    number: .ratingDelay, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextPickerRow(
                    number: .ratingExpiry, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextPickerRow(
                    number: .ratingCooldown, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
            }
        }
    }

    private var waitGroup: some View {
        SettingsCard(title: t("domain.autoTextsWaitTitle")) {
            VStack(alignment: .leading, spacing: 10) {
                AutoTextPickerRow(
                    number: .scheduledExpiry, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextPickerRow(
                    number: .reminderExpiry, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
                AutoTextPickerRow(
                    number: .autoReplyCooldown, scope: scope, company: company,
                    onCompanyUpdated: onCompanyUpdated
                )
            }
        }
    }
}

/// One on/off setting: the title, what the position means, and the default.
@MainActor
private struct AutoTextSwitchRow: View {
    let flag: AutoTextFlag
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    private var supporting: String {
        let isOn = flag.value(in: company)
        var lines: [String] = []
        if let noteKey = flag.noteKey {
            lines.append(AppStrings.translate(appLocale, noteKey))
        }
        if let position = AutomaticTexts.positionCaption(flag, isOn: isOn, locale: appLocale) {
            lines.append(position)
        }
        lines.append(AutomaticTexts.defaultCaption(flag, locale: appLocale))
        return lines.joined(separator: "\n")
    }

    var body: some View {
        LabeledToggleRow(
            label: AppStrings.translate(appLocale, flag.titleKey),
            supporting: supporting,
            isOn: flag.value(in: company),
            enabled: canEdit && !saving
        ) { save($0) }
        .frame(minHeight: 44)

        InlineError(error)
    }

    private func save(_ isOn: Bool) {
        error = nil
        saving = true
        let body = AutomaticTexts.patch(flag, isOn: isOn)
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}

/// One integer setting, picked from a fixed list. The control shows the saved
/// value; the default is named beneath it.
@MainActor
private struct AutoTextPickerRow: View {
    let number: AutoTextNumber
    let scope: SettingsScope
    let company: CompanyView
    let onCompanyUpdated: @MainActor (CompanyView) -> Void

    @State private var saving = false
    @State private var error: String?

    @Environment(\.appLocale) private var appLocale

    private var canEdit: Bool { SettingsRoleGate.canEditWorkspace(scope.role) }

    var body: some View {
        let current = number.value(in: company)
        let title = AppStrings.translate(appLocale, number.titleKey)
        let defaultCaption = AutomaticTexts.defaultCaption(number, locale: appLocale)

        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.golos(13.5, weight: .semibold))
                .foregroundStyle(BrandColor.ink)
            Picker(
                title,
                selection: Binding(get: { current }, set: { save($0) })
            ) {
                ForEach(AutomaticTexts.choices(number, current: current), id: \.self) { value in
                    Text(AutomaticTexts.label(number, value: value, locale: appLocale))
                        .tag(value)
                }
            }
            .pickerStyle(.menu)
            .labelsHidden()
            .tint(BrandColor.olive)
            .frame(minHeight: 44, alignment: .leading)
            .disabled(!canEdit || saving)
            .accessibilityLabel(title)
            .accessibilityValue(
                AutomaticTexts.label(number, value: current, locale: appLocale)
            )
            .accessibilityHint(defaultCaption)
            Text(defaultCaption)
                .font(.golos(11.5))
                .foregroundStyle(BrandColor.muted500)
            InlineError(error)
        }
    }

    private func save(_ value: Int) {
        error = nil
        saving = true
        let body = AutomaticTexts.patch(number, value: value)
        Task {
            do {
                let updated = try await scope.repo.updateCompany(scope.companyId, patch: body)
                onCompanyUpdated(updated)
            } catch {
                self.error = error.userMessage
            }
            saving = false
        }
    }
}
