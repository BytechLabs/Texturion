package com.loonext.android.core.diag

import android.util.Log

/**
 * The call-flow trace (#198): every telephony moment (push received, ring
 * presented, answer or decline, leg bound, phase changes, timers armed and
 * fired, socket health, recovery, audio routes) as one logcat line under
 * [TAG], which `adb logcat -s LoonextCallFlow` reads on a device or a rig
 * emulator.
 *
 * PRIVACY (BINDING): no tokens ever; phone numbers only through [mask]
 * (last-4); opaque ids (session/leg) only through [tail].
 */
object CallFlowLog {
    const val TAG = "LoonextCallFlow"

    fun log(tag: String, message: String) {
        try {
            Log.i(TAG, line(tag, message))
        } catch (_: Throwable) {
            // The trace must never become the incident.
        }
    }

    /** `[tag] message`, newlines flattened so one event is one logcat line. */
    fun line(tag: String, message: String): String {
        val flat = message.replace('\n', ' ').replace('\r', ' ').trim()
        return "[$tag] $flat"
    }

    /**
     * Last-4 masking for anything phone-shaped: the log NEVER carries a full
     * number. Fewer than five digits masks entirely (last-4 of a 4-digit
     * string would be the whole number).
     */
    fun mask(e164: String?): String {
        val digits = e164.orEmpty().filter { it.isDigit() }
        return when {
            digits.isEmpty() -> "unknown"
            digits.length <= 4 -> "***"
            else -> "***" + digits.takeLast(4)
        }
    }

    /** Short correlation handle for OPAQUE ids (session/leg): the last 4 chars.
     *  Enough to line events up, never the whole identifier. */
    fun tail(id: String?): String = id?.takeIf { it.isNotBlank() }?.takeLast(4) ?: "-"
}
