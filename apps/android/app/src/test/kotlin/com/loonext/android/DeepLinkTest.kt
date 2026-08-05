package com.loonext.android

import com.loonext.android.features.settings.SettingsSection
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * Where a notification tap lands. Every push the server sends resolves through
 * here, and a link that resolves to nothing is a tap that appears to do nothing.
 */
class DeepLinkTest {

    @Test
    fun `a thread link opens the thread`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("inbox", "conv-1")),
        )
    }

    @Test
    fun `a task reminder opens the job over its customer's thread`() {
        // The server points reminders at /inbox/<conv>?task=<id> so one tap
        // carries the address and checklist AND the thread they are about.
        assertEquals(
            DeepLink.Thread("conv-1", "task-9"),
            deepLinkFor(listOf("inbox", "conv-1"), taskParam = "task-9"),
        )
    }

    @Test
    fun `a task with no thread behind it opens its own page`() {
        assertEquals(DeepLink.Task("task-9"), deepLinkFor(listOf("tasks", "task-9")))
    }

    @Test
    fun `a blank task param is not a task`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("inbox", "conv-1"), taskParam = "  "),
        )
    }

    @Test
    fun `the legacy conversations path still resolves`() {
        assertEquals(
            DeepLink.Thread("conv-1"),
            deepLinkFor(listOf("conversations", "conv-1")),
        )
    }

    @Test
    fun `a call link carries its session`() {
        assertEquals(DeepLink.Calls("sess-3"), deepLinkFor(listOf("calls"), callParam = "sess-3"))
        assertEquals(DeepLink.Calls(null), deepLinkFor(listOf("calls")))
    }

    @Test
    fun `a call PERMALINK carries its session too`() {
        // #336: /calls/<session> matched the "calls" branch and then read only
        // the query param, so a permalink somebody was handed resolved to the
        // empty calls list — the "tap appears to do nothing" this table exists
        // to prevent.
        assertEquals(DeepLink.Calls("sess-3"), deepLinkFor(listOf("calls", "sess-3")))
    }

    @Test
    fun `the path wins over the wake param`() {
        // The query form is the ring-wake link a push sends; a path segment is
        // only present when a human followed a link to one specific call.
        assertEquals(
            DeepLink.Calls("from-path"),
            deepLinkFor(listOf("calls", "from-path"), callParam = "from-query"),
        )
    }

    @Test
    fun `a blank call segment falls back to the param`() {
        assertEquals(
            DeepLink.Calls("sess-3"),
            deepLinkFor(listOf("calls", "  "), callParam = "sess-3"),
        )
    }

    @Test
    fun `an unknown path resolves to nothing rather than guessing`() {
        // `/settings` USED TO BE ON THIS LIST and is deliberately off it — see
        // the settings tests below. Nothing else moved: a path this client has
        // never heard of still resolves to nothing, because there is no screen
        // it could honestly stand for.
        assertNull(deepLinkFor(emptyList()))
        assertNull(deepLinkFor(listOf("inbox")))
        assertNull(deepLinkFor(listOf("billing")))
    }

    // -- #523: the settings links the server actually sends --------------------

    /**
     * THE DEFECT. `/settings/billing` fell through to `else -> null`, so tapping
     * the "a number is on hold" push opened the INBOX. The notification's own
     * body is "Open Loonext to see which number, and how to bring it back", and
     * the screen it names was two navigations away from where the tap landed.
     */
    @Test
    fun `a settings link opens the section it names`() {
        assertEquals(
            DeepLink.Settings(SettingsSection.Billing),
            deepLinkFor(listOf("settings", "billing")),
        )
        assertEquals(
            DeepLink.Settings(SettingsSection.Numbers),
            deepLinkFor(listOf("settings", "numbers")),
        )
    }

    /**
     * EVERY SETTINGS LINK THE SERVER SENDS, resolved against the server's own
     * source rather than against a path copied into this file.
     *
     * Four pushes point into settings — the #523 hold, the cancellation notice
     * and both grace warnings — and all four resolved to null. A test carrying
     * its own copy of "/settings/billing" would keep passing on the day one of
     * them starts pointing somewhere this client cannot open, which is the only
     * way this defect can come back.
     */
    @Test
    fun `every settings path the API pushes resolves to a section`() {
        val paths = listOf(
            "webhooks/stripe.ts",
            "billing/grace.ts",
            "billing/cancellation-notice.ts",
        ).flatMap { file ->
            Regex("path:\\s*\"(/settings[^\"]*)\"").findAll(apiSource(file))
                .map { file to it.groupValues[1] }
                .toList()
        }
        assertTrue(
            "no `path: \"/settings…\"` found in the notification senders. If the " +
                "pushes moved, point this guard at the new files rather than " +
                "deleting it — an unresolvable push is a tap that opens the inbox",
            paths.isNotEmpty(),
        )
        paths.forEach { (file, path) ->
            val link = deepLinkFor(path.trim('/').split("/"))
            assertNotNull("$file pushes `$path`, which this client cannot open", link)
            val section = (link as DeepLink.Settings).section
            assertNotNull(
                "$file pushes `$path` and it resolves only to the settings hub. " +
                    "The reader was told something specific and has to go looking " +
                    "for it — add the slug to settingsSectionFor()",
                section,
            )
        }
    }

    /**
     * THE SLUGS ARE THE WEB'S ROUTE FOLDERS, and this is what makes that claim
     * true rather than a comment.
     *
     * The server builds these links out of `APP_ORIGIN`, so the set it can send
     * is exactly what exists under the web's settings routes. A slug invented
     * here would be a mapping that never fires; a web route renamed without this
     * client noticing is a push that quietly lands on the hub. Both fail here.
     */
    @Test
    fun `every mapped slug is a real settings route on the web`() {
        val src = mainSource("MainActivity.kt")
        val start = src.indexOf("fun settingsSectionFor(")
        assertTrue("settingsSectionFor was renamed; point this guard at it", start > 0)
        val body = src.substring(start, src.indexOf("else ->", start))
        val slugs = Regex("\"([a-z-]+)\"").findAll(body).map { it.groupValues[1] }.toList()
        assertTrue("the mapping table is empty", slugs.size >= 10)

        val routes = webSettingsRoutes()
        slugs.forEach { slug ->
            assertTrue(
                "`$slug` is mapped to a settings section but there is no " +
                    "apps/web/src/app/(app)/settings/$slug for the server to link " +
                    "to. Either it was never a route or the web renamed it, and a " +
                    "push aimed at the new name now opens the hub. Routes found: " +
                    routes.sorted(),
                routes.contains(slug),
            )
        }
    }

    /**
     * AN UNKNOWN SLUG OPENS THE HUB, WHICH IS NOT A GUESS.
     *
     * Every one of these IS a settings link, so the settings hub is a true answer
     * to it — one tap from the section, with the section list in front of the
     * reader. The alternative is null, and null means the inbox: a screen with no
     * relationship at all to what the notification said. Same call `parsePush`
     * makes for an unknown `kind`, and for the same reason — a slug this build
     * does not know is a newer server, not a bad link.
     */
    @Test
    fun `a settings link this build does not know still lands in settings`() {
        assertEquals(DeepLink.Settings(null), deepLinkFor(listOf("settings")))
        assertEquals(
            DeepLink.Settings(null),
            deepLinkFor(listOf("settings", "something-shipped-last-tuesday")),
        )
    }

    // -- reading the other languages ------------------------------------------

    /**
     * Fails rather than skips when the other tree is not there. A cross-language
     * guard that quietly passes because it could not find the other language
     * reads as protection in the file and provides none.
     */
    private fun repoDir(relative: String): File {
        listOf("", "../", "../../", "../../../").forEach { prefix ->
            val f = File("$prefix$relative")
            if (f.exists()) return f
        }
        fail("$relative not found from ${File(".").absolutePath}")
        error("unreachable")
    }

    private fun apiSource(relative: String): String =
        repoDir("apps/api/src/$relative").readText()

    private fun webSettingsRoutes(): Set<String> =
        repoDir("apps/web/src/app/(app)/settings")
            .listFiles()
            .orEmpty()
            .filter { it.isDirectory }
            .map { it.name }
            .toSet()

    private fun mainSource(relative: String): String {
        listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        ).forEach { base ->
            val f = File(base, relative)
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
