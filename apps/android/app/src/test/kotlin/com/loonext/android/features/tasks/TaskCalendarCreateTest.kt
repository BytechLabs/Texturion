package com.loonext.android.features.tasks

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.click
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.requestFocus
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.input.key.Key
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.LocalDate
import java.time.ZoneId

/**
 * #739: a tapped calendar day starts New task due that day, on the WORKSPACE's
 * clock rather than the phone's. Zones are Toronto and Los Angeles; Alberta
 * dropped DST in 2026, so it is a poor zone to pin a fixture on.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@OptIn(ExperimentalTestApi::class)
class TaskCalendarCreateTest {
    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val day = LocalDate.of(2026, 11, 12)

    @Test
    fun theDueIsTheMorningOfTheTappedDayInTheWorkspaceZone() {
        assertEquals(
            "2026-11-12T14:00:00Z",
            calendarDayDueIso(day, ZoneId.of("America/Toronto")),
        )
        assertEquals(
            "2026-11-12T17:00:00Z",
            calendarDayDueIso(day, ZoneId.of("America/Los_Angeles")),
        )
    }

    @Test
    fun aMissingOrUnknownWorkspaceZoneFallsBackToThePhones() {
        assertEquals(ZoneId.systemDefault(), workspaceZone(null))
        assertEquals(ZoneId.systemDefault(), workspaceZone("Not/AZone"))
        assertEquals(ZoneId.of("America/Toronto"), workspaceZone("America/Toronto"))
    }

    private fun showCell(onClick: () -> Unit, onCreate: () -> Unit) {
        compose.setContent {
            MaterialTheme {
                DayCell(
                    day = day,
                    inMonth = true,
                    today = false,
                    selected = false,
                    tasks = emptyList(),
                    onClick = onClick,
                    onCreate = onCreate,
                )
            }
        }
    }

    @Test
    fun enterOnAFocusedDayOpensNewTask() {
        var created = 0
        var selected = 0
        showCell(onClick = { selected++ }, onCreate = { created++ })
        compose.onNode(hasClickAction()).requestFocus()
        compose.onNode(hasClickAction()).performKeyInput { pressKey(Key.Enter) }
        assertEquals(1, created)
        assertEquals(0, selected)
    }

    @Test
    fun longPressOpensNewTaskAndATapOnlySelects() {
        var created = 0
        var selected = 0
        showCell(onClick = { selected++ }, onCreate = { created++ })
        compose.onNode(hasClickAction()).performTouchInput { longClick() }
        assertEquals(1, created)
        assertEquals(0, selected)
        compose.onNode(hasClickAction()).performTouchInput { click() }
        assertEquals(1, selected)
        assertTrue(created == 1)
    }
}
