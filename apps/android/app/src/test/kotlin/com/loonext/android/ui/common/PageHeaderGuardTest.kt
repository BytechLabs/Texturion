package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #733: a phone page header is a title, one main action and secondary actions,
 * and each is one shared piece: the title is [ScreenTitle], the main action is
 * [MainActionButton] (`MainActionWiringTest` pins where it sits), and a
 * secondary action is [PaperIconButton]. Fails on a page that draws its own
 * 30sp title or its own 44dp icon circle, and on a tab that stopped using
 * [ScreenTitle]. The web twin is `page-header.test.ts`.
 */
class PageHeaderGuardTest {
    private val ownTitle = "hand-built page title"
    private val ownCircle = "hand-built 44dp icon circle"

    private val guard = PatternGuard(
        name = "PageHeaderGuardTest",
        home = setOf("ui/common/Ds.kt", "ui/common/PaperIconButton.kt"),
        rules = listOf(
            GuardRule(ownTitle) { source ->
                MainSourceScan.calls(source.text, "Text").count { Regex("""headlineMedium\.copy\(\s*fontSize\s*=\s*3\d\.sp""").containsMatchIn(it) }
            },
            GuardRule(ownCircle) { source ->
                MainSourceScan.calls(source.text, "Surface").count {
                    it.contains("CircleShape") && Regex("""size\(44\.dp\)""").containsMatchIn(it)
                } + Regex("""fun\s+Paper(?:Icon|Circle)Button\(""").findAll(source.text).count()
            },
        ),
        roster = listOf(
            GuardException("features/calls/CallActivity.kt", ownTitle, 2, "The caller's name and number as the hero of the full-screen incoming call, not a page title."),
            GuardException("features/calls/DialerSheet.kt", ownTitle, 2, "The number readout above the dial pad, not a page title."),
            GuardException("features/foryou/ForYouTab.kt", ownCircle, 1, "The inbox attention button: an animated dot and its own state description sit on the circle."),
        ),
    )

    private val tabTitles = mapOf(
        "features/calls/CallsScreen.kt" to "callsSection",
        "features/contacts/ContactsTab.kt" to "contactsTitle",
        "features/foryou/ForYouTab.kt" to "forYouTitle",
        "features/inbox/InboxTab.kt" to "inbox.title",
        "features/tasks/TasksTab.kt" to "tasksTitle",
    )

    @Test fun `G-0 the scan walked real source`() = guard.scansRealSource()
    @Test fun `G-1 no hand-built page title or header icon outside the components`() = guard.noUnlistedCopies()
    @Test fun `G-2 every named exception still matches`() = guard.rosterIsClosed()
    @Test fun `G-3 every exception gives a reason`() = guard.everyExceptionGivesAReason()

    @Test
    fun `G-4 each of the five tabs titles itself with ScreenTitle, once`() {
        // Read raw: a "text/*" mime string in a file opens a block comment for the
        // shared scan's comment strip.
        val root = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).map { File(it) }.first { it.exists() }
        for ((file, key) in tabTitles) {
            val calls = File(root, file).readLines()
                .filter { Regex("""(?<![\w.])ScreenTitle\(""").containsMatchIn(it) && !it.trimStart().startsWith("//") }
            assertEquals("$file draws its title with ScreenTitle, once", 1, calls.size)
            assertTrue("$file's ScreenTitle names $key", calls.single().contains(key))
        }
    }
}
