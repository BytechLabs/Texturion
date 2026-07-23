package com.loonext.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #200 one-header-slot contract, pinned as source lints in the
 * [com.loonext.android.telephony.ClientHangupLintTest] idiom: the route host
 * (MainActivity's OverlayScaffold) owns EXACTLY ONE header slot per hosted
 * route; a hosted screen declares {title, optional actions} at the host and
 * renders zero chrome of its own. The founder's bug (Settings sections
 * stacking a second back-button header under the host's) must not be
 * re-constructible: these lints fail the build if a hosted feature source
 * grows a title, a back affordance, or a top app bar, or if OverlayScaffold
 * escapes the host file.
 */
class HostHeaderLintTest {

    /**
     * Every source that renders INSIDE OverlayScaffold (the host wraps these
     * routes with the one header): all settings sources, the calls log
     * screen, notifications, and diagnostics. Bare routes that own their
     * single header (thread, task, contact, compose) are deliberately absent.
     */
    private fun hostedSources(): Map<String, String> {
        val out = linkedMapOf<String, String>()
        for (file in mainDir("features/settings").walkTopDown()) {
            if (file.isFile && file.extension == "kt") {
                out["features/settings/${file.name}"] = file.readText()
            }
        }
        for (relative in listOf(
            "features/notifications/NotificationsScreen.kt",
            "features/diagnostics/DiagnosticsScreen.kt",
        )) {
            out[relative] = readMainSource(relative)
        }
        return out
    }

    @Test
    fun `hosted screens compose no screen title - the host header slot carries it`() {
        for ((path, src) in hostedSources()) {
            assertFalse(
                "$path composes ScreenTitle - a hosted route's title lives in the " +
                    "host's one header slot (declare it at MainActivity's when(active))",
                src.contains("ScreenTitle("),
            )
        }
    }

    @Test
    fun `calls is a single surface - the pager tab, never a pushed route`() {
        // #203 made Calls a pager tab; a pushed Overlay.Calls duplicate would
        // mean two live CallsScreens (double fetch, double realtime). Deep
        // links and For You's header select the tab instead.
        val host = readMainSource("MainActivity.kt")
        assertFalse(
            "MainActivity must not regrow a pushed Calls route",
            host.contains("Overlay.Calls"),
        )
        val calls = readMainSource("features/calls/CallsScreen.kt")
        assertFalse(
            "CallsScreen must not regrow a hosted variant",
            calls.contains("hosted"),
        )
    }

    @Test
    fun `hosted screens compose no back affordance - the host back is the only one`() {
        for ((path, src) in hostedSources()) {
            assertFalse(
                "$path references ArrowBack - the host's OverlayScaffold renders the " +
                    "ONE back button; a screen-level back is the double-header bug (#200)",
                src.contains("ArrowBack"),
            )
        }
    }

    @Test
    fun `hosted screens compose no top app bar`() {
        for ((path, src) in hostedSources()) {
            assertFalse(
                "$path composes a TopAppBar - hosted routes declare {title, actions} " +
                    "to the host instead of drawing their own bar",
                src.contains("TopAppBar"),
            )
        }
    }

    @Test
    fun `OverlayScaffold is private to the host file - a second host header cannot compile`() {
        val host = readMainSource("MainActivity.kt")
        assertTrue(
            "the host header slot must stay private to MainActivity.kt",
            host.contains("private fun OverlayScaffold("),
        )
        // And no feature source references it (privacy makes that a compile
        // error; this catches a copy-paste reimplementation being wired up
        // under the same name).
        for (file in mainDir("features").walkTopDown()) {
            if (file.isFile && file.extension == "kt") {
                assertFalse(
                    "features/${file.name} references OverlayScaffold - only the host may",
                    file.readText().contains("OverlayScaffold"),
                )
            }
        }
    }

    @Test
    fun `the settings section state is hoisted - the host title tracks the open section`() {
        // SettingsHome must take the section from the host (which titles the
        // one header with it) instead of growing its own sub-navigator +
        // header again.
        val src = readMainSource("features/settings/SettingsHome.kt")
        assertTrue(
            "SettingsHome must accept the hosted section (section: SettingsSection?)",
            src.contains("section: SettingsSection?"),
        )
        val host = readMainSource("MainActivity.kt")
        assertTrue(
            "the host header title must track the open settings section",
            host.contains("section?.title ?: \"Settings\""),
        )
    }

    private fun mainDir(relative: String): File {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val dir = File("$base/$relative")
            if (dir.exists()) return dir
        }
        fail("source dir not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val f = File("$base/$relative")
            if (f.exists()) return f.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
