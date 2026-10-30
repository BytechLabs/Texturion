package com.loonext.android.features.calls

import com.loonext.android.BuildConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * The rig drives the call surfaces by these tags, from scripts that live outside
 * this app, so a tag that quietly stops being applied fails a rig scenario days
 * later with "element not found". This fails here instead.
 */
class CallTestTagsTest {

    @Test
    fun `every tag is distinct`() {
        assertEquals(CallTestTags.ALL.size, CallTestTags.ALL.toSet().size)
    }

    @Test
    fun `ALL lists every tag the object declares`() {
        val source = readMainSource("features/calls/CallTestTags.kt")
        val declared = Regex("""const val (\w+) = """).findAll(source).map { it.groupValues[1] }.toList()
        assertTrue("no tags parsed from CallTestTags.kt", declared.isNotEmpty())
        assertEquals(declared.size, CallTestTags.ALL.size)
    }

    @Test
    fun `every tag is applied on a call surface`() {
        val surfaces = listOf("features/calls/CallActivity.kt", "features/calls/InCallScreen.kt")
            .joinToString("\n") { readMainSource(it) }
        val declared = Regex("""const val (\w+) = """)
            .findAll(readMainSource("features/calls/CallTestTags.kt"))
            .map { it.groupValues[1] }
            .toList()
        assertTrue("no tags parsed from CallTestTags.kt", declared.isNotEmpty())
        for (name in declared) {
            assertTrue(
                "CallTestTags.$name is declared but no call surface applies it",
                surfaces.contains("testTag(CallTestTags.$name)"),
            )
        }
    }

    @Test
    fun `both call hosts expose the tags to UIAutomator`() {
        for (host in listOf("features/calls/CallActivity.kt", "features/calls/InCallScreen.kt")) {
            assertTrue(
                "$host must apply exposeCallTestTags() at its root",
                readMainSource(host).contains(".exposeCallTestTags()"),
            )
        }
    }

    @Test
    fun `only the nonprod builds expose test tags`() {
        // CI runs the debug variant, which shares production's defaults; the rig's
        // `./gradlew test` also runs the nonprod variants, which must expose them.
        val nonprod = BuildConfig.BUILD_TYPE.startsWith("nonprod")
        assertEquals(nonprod, BuildConfig.TEST_TAGS_AS_RESOURCE_IDS)
    }

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val file = File(File(base), relative)
            if (file.exists()) return file.readText()
        }
        fail("source not found: $relative")
        throw AssertionError("unreachable")
    }
}
