package com.loonext.android.features.settings

/**
 * #727: the settings sections under their group headings.
 *
 * Hand-ported from packages/shared/src/settings-groups.ts; SettingsGroupsTest
 * pins this table to that one. Entries are the SHARED section ids, because the
 * shared "hours" id covers both Hours and Automatic texts here. A section this
 * phone does not have (Blocked numbers, History) is simply absent from the
 * rows, never from the table.
 */
internal enum class SettingsGroup(
    val id: String,
    val titleKey: String,
    val sharedIds: List<String>,
) {
    Workspace("workspace", "settingsMore.groupWorkspace", listOf("workspace", "team", "ai")),
    Messages("messages", "settingsMore.groupMessages", listOf("hours", "templates")),
    Phone("phone", "settingsMore.groupPhone", listOf("numbers", "calling", "blockedNumbers")),
    Billing("billing", "settingsMore.groupBilling", listOf("usage", "billing", "payments")),
    You("you", "settingsMore.groupYou", listOf("notifications", "profile", "account", "devices")),
    Developers("developers", "settingsMore.groupDevelopers", listOf("webhooks", "apiKeys")),
    Support("support", "settingsMore.groupSupport", listOf("history", "help", "whatsNew")),
}

/** The shared section id this phone's section stands for. */
internal val SettingsSection.sharedId: String
    get() = when (this) {
        SettingsSection.Workspace -> "workspace"
        SettingsSection.Hours, SettingsSection.AutomaticTexts -> "hours"
        SettingsSection.Calling -> "calling"
        SettingsSection.Templates -> "templates"
        SettingsSection.Team -> "team"
        SettingsSection.Numbers -> "numbers"
        SettingsSection.Usage -> "usage"
        SettingsSection.Billing -> "billing"
        SettingsSection.Payments -> "payments"
        SettingsSection.Notifications -> "notifications"
        SettingsSection.Ai -> "ai"
        SettingsSection.Profile -> "profile"
        SettingsSection.Devices -> "devices"
        SettingsSection.Help -> "help"
        SettingsSection.WhatsNew -> "whatsNew"
        SettingsSection.Webhooks -> "webhooks"
        SettingsSection.ApiKeys -> "apiKeys"
    }

/** The group a section sits under. */
internal fun settingsGroupOf(section: SettingsSection): SettingsGroup =
    SettingsGroup.entries.first { section.sharedId in it.sharedIds }

/**
 * What this role sees, grouped: groups in display order, sections inside a
 * group in the table's order (Hours before Automatic texts, as declared), and
 * a group with nothing the role can open left out.
 */
internal fun groupedSettingsSections(role: String?): List<Pair<SettingsGroup, List<SettingsSection>>> {
    val visible = visibleSettingsSections(role)
    return SettingsGroup.entries.mapNotNull { group ->
        val rows = visible
            .filter { it.sharedId in group.sharedIds }
            .sortedBy { group.sharedIds.indexOf(it.sharedId) }
        if (rows.isEmpty()) null else group to rows
    }
}
