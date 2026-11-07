package com.loonext.android.telephony

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import java.io.File

/**
 * #168 part D: was the last call cut off by a crash? The marker is stamped when
 * a call goes live and cleared when the line clears; a crash at or after the
 * stamp means the process died with a call up. A marker WITHOUT a newer crash
 * (a system kill, a marker leak) stays silent: the app claims only what the
 * platform recorded.
 */
object PostCrashHonesty {
    fun callInterruptedByCrash(markerSetAtMs: Long?, lastCrashAtMs: Long?): Boolean =
        markerSetAtMs != null && lastCrashAtMs != null && lastCrashAtMs >= markerSetAtMs

    /** The newest crash among the exits the OS kept, given as (reason, epoch ms). */
    fun lastCrashAtMs(exits: List<Pair<Int, Long>>): Long? = exits
        .filter { (reason, _) ->
            reason == ApplicationExitInfo.REASON_CRASH ||
                reason == ApplicationExitInfo.REASON_CRASH_NATIVE
        }
        .maxOfOrNull { (_, atMs) -> atMs }

    /**
     * When the OS last recorded this app dying of a crash, from
     * ApplicationExitInfo. Android 11 added that record, so 9 and 10 report
     * nothing and the interrupted-call line never shows there.
     */
    fun lastCrashAtMs(context: Context): Long? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
        val manager = context.getSystemService(ActivityManager::class.java) ?: return null
        return runCatching {
            lastCrashAtMs(
                manager.getHistoricalProcessExitReasons(context.packageName, 0, 0)
                    .map { it.reason to it.timestamp },
            )
        }.getOrNull()
    }
}

/** The 'call in flight' stamp (part D). File presence means a live call. */
class CallInFlightMarker(
    private val dir: File,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val file = File(dir, "call-in-flight")

    fun set() {
        runCatching {
            dir.mkdirs()
            // Keep the ORIGINAL stamp across state emissions: the marker means
            // "a call has been live since T", not "was live at last sync".
            if (!file.exists()) file.writeText(now().toString())
        }
    }

    fun clear() {
        runCatching { file.delete() }
    }

    fun setAtMs(): Long? = runCatching {
        if (file.exists()) file.readText().trim().toLongOrNull() else null
    }.getOrNull()
}
