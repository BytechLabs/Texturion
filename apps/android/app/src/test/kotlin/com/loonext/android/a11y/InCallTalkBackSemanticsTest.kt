package com.loonext.android.a11y

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.loonext.android.features.calls.CallNoteCard
import com.loonext.android.features.calls.CallPhaseLine
import com.loonext.android.features.calls.CallerAvatar
import com.loonext.android.features.calls.KeypadKey
import com.loonext.android.features.calls.RingActionCircle
import com.loonext.android.features.calls.announcesCallEnd
import com.loonext.android.telephony.CallDirection
import com.loonext.android.telephony.CallNotifier
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.ui.theme.LoonextTheme
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The ringing and in-call TalkBack pass (2026-11-12, rig-pixel). Each assertion pins something
 * TalkBack said on a live call, or did not say.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class InCallTalkBackSemanticsTest {

    @get:Rule
    val compose = createAndroidComposeRule<ComponentActivity>()

    private fun show(content: @Composable () -> Unit) = compose.setContent { LoonextTheme { content() } }

    private fun hasRole(role: Role) =
        SemanticsMatcher("has role $role") { it.config.getOrNull(SemanticsProperties.Role) == role }

    private val isLiveRegion = SemanticsMatcher.keyIsDefined(SemanticsProperties.LiveRegion)

    private fun call(phase: CallPhase) = CallSnapshot(
        id = "c1",
        direction = CallDirection.INBOUND,
        peerName = "Maria Alvarez",
        peerNumber = "+14155550123",
        phase = phase,
    )

    // The ring screen

    @Test fun `a ring action is one button, not a button and its caption`() {
        show {
            Column {
                RingActionCircle(
                    icon = Icons.Outlined.Call,
                    label = "Answer",
                    container = Color.Green,
                    content = Color.White,
                    labelColor = Color.Black,
                    labelWeight = FontWeight.Bold,
                    size = 64.dp,
                    onClick = {},
                )
            }
        }
        compose.onAllNodes(hasContentDescription("Answer")).assertCountEquals(1)
        compose.onNode(hasContentDescription("Answer")).assert(hasRole(Role.Button))
        // The caption under the disc is only drawn: the reader had it as a second "Answer".
        compose.onAllNodes(hasText("Answer")).assertCountEquals(0)
    }

    @Test fun `the caller's initials are not a stop before the caller's name`() {
        show { CallerAvatar(name = "Maria Alvarez") }
        compose.onAllNodes(hasText("MA")).assertCountEquals(0)
    }

    // The keypad, in the dialer and in a call

    @Test fun `a keypad key is a button named by its digit alone`() {
        show {
            Column {
                KeypadKey(digit = "2", letters = "ABC", onClick = {})
                KeypadKey(digit = "0", letters = "+", onClick = {})
            }
        }
        compose.onNode(hasText("2")).assert(hasRole(Role.Button))
        compose.onNode(hasText("0")).assert(hasRole(Role.Button))
        // "ABC" and "+" are a phone's printed aid, not what the key sends: they are not in the key's spoken text.
        compose.onAllNodes(hasText("ABC")).assertCountEquals(0)
        compose.onAllNodes(hasText("+")).assertCountEquals(0)
    }

    // In the call

    @Test fun `on hold is said when it appears`() {
        show { CallPhaseLine(call(CallPhase.HELD)) }
        compose.onNode(hasText("On hold")).assert(isLiveRegion)
    }

    @Test fun `call ended is not a live region, because the screen announces it`() {
        show { CallPhaseLine(call(CallPhase.ENDED)) }
        compose.onNode(hasText("Call ended")).assertExists()
        assertEquals(0, compose.onAllNodes(isLiveRegion).fetchSemanticsNodes().size)
    }

    @Test fun `the ticking call timer is not a live region`() {
        show { CallPhaseLine(call(CallPhase.ACTIVE).copy(activeSinceMs = System.currentTimeMillis() - 5_000)) }
        val live = compose.onAllNodes(isLiveRegion).fetchSemanticsNodes()
        assertEquals(0, live.size)
    }

    @Test fun `the end of a call is announced once, and not when the screen opens on none`() {
        assertTrue(announcesCallEnd(hadLiveCall = true, liveCalls = 0))
        assertFalse(announcesCallEnd(hadLiveCall = false, liveCalls = 0))
        assertFalse(announcesCallEnd(hadLiveCall = true, liveCalls = 1))
    }

    // The ring notification

    @Test fun `a ring from an unknown caller is not titled and captioned with the same words`() {
        val unknown = CallNotifier.ringTitle(callerName = "", callerNumber = "")
        assertEquals("Incoming call", unknown)
        assertEquals(null, CallNotifier.incomingRingText(unknown))
        assertEquals("Incoming call", CallNotifier.incomingRingText(CallNotifier.ringTitle("Maria Alvarez", "")))
        assertEquals("+14155550123", CallNotifier.ringTitle("", "+14155550123"))
    }

    @Test fun `the words a call notice shows come from the catalogue`() {
        // A literal here reads English to a French caller: the ring, the "Connecting" row and the
        // foreground notice are spoken by TalkBack in the shade and on the lock screen. The brand
        // name reads the same in every language.
        val literal = Regex("""(setContentTitle|setContentText)\(\s*"|ifBlank \{ "(?!Loonext")[A-Z]""")
        val files = File("src/main/kotlin/com/loonext/android/telephony").listFiles { f -> f.extension == "kt" }.orEmpty()
        assertTrue("no telephony sources were scanned", files.isNotEmpty())
        val offenders = files.flatMap { file ->
            file.readLines().mapIndexedNotNull { index, line ->
                val code = line.trimStart()
                if (!code.startsWith("//") && !code.startsWith("*") && literal.containsMatchIn(line)) {
                    "${file.name}:${index + 1}: ${code}"
                } else {
                    null
                }
            }
        }
        assertEquals(emptyList<String>(), offenders)
    }

    @Test fun `the call note card is a button`() {
        show { CallNoteCard(onClick = {}) }
        val node = compose.onNode(hasText("Call note", substring = true, ignoreCase = true)).fetchSemanticsNode()
        assertTrue(
            node.config.getOrNull(SemanticsProperties.Role) == Role.Button ||
                node.parent?.config?.getOrNull(SemanticsProperties.Role) == Role.Button,
        )
    }
}
