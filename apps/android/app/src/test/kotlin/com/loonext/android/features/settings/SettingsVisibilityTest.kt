package com.loonext.android.features.settings

import com.loonext.android.core.model.Capability
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
        // #321: everybody paying for the product is entitled to know it got
        // better, so this is a personal section like the four above it.
        SettingsSection.WhatsNew,
    )

    /**
     * #286: not personal, but open to every role — the crew list is a READ,
     * and "a new member can identify the owner and the rest of the crew
     * without asking" is an Acceptance line that a hidden row cannot meet.
     * Kept out of [personal] because it is the business's, which is exactly
     * why it needs saying: every control on it is still team.manage.
     */
    private val readableByAll = setOf(SettingsSection.Team)

    @Test
    fun `a member sees what is theirs`() {
        val visible = visibleSettingsSections("member").toSet()
        assertEquals(personal + readableByAll, visible)
    }

    @Test
    fun `a member does not see the business's settings they cannot act on`() {
        val visible = visibleSettingsSections("member")
        // Two of the three the complaint named: a plan they cannot change and
        // a registration they cannot file. The third was Team, which #286
        // reopened as a read — see the test below.
        assertFalse(visible.contains(SettingsSection.Billing))
        assertFalse(visible.contains(SettingsSection.Numbers))
        // And the words the whole crew sends in the business's name.
        assertFalse(visible.contains(SettingsSection.Templates))
    }

    @Test
    fun `a member can see WHO is in the crew, and change nothing`() {
        // #286. A tech who wants to know who owns the workspace, or who to ask
        // about a thread, previously had no screen at all — and asking is the
        // cost the issue is about.
        assertTrue(visibleSettingsSections("member").contains(SettingsSection.Team))
        // The section is SHOWN on the baseline capability; acting on it is not.
        assertEquals(Capability.WORKSPACE_ACCESS, SettingsSection.Team.needs)
        assertFalse(SettingsRoleGate.canManageTeam("member"))
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
        // #315: the whole point of the preset. Billing, Usage and Getting paid
        // are the rows their role exists for; every other business row stays
        // hidden, including the conversations they have no access to at all.
        //
        // #224 added the third. It is deliberately NOT owner-only even though
        // CONNECTING the Stripe account is: opening the screen is how the
        // bookkeeper reaches the Stripe dashboard to issue a refund, which is
        // the task this role was created to make possible without sharing the
        // owner's login. The card itself still refuses them the connect button.
        val visible = visibleSettingsSections(MemberRole.BOOKKEEPER).toSet()
        assertEquals(
            personal + readableByAll + setOf(
                SettingsSection.Billing,
                SettingsSection.Usage,
                SettingsSection.Payments,
            ),
            visible,
        )
    }

    @Test
    fun `a view-only observer sees the same index a member does`() {
        // #315: read_only differs from a member in what it can DO, not in what
        // it sees — so the settings index answers exactly as it does for one.
        assertEquals(
            personal + readableByAll,
            visibleSettingsSections(MemberRole.READ_ONLY).toSet(),
        )
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
        // #286: `readableByAll` rides the BASELINE capability, which every
        // recognised role holds — including one this build has never heard of,
        // for the same reason Profile and Notifications do. Reaching a settings
        // screen at all means the server authorized a session in this workspace.
        assertEquals(personal + readableByAll, visibleSettingsSections(null).toSet())
        assertEquals(personal + readableByAll, visibleSettingsSections("").toSet())
        assertEquals(personal + readableByAll, visibleSettingsSections("superuser").toSet())
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
