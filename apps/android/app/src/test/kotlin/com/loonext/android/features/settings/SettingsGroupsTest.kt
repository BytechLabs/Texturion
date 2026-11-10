package com.loonext.android.features.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** #727: the group table is the shared one, and every section is under one group. */
class SettingsGroupsTest {

    /**
     * Copied from SETTINGS_GROUPS in packages/shared/src/settings-groups.ts,
     * the source of truth. Change that file first, then this table.
     */
    private val shared = listOf(
        "workspace" to listOf("workspace", "team", "ai"),
        "messages" to listOf("hours", "templates"),
        "phone" to listOf("numbers", "calling", "blockedNumbers"),
        "billing" to listOf("usage", "billing", "payments"),
        "you" to listOf("notifications", "profile", "account", "devices"),
        "developers" to listOf("webhooks", "apiKeys"),
        "support" to listOf("history", "help", "whatsNew"),
    )

    @Test
    fun `the group table equals the shared one`() {
        assertEquals(shared, SettingsGroup.entries.map { it.id to it.sharedIds })
    }

    @Test
    fun `no section id is repeated across groups`() {
        val all = SettingsGroup.entries.flatMap { it.sharedIds }
        assertEquals(all.toSet().size, all.size)
    }

    @Test
    fun `every section on this phone is under exactly one group`() {
        for (section in SettingsSection.entries) {
            val homes = SettingsGroup.entries.filter { section.sharedId in it.sharedIds }
            assertEquals("$section", 1, homes.size)
        }
    }

    @Test
    fun `every shared id the phone uses is in the table`() {
        val ids = SettingsGroup.entries.flatMap { it.sharedIds }.toSet()
        assertTrue(SettingsSection.entries.all { it.sharedId in ids })
    }

    @Test
    fun `an owner sees every section once, in group order`() {
        val grouped = groupedSettingsSections("owner")
        assertEquals(SettingsSection.entries.toSet(), grouped.flatMap { it.second }.toSet())
        assertEquals(SettingsSection.entries.size, grouped.sumOf { it.second.size })
        assertEquals(SettingsGroup.entries, grouped.map { it.first })
        val messages = grouped.first { it.first == SettingsGroup.Messages }.second
        assertEquals(
            listOf(SettingsSection.Hours, SettingsSection.AutomaticTexts, SettingsSection.Templates),
            messages,
        )
    }

    @Test
    fun `a member sees only the groups holding something they can open`() {
        val grouped = groupedSettingsSections("member")
        assertEquals(
            listOf(SettingsGroup.Workspace, SettingsGroup.You, SettingsGroup.Support),
            grouped.map { it.first },
        )
        assertEquals(listOf(SettingsSection.Team), grouped[0].second)
    }

    @Test
    fun `a bookkeeper lands on billing first`() {
        val grouped = groupedSettingsSections("bookkeeper")
        assertTrue(grouped.none { it.second.isEmpty() })
        assertTrue(grouped.any { it.first == SettingsGroup.Billing })
    }
}
