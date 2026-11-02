package com.loonext.android.telephony

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Release and nonprod builds run R8, and the Telnyx SDK ships no keep rules of its
 * own. Without ours the softphone never reaches READY, and unit tests, which run
 * the unshrunk build, would not notice.
 */
class TelnyxShrinkRulesTest {

    @Test
    fun `R8 keeps the whole Telnyx SDK`() {
        val rules = proguardRules().lineSequence()
            .map { it.substringBefore('#').trim() }
            .filter { it.isNotEmpty() }
            .toList()
        assertTrue(
            "proguard-rules.pro must keep com.telnyx.webrtc.** with all its members",
            "-keep class com.telnyx.webrtc.** { *; }" in rules,
        )
    }

    private fun proguardRules(): String =
        listOf(".", "app", "apps/android/app")
            .map { File(it, "proguard-rules.pro") }
            .firstOrNull { it.exists() }
            ?.readText()
            ?: throw AssertionError("proguard-rules.pro not found")
}
