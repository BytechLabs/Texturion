package com.loonext.android.features.settings

import com.loonext.android.core.model.MemberRole
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #461 — "Why is member able to see all settings (sure they cant edit but they
 * can still see settings... why?)"
 *
 * Vectors shared with packages/shared/src/settings-visibility.test.ts and the
 * Swift port. Three hand-maintained section tables is how the clients drifted
 * in the first place.
 */
class SettingsVisibilityTest {

    private val personal = setOf(
        SettingsSection.Notifications,
        SettingsSection.Profile,
        SettingsSection.Devices,
        SettingsSection.Help,
    )

    @Test
    fun `a member sees what is theirs`() {
        val visible = visibleSettingsSections("member").toSet()
        assertEquals(personal, visible)
    }

    @Test
    fun `a member does not see the business's settings`() {
        val visible = visibleSettingsSections("member")
        // The three the complaint named: a plan they cannot change, roles they
        // cannot set, a registration they cannot file.
        assertFalse(visible.contains(SettingsSection.Billing))
        assertFalse(visible.contains(SettingsSection.Team))
        assertFalse(visible.contains(SettingsSection.Numbers))
        // And the words the whole crew sends in the business's name.
        assertFalse(visible.contains(SettingsSection.Templates))
    }

    @Test
    fun `an owner and an admin see everything`() {
        for (role in listOf("owner", "admin")) {
            assertEquals(
                "$role should see every section",
                SettingsSection.entries.toSet(),
                visibleSettingsSections(role).toSet(),
            )
        }
    }

    @Test
    fun `a bookkeeper sees billing and nothing else of the business`() {
        // #315: the whole point of the preset. Billing and Usage are the two
        // rows their role exists for; every other business row stays hidden,
        // including the conversations they have no access to at all.
        val visible = visibleSettingsSections(MemberRole.BOOKKEEPER).toSet()
        assertEquals(personal + setOf(SettingsSection.Billing, SettingsSection.Usage), visible)
    }

    @Test
    fun `a view-only observer sees no business settings`() {
        // #315: read_only differs from a member in what it can DO, not in what
        // it sees — so the settings index answers exactly as it does for one.
        assertEquals(personal, visibleSettingsSections(MemberRole.READ_ONLY).toSet())
    }

    @Test
    fun `no role gets an empty settings screen`() {
        // The #461 rule, held across every preset that exists now or later:
        // an index with nothing in it reads as a broken app.
        val roles = listOf(
            MemberRole.OWNER,
            MemberRole.ADMIN,
            MemberRole.MEMBER,
            MemberRole.READ_ONLY,
            MemberRole.BOOKKEEPER,
            null,
        )
        for (role in roles) {
            assertTrue("$role has an empty settings index", visibleSettingsSections(role).isNotEmpty())
        }
    }

    @Test
    fun `an unknown or absent role is treated as a member`() {
        // The safe way for a missing membership to fail is least privilege.
        assertEquals(personal, visibleSettingsSections(null).toSet())
        assertEquals(personal, visibleSettingsSections("").toSet())
        assertEquals(personal, visibleSettingsSections("superuser").toSet())
    }

    @Test
    fun `a member never gets an empty settings screen`() {
        // A settings index with nothing in it reads as broken.
        assertTrue(visibleSettingsSections("member").size >= 4)
    }

    @Test
    fun `the list keeps nav order`() {
        val visible = visibleSettingsSections("member")
        assertEquals(visible.sortedBy { it.ordinal }, visible)
    }
}
