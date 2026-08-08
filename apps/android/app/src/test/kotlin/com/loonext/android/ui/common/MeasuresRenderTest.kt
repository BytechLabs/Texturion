package com.loonext.android.ui.common

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #540 — the dashboard's marks, actually rendered.
 *
 * There is no emulator or attached device on the machine this was written on, so
 * the alternative to this file is a compile and a hope. Robolectric composes the
 * real thing, which is what catches the failures a compile cannot see: a `layout`
 * modifier that measures to a negative width, an arc drawn with a zero-sized
 * canvas, a `Spacer(minLength:)` that pushes its row off the screen.
 *
 * These are not screenshots and this file does not pretend to be a substitute for
 * looking at the screen. What it does buy is that every mark composes, occupies
 * space, and says a sentence out loud.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MeasuresRenderTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `a ring renders and announces its sentence`() {
        compose.setContent {
            MaterialTheme {
                ProportionRing(
                    value = 3f,
                    total = 4f,
                    label = "3 of 4 new customers answered",
                    color = MaterialTheme.colorScheme.secondary,
                )
            }
        }
        compose.onNodeWithContentDescription("3 of 4 new customers answered")
            .assertIsDisplayed()
    }

    @Test
    fun `a ring with nothing done still renders rather than crashing`() {
        // The zero case is the one that would take an arc of length zero into the
        // canvas, and the one a compile has nothing to say about.
        compose.setContent {
            MaterialTheme {
                ProportionRing(value = 0f, total = 0f, label = "nothing yet", color = MaterialTheme.colorScheme.secondary)
            }
        }
        compose.onNodeWithContentDescription("nothing yet").assertIsDisplayed()
    }

    @Test
    fun `a share bar renders and announces its sentence`() {
        compose.setContent {
            MaterialTheme {
                Box(Modifier.width(240.dp)) {
                    ShareBar(
                        segments = listOf(
                            ShareSegment("Won", 5f, MaterialTheme.colorScheme.secondary),
                            ShareSegment("Still out", 3f, MaterialTheme.colorScheme.secondary),
                        ),
                        total = 10f,
                        label = "Of 10 quoted, 5 won and 3 still out",
                    )
                }
            }
        }
        compose.onNodeWithContentDescription("Of 10 quoted, 5 won and 3 still out")
            .assertIsDisplayed()
    }

    @Test
    fun `a share bar with no whole draws nothing at all`() {
        // A month with no quotes. An empty track reads as a panel that failed to
        // load rather than as a quiet month, so there must be no node at all.
        compose.setContent {
            MaterialTheme {
                Box(Modifier.width(240.dp)) {
                    ShareBar(
                        segments = listOf(
                            ShareSegment("Won", 0f, MaterialTheme.colorScheme.secondary),
                        ),
                        total = 0f,
                        label = "no quotes",
                    )
                }
            }
        }
        assertEquals(
            0,
            compose.onAllNodesWithContentDescriptionCount("no quotes"),
        )
    }

    /** How many nodes carry this description — zero is the assertion, not an error. */
    private fun androidx.compose.ui.test.junit4.AndroidComposeTestRule<*, *>
        .onAllNodesWithContentDescriptionCount(value: String): Int =
        onAllNodes(
            androidx.compose.ui.test.hasContentDescription(value),
        ).fetchSemanticsNodes().size
}
