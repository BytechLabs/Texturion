package com.loonext.android.ui.common

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Semantic haptics for the whole app: call these by MEANING, not by effect,
 * so every surface speaks the same physical language. All effects route
 * through View.performHapticFeedback, which respects the user's system
 * haptics toggle for free; constants above minSdk 28 degrade to the nearest
 * older effect.
 *
 *  - [tap]      light touch: keypad digits, chips, segmented pills, toggles
 *  - [tick]     sub-perceptual scrub: pickers, sliders, selection moves
 *  - [confirm]  something COMMITTED: send, save, answer, task done
 *  - [reject]   something refused or destructive: decline, delete, error
 *  - [heavy]    long-press affordances entering a new mode (drag, reorder)
 */
class Haptics(private val view: View) {
    fun tap() {
        view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
    }

    fun tick() {
        view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
    }

    fun confirm() {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.CONFIRM
            } else {
                HapticFeedbackConstants.KEYBOARD_TAP
            },
        )
    }

    fun reject() {
        view.performHapticFeedback(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                HapticFeedbackConstants.REJECT
            } else {
                HapticFeedbackConstants.LONG_PRESS
            },
        )
    }

    fun heavy() {
        view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
    }
}

@Composable
fun rememberHaptics(): Haptics {
    val view = LocalView.current
    return remember(view) { Haptics(view) }
}
