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
            "features/calls/CallsScreen.kt",
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
            // CallsScreen is DUAL-context (shell tab root per #203 AND hosted
            // route): its tab title is legal but must be gated off in the
            // hosted context, pinned by the dedicated test below.
            if (path.endsWith("CallsScreen.kt")) continue
            assertFalse(
                "$path composes ScreenTitle - a hosted route's title lives in the " +
                    "host's one header slot (declare it at MainActivity's when(active))",
                src.contains("ScreenTitle("),
            )
        }
    }

    @Test
    fun `the dual-context calls screen shows its tab title ONLY when not hosted`() {
        // As a shell TAB root (#203 pager) CallsScreen owns its single title
        // row like every tab; pushed as Overlay.Calls the HOST header carries
        // the title + status action, so the screen's chrome must be gated
        // behind !hosted and the host must actually declare both sides.
        val calls = readMainSource("features/calls/CallsScreen.kt")
        assertTrue(
            "CallsScreen must gate its tab-root chrome behind the hosted flag",
            calls.contains("if (!hosted)"),
        )
        val host = readMainSource("MainActivity.kt")
        assertTrue(
            "the Overlay.Calls branch must suppress the screen's chrome (hosted = true)",
            host.contains("hosted = true"),
        )
        assertTrue(
            "the Overlay.Calls branch must declare the status line into the host's actions slot",
            host.contains("actions = { CallsHeaderStatus(graph) }"),
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
