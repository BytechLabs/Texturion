package com.loonext.android.ui.theme

import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * #320 — a literal colour in a composable is how a theme bug gets authored.
 *
 * The web app's twin (`token-discipline.test.ts`) was written after measuring
 * that its hex literals sat in *the same files that had the theme bugs*. This
 * is the Android side, in the [com.loonext.android.HostHeaderLintTest] source-
 * lint idiom already used here for the header contract.
 *
 * Android is CLEAN today — the sweep that motivated this found exactly one
 * literal outside the theme package, and it is Google's brand blue in the
 * sign-in button, which is required to be that value. The point is not to fix
 * something; it is that "clean" was true by luck rather than by rule, and the
 * rule is cheap. A composable that reads `MaterialTheme.colorScheme` or
 * `BrandColor` gets both themes for free, because the scheme is what changes
 * between them. A literal gets whichever mode its author had open.
 */
class ColorLiteralLintTest {

    /**
     * Sources that may hold a literal, each with the reason it is not a theming
     * decision. "Add it to the list" is how a lint stops linting, so an entry
     * has to be a claim of that kind and not a convenience.
     */
    private val allowed = mapOf(
        "features/auth/GoogleSignIn.kt" to
            "Google's brand blue in their sign-in button. Their guidelines require " +
                "the exact value, and theming it would make the button stop being " +
                "recognisable as the thing it is",
    )

    private fun mainRoot(): File {
        for (base in listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )) {
            val dir = File(base)
            if (dir.exists()) return dir
        }
        fail("android main source root not found (cwd=${File(".").absolutePath})")
        error("unreachable")
    }

    @Test
    fun `no composable outside the theme package hardcodes a colour`() {
        val root = mainRoot()
        val offenders = mutableListOf<String>()
        for (file in root.walkTopDown()) {
            if (!file.isFile || file.extension != "kt") continue
            val relative = file.relativeTo(root).path.replace('\\', '/')
            // The theme package IS the place colours are written down.
            if (relative.startsWith("ui/theme/")) continue
            if (allowed.containsKey(relative)) continue
            file.readLines().forEachIndexed { index, line ->
                // A shadow is a dark translucent smudge in BOTH themes — that is
                // what a shadow is — so it is not a mode-dependent decision the
                // way a fill is. Same narrowing the web guard makes.
                val painted = Regex("""shadow\([^)]*\)""").replace(line, "")
                if (Regex("""Color\(0x[0-9a-fA-F]{8}\)""").containsMatchIn(painted)) {
                    offenders += "$relative:${index + 1}"
                }
            }
        }
        assertTrue(
            "\n\nColour literal(s) outside ui/theme:\n  " + offenders.joinToString("\n  ") +
                "\n\nA literal gets whichever theme its author had open. Read " +
                "MaterialTheme.colorScheme or BrandColor and both modes follow for " +
                "free. If this source genuinely draws where the scheme does not " +
                "reach (a third-party brand mark, an OS-read value), add it to " +
                "`allowed` with that reason. Convenience is not a reason.\n",
            offenders.isEmpty(),
        )
    }

    @Test
    fun `every exception carries a reason and is still needed`() {
        val root = mainRoot()
        for ((relative, reason) in allowed) {
            assertTrue("$relative needs a real reason", reason.length > 40)
            val file = File(root, relative)
            assertTrue("$relative is in `allowed` but gone from the tree", file.exists())
            assertTrue(
                "$relative has no literal left — remove it from `allowed`, or the " +
                    "next one can be added back without anybody noticing",
                file.readLines().any { Regex("""Color\(0x[0-9a-fA-F]{8}\)""").containsMatchIn(it) },
            )
        }
    }

    /**
     * #320 — the Android twin of `PortalScope` on web.
     *
     * `MaterialTheme.colorScheme` is a CompositionLocal, so a composition that
     * does not sit under [LoonextTheme] gets Material's DEFAULTS — the purple
     * baseline — rather than this app's palette. That is the same class of
     * fault as #116, where web portals rendered outside `.app-scope` and lost
     * their tokens: every colour correct, the wrong scope, and nothing in the
     * build with an opinion about it.
     *
     * Compose's Dialog and Popup inherit the parent composition, so the risk is
     * concentrated at the `setContent` boundaries — where a NEW composition
     * starts. There are two, and both are correct today.
     */
    @Test
    fun `every composition root renders inside LoonextTheme`() {
        val root = mainRoot()
        // `setContentType` / `setContentTitle` are Android media and
        // notification APIs that merely share a prefix, so the brace matters.
        val setContent = Regex("""\bsetContent\s*\{""")
        val roots = root.walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { setContent.containsMatchIn(it.readText()) }
            .toList()

        val offenders = roots
            .filterNot { it.readText().contains("LoonextTheme(") }
            .map { it.relativeTo(root).path.replace('\\', '/') }

        assertTrue(
            "\n\nComposition root(s) that never enter LoonextTheme:\n  " +
                offenders.joinToString("\n  ") +
                "\n\nMaterialTheme.colorScheme is a CompositionLocal. A composition " +
                "outside LoonextTheme gets Material's default palette — purple — in " +
                "both themes, and nothing else in the build will say so.\n",
            offenders.isEmpty(),
        )
        // And the walk really found the roots rather than passing over none.
        assertTrue("expected the app's composition roots, found ${roots.size}", roots.size >= 2)
    }

    @Test
    fun `the lint is actually reading the tree`() {
        // A walk that matches nothing passes forever.
        val count = mainRoot().walkTopDown().count { it.isFile && it.extension == "kt" }
        assertTrue("expected a real Android source tree, saw $count files", count > 50)
    }
}
