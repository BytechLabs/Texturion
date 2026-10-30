package com.loonext.android.features.calls

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.loonext.android.BuildConfig

/**
 * The names Compose tests and the rig's UIAutomator scripts (D142) find the call
 * surfaces by. Those scripts live outside this app, so renaming a tag breaks a
 * rig scenario, not a test here.
 *
 * An action's tag is the same on every surface: the full-screen ring and the
 * in-call screen's ringing row both carry [ANSWER] and [DECLINE], because only
 * one of them is ever on screen.
 */
object CallTestTags {
    const val RINGING = "call_ringing"
    const val IN_CALL = "call_in_call"
    const val ANSWER = "call_answer"
    const val DECLINE = "call_decline"
    const val HANG_UP = "call_hang_up"
    const val MUTE = "call_mute"
    const val KEYPAD = "call_keypad"
    const val HOLD = "call_hold"

    val ALL: List<String> = listOf(RINGING, IN_CALL, ANSWER, DECLINE, HANG_UP, MUTE, KEYPAD, HOLD)
}

/**
 * Exposes the tags below this node to UIAutomator as resource ids, in builds
 * that ask for it; other builds keep their semantics tree unchanged.
 */
fun Modifier.exposeCallTestTags(): Modifier =
    if (BuildConfig.TEST_TAGS_AS_RESOURCE_IDS) {
        this.semantics { testTagsAsResourceId = true }
    } else {
        this
    }
