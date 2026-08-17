package com.loonext.android.push

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MessageLocale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * #228 — the notification channels, in the reader's language.
 *
 * These seven names and descriptions are the only copy this app has that
 * ANOTHER app renders: Android shows them in Settings → Notifications, which is
 * exactly where somebody goes to decide whether the thing waking them at 6am is
 * worth keeping on. A French crew member reading "Urgent texts" there is being
 * asked to make that decision in a language they did not choose.
 *
 * The resolver fails OPEN — a missing key renders as the key — so a channel
 * whose copy went missing would appear in system settings literally named
 * `push.channelUrgentName`. That is the failure these assert against, and it is
 * invisible from inside the app.
 */
class ChannelCopyTest {

    /** Every key `ensureChannels` asks for, read out of the source. */
    private fun keysAskedFor(): List<String> {
        val source = File(
            "src/main/kotlin/com/loonext/android/push/Channels.kt",
        ).readText()
        return Regex("""say\("(push\.channel[A-Za-z]+)"\)""")
            .findAll(source)
            .map { it.groupValues[1] }
            .toList()
    }

    @Test
    fun `every channel asks for a name and a description`() {
        val keys = keysAskedFor()
        // A guard that reads nothing passes for the wrong reason, and this one
        // reads a file Gradle only tracks because it is declared an input.
        assertEquals(
            "expected 7 channels × (name + description); found $keys",
            14,
            keys.size,
        )
        assertEquals("every key should be distinct", keys.size, keys.toSet().size)
    }

    @Test
    fun `every key has words in both languages`() {
        for (locale in MessageLocale.ALL) {
            for (key in keysAskedFor()) {
                val words = AppStrings.translate(locale, key)
                assertNotEquals(
                    "$key renders its own name in $locale, which is what a " +
                        "member would read in system settings",
                    key,
                    words,
                )
                assertTrue("$key is empty in $locale", words.isNotBlank())
            }
        }
    }

    @Test
    fun `the French is actually French, not the English copied across`() {
        // The failure this catches is a translation pass that filled the map
        // by duplicating the English — which passes "has words" and leaves the
        // reader exactly where they started. Names like "Messages" and
        // "Paiements/Payments" legitimately match or nearly do, so this asserts
        // on the DESCRIPTIONS, which are sentences and always differ.
        val descriptions = keysAskedFor().filter { it.endsWith("Desc") }
        assertEquals("expected 7 descriptions", 7, descriptions.size)
        for (key in descriptions) {
            assertNotEquals(
                "$key is identical in both languages, so it was never translated",
                AppStrings.translate(MessageLocale.EN, key),
                AppStrings.translate(MessageLocale.FR_CA, key),
            )
        }
    }

    @Test
    fun `no channel name is hardcoded past the resolver`() {
        // The whole point is that system settings reads what the member chose.
        // A literal that crept back in would be invisible from inside the app,
        // because nothing in our own UI renders these strings at all.
        val source = File(
            "src/main/kotlin/com/loonext/android/push/Channels.kt",
        ).readText()
        val constructor = Regex(
            """NotificationChannel\(\s*ChannelIds\.[A-Z_]+,\s*("[^"]*")""",
        ).findAll(source).map { it.groupValues[1] }.toList()
        assertTrue(
            "a channel is named with a literal rather than a catalogue key: " +
                constructor,
            constructor.isEmpty(),
        )
    }
}
