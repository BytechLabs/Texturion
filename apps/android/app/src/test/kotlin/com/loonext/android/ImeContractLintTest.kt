package com.loonext.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * #199 keyboard-contract lints, in the [HostHeaderLintTest] idiom: IME
 * handling belongs to HOSTS (ui/common/ImeContract.kt is the one policy
 * file), so a new screen must not be ABLE to ship with an input under the
 * keyboard. These lints fail the build if a feature source grows its own
 * imePadding, calls material3's ModalBottomSheet directly instead of
 * AppSheet, or if a host loses its wiring.
 */
class ImeContractLintTest {

    /** The ONE file allowed to spell the keyboard policy. */
    private val contractFile = "ui/common/ImeContract.kt"

    @Test
    fun `imePadding is called only by the contract file - hosts pad, screens never`() {
        forEachMainSource { relative, src ->
            if (relative == contractFile) return@forEachMainSource
            assertFalse(
                "$relative calls .imePadding() - the HOST owns the keyboard " +
                    "(#199): routed screens/tabs/sheets are already padded, and " +
                    "a new host wraps its root in imeHost(...) from " +
                    "ui/common/ImeContract.kt",
                src.contains(".imePadding("),
            )
            assertFalse(
                "$relative imports imePadding - only ui/common/ImeContract.kt may",
                src.contains("import androidx.compose.foundation.layout.imePadding"),
            )
        }
    }

    @Test
    fun `ModalBottomSheet is raised only through AppSheet`() {
        // AppSheet pins contentWindowInsets (safeDrawing incl. ime) so a
        // material3 upgrade cannot silently drop sheet keyboard avoidance,
        // and it carries the #199 debug guard. A raw sheet bypasses both.
        forEachMainSource { relative, src ->
            if (relative == contractFile) return@forEachMainSource
            // Precise pattern: "rememberModalBottomSheetState(" does NOT
            // contain "ModalBottomSheet(" - sheet-state helpers stay legal.
            assertFalse(
                "$relative calls ModalBottomSheet directly - use AppSheet " +
                    "(ui/common/ImeContract.kt), the one sheet host (#199)",
                src.contains("ModalBottomSheet("),
            )
            assertFalse(
                "$relative imports material3.ModalBottomSheet - only AppSheet may",
                src.lines().any { it.trim() == "import androidx.compose.material3.ModalBottomSheet" },
            )
        }
    }

    @Test
    fun `AppSheet pins the sheet insets instead of trusting the library default`() {
        val contract = readMainSource(contractFile)
        assertTrue(
            "AppSheet must pass an explicit contentWindowInsets - the pinned " +
                "safeDrawing(top+bottom) is what keeps sheet fields above the " +
                "keyboard across material3 upgrades",
            contract.contains("contentWindowInsets ="),
        )
        assertTrue(
            "AppSheet's pinned insets must include the ime (safeDrawing does)",
            contract.contains("WindowInsets.safeDrawing"),
        )
        // And AppSheet must not leak the knob: a caller-supplied
        // contentWindowInsets could silently drop the ime again.
        assertFalse(
            "AppSheet must not expose contentWindowInsets as a parameter",
            contract.contains("contentWindowInsets:"),
        )
    }

    @Test
    fun `every host is wired - route host, pre-shell, shell pager, call activity`() {
        val main = readMainSource("MainActivity.kt")
        assertTrue(
            "MainActivity's route host must apply imeHost (the #187 policy + " +
                "#199 guard) on the routed-overlay Surface",
            main.contains("imeHost(\"route-host\")"),
        )
        assertTrue(
            "MainActivity must keep PreShellHost - the keyboard host for " +
                "every NOT-Ready root state (auth, external steps, failure)",
            main.contains("private fun PreShellHost(") &&
                main.contains("imeHost(\"pre-shell\")"),
        )
        val shell = readMainSource("features/shell/Shell.kt")
        assertTrue(
            "Shell's pager insets must carry the #199 debug guard " +
                "(assertAboveIme) alongside the #172 union math",
            shell.contains("assertAboveIme(\"shell-pager\")"),
        )
        val call = readMainSource("features/calls/CallActivity.kt")
        assertTrue(
            "CallActivity (standalone surface) must wrap its content in " +
                "imeHost - the day a call-note field lands here it is already " +
                "above the keyboard",
            call.contains("imeHost(\"call-activity\")"),
        )
    }

    @Test
    fun `the shell pager keeps union insets - pill clearance never stacks on the ime`() {
        // #172/#187: bottom padding is max(nav-bar + pill, ime) via
        // union(WindowInsets.ime), NOT imePadding stacked on the pill inset.
        val shell = readMainSource("features/shell/Shell.kt")
        assertTrue(
            "Shell.kt must keep .union(WindowInsets.ime) in the pager insets",
            shell.contains(".union(WindowInsets.ime)"),
        )
    }

    @Test
    fun `the debug guard crashes through the contract file only`() {
        // assertAboveIme is defined once; features may ATTACH it (dialog
        // content roots do) but must not redefine it or fork the policy.
        forEachMainSource { relative, src ->
            if (relative == contractFile) return@forEachMainSource
            assertFalse(
                "$relative defines its own assertAboveIme/imeHost - the #199 " +
                    "policy lives in ui/common/ImeContract.kt only",
                src.contains("fun Modifier.assertAboveIme(") ||
                    src.contains("fun Modifier.imeHost(") ||
                    src.contains("fun AppSheet("),
            )
        }
    }

    // ------------------------------------------------------------- plumbing

    private fun forEachMainSource(check: (relative: String, src: String) -> Unit) {
        val root = mainRoot()
        for (file in root.walkTopDown()) {
            if (file.isFile && file.extension == "kt") {
                val relative = file.relativeTo(root).invariantSeparatorsPath
                check(relative, file.readText())
            }
        }
    }

    private fun mainRoot(): File {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val dir = File(base)
            if (dir.exists()) return dir
        }
        fail("main source root not found (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    private fun readMainSource(relative: String): String {
        val f = File(mainRoot(), relative)
        if (!f.exists()) fail("source not found: $relative")
        return f.readText()
    }
}
