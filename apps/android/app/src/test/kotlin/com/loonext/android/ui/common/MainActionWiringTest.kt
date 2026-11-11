package com.loonext.android.ui.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #732: every tab's main action is the same control in the same place.
 *
 * Inbox "New text", Calls "Dial", Tasks "New task" and Contacts "New contact"
 * must each be [MainActionButton], bottom-trailing, and none may draw a second
 * hand-built circle of its own. A source lint in the PortRejectionWiringTest
 * idiom, because the wiring lives in composables a unit test cannot raise.
 */
class MainActionWiringTest {

    private val tabs = mapOf(
        "MainActivity.kt" to "shell.newConversation",
        "features/calls/CallsScreen.kt" to "contactsTasks.dialANumber",
        "features/tasks/TasksTab.kt" to "thread.newTask",
        "features/contacts/ContactsTab.kt" to "contactsTasks.newContact",
    )

    @Test
    fun `each of the four tabs uses the shared main action exactly once`() {
        for ((file, label) in tabs) {
            val src = readMainSource(file)
            assertEquals(
                "$file must draw its main action with MainActionButton, once",
                1,
                Regex("MainActionButton\\(").findAll(src).count(),
            )
            assertTrue(
                "$file's main action must be spoken as $label",
                Regex("MainActionButton\\([^)]*?contentDescription = t\\(\"$label\"\\)", RegexOption.DOT_MATCHES_ALL)
                    .containsMatchIn(src),
            )
        }
    }

    @Test
    fun `the three in-screen tabs place it bottom-trailing at the same offsets`() {
        for (file in listOf(
            "features/calls/CallsScreen.kt",
            "features/tasks/TasksTab.kt",
            "features/contacts/ContactsTab.kt",
        )) {
            val src = readMainSource(file)
            assertTrue(
                "$file must align its main action bottom-end with end = 18.dp, bottom = 10.dp",
                Regex(
                    "MainActionButton\\(.*?\\.align\\(Alignment\\.BottomEnd\\)\\s*\\.padding\\(end = 18\\.dp, bottom = 10\\.dp\\)",
                    RegexOption.DOT_MATCHES_ALL,
                ).containsMatchIn(src),
            )
        }
    }

    @Test
    fun `the shared button is an ink circle over the touch minimum`() {
        val src = readMainSource("ui/common/MainAction.kt")
        assertTrue(src.contains("shape = CircleShape"))
        assertTrue(src.contains("color = MaterialTheme.colorScheme.primary"))
        assertTrue("the button must be at least 48dp", MAIN_ACTION_SIZE.value >= 48f)
    }

    @Test
    fun `no tab keeps a hand-built add circle in its header`() {
        for (file in tabs.keys) {
            val src = readMainSource(file)
            assertFalse(
                "$file still has a hand-built circle for its main action",
                src.contains("PaperCircleButton(\n                    icon = Icons.Outlined.AddTask") ||
                    src.contains("val addInteraction") ||
                    src.contains("val fabInteraction"),
            )
        }
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val file = File(File(base), relative)
            if (file.exists()) return file.readText().replace("\r\n", "\n")
        }
        throw AssertionError("source not found: $relative (cwd=${File(".").absolutePath})")
    }
}
