package com.loonext.android.ui.common

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #511 — pulling down looks the same everywhere, and stays that way.
 *
 * The report was "sometimes a round arrow, sometimes a squigly circle". Six
 * screens wired the gesture independently and three passed the Expressive
 * indicator while three took the platform default, so the app drew two
 * different things depending on which tab you were on.
 *
 * Consistency restored by hand lasts until the seventh screen. This reads the
 * source and fails if anything except the shared component touches the
 * primitive — the same shape as the headline-price and price-literal guards,
 * where the correctness is structural rather than remembered.
 */
class RefreshBoxTest {
    private val featureSources: List<File>
        get() = File("src/main/kotlin/com/loonext/android")
            .walkTopDown()
            .filter { it.isFile && it.extension == "kt" }
            .filter { it.name != "RefreshBox.kt" }
            .toList()

    @Test
    fun `no screen wires pull-to-refresh for itself`() {
        val offenders = featureSources
            .filter { file ->
                val text = file.readText()
                "PullToRefreshBox(" in text || "PullToRefreshDefaults." in text
            }
            .map { it.name }

        assertEquals(
            "These call the pull-to-refresh primitive directly, so they can " +
                "disagree with every other screen about what the gesture looks " +
                "like — which is exactly what #511 reported. Use RefreshBox: " +
                "it takes no indicator argument, so there is nothing to get " +
                "wrong. Offenders: $offenders",
            emptyList<String>(),
            offenders,
        )
    }

    @Test
    fun `the walk actually finds the sources it is checking`() {
        // A guard that silently walked an empty tree would pass forever.
        assertTrue(
            "expected to scan the Android sources, found ${featureSources.size}",
            featureSources.size > 50,
        )
    }

    @Test
    fun `the shared box supplies the indicator itself`() {
        val text = File(
            "src/main/kotlin/com/loonext/android/ui/common/RefreshBox.kt",
        ).readText()

        // The whole point: callers cannot choose, because there is no
        // parameter to choose with.
        assertTrue(
            "RefreshBox must supply the indicator, or every caller is back to " +
                "taking whatever the platform default happens to be",
            "PullToRefreshDefaults.LoadingIndicator" in text,
        )
        assertTrue(
            "RefreshBox must not accept an indicator parameter — that is the " +
                "argument three screens got wrong",
            "indicator:" !in text,
        )
    }
}
