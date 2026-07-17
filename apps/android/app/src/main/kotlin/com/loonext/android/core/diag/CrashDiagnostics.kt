package com.loonext.android.core.diag

import android.content.Context
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Crash capture for a device with no adb (#168 part A). The founder's answer
 * crash died with nothing to read; from now on EVERY uncaught throw — thread
 * or coroutine — lands in filesDir/crash-reports/latest.txt (last
 * [CrashReportLog.MAX_ENTRIES] kept), and the next launch offers a share
 * sheet so the stack can be sent to us.
 *
 * Zero new dependencies. Everything that can be pure IS pure
 * ([CrashReportLog], [PostCrashHonesty], [ChainingUncaughtHandler]) and
 * JVM-tested; the file plumbing ([CrashReportStore], [CallInFlightMarker])
 * is a thin, never-throwing shell over java.io.
 */

/** Pure text format + rotation for the crash log — JVM-tested. */
object CrashReportLog {
    /** Keep the last N crashes; older entries rotate out. */
    const val MAX_ENTRIES = 5

    /** Every entry starts with this marker line prefix (the split key). */
    const val ENTRY_MARKER = "=== CRASH "

    private const val TIME_KEY = "time_ms="
    private const val THREAD_KEY = "thread="
    private const val VERSION_KEY = "version="

    /** One report block: marker + metadata lines + the full stack. */
    fun formatEntry(
        timeMs: Long,
        threadName: String,
        stack: String,
        appVersion: String,
    ): String = buildString {
        append(ENTRY_MARKER).append(isoUtc(timeMs)).append(" ===\n")
        append(TIME_KEY).append(timeMs).append('\n')
        append(THREAD_KEY).append(threadName).append('\n')
        append(VERSION_KEY).append(appVersion).append('\n')
        append(stack.trimEnd()).append('\n')
    }

    /** Append an entry, keeping only the newest [maxEntries] blocks. */
    fun appendCapped(existing: String, entry: String, maxEntries: Int = MAX_ENTRIES): String {
        val kept = (entries(existing) + entry.trimEnd()).takeLast(maxEntries)
        return kept.joinToString(separator = "\n\n", postfix = "\n")
    }

    /** Split the file text back into entry blocks (oldest first). */
    fun entries(text: String): List<String> {
        if (text.isBlank()) return emptyList()
        val result = mutableListOf<StringBuilder>()
        for (line in text.lineSequence()) {
            if (line.startsWith(ENTRY_MARKER)) result.add(StringBuilder())
            result.lastOrNull()?.append(line)?.append('\n')
        }
        return result.map { it.toString().trimEnd() }.filter { it.isNotEmpty() }
    }

    /** Epoch ms of the NEWEST entry, or null when the log is empty/garbled. */
    fun lastCrashAtMs(text: String): Long? = entries(text).lastOrNull()
        ?.lineSequence()
        ?.firstOrNull { it.startsWith(TIME_KEY) }
        ?.removePrefix(TIME_KEY)
        ?.trim()
        ?.toLongOrNull()

    private fun isoUtc(timeMs: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(timeMs))
    }
}

/**
 * The default-uncaught-exception chain link: record first (best-effort,
 * NOTHING may throw out of a crash handler), then ALWAYS delegate to the
 * previous handler so the platform's crash/ANR semantics stay intact —
 * Android's own KillApplicationHandler must still run or the process hangs.
 */
class ChainingUncaughtHandler(
    private val record: (Thread, Throwable) -> Unit,
    private val previous: Thread.UncaughtExceptionHandler?,
) : Thread.UncaughtExceptionHandler {
    override fun uncaughtException(thread: Thread, error: Throwable) {
        try {
            record(thread, error)
        } catch (_: Throwable) {
            // A crash handler that crashes captures nothing and breaks the
            // delegation below — swallow everything, including Errors.
        }
        try {
            previous?.uncaughtException(thread, error)
        } catch (_: Throwable) {
            // The previous handler failing must not recurse into us.
        }
    }
}

/**
 * Part D (#168): was the last crash mid-call? The marker is stamped when a
 * call goes live and cleared when the line clears; a crash newer than the
 * stamp means the process died with a call up. A marker WITHOUT a newer
 * crash (system kill, marker leak) stays silent — we only claim what the
 * log proves.
 */
object PostCrashHonesty {
    fun callInterruptedByCrash(markerSetAtMs: Long?, lastCrashAtMs: Long?): Boolean =
        markerSetAtMs != null && lastCrashAtMs != null && lastCrashAtMs >= markerSetAtMs
}

/**
 * filesDir/crash-reports/latest.txt + the `surfaced` sidecar (which crash the
 * user has already been shown). Every method is total — file trouble during
 * a crash must never become the crash.
 */
class CrashReportStore(
    private val dir: File,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val logFile = File(dir, "latest.txt")
    private val surfacedFile = File(dir, "surfaced")

    /** Append one crash (fatal or would-have-been-fatal). Never throws. */
    fun record(threadName: String, error: Throwable, appVersion: String) {
        runCatching {
            dir.mkdirs()
            val stack = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
            val entry = CrashReportLog.formatEntry(now(), threadName, stack, appVersion)
            val existing = runCatching { logFile.readText() }.getOrDefault("")
            logFile.writeText(CrashReportLog.appendCapped(existing, entry))
        }
    }

    /** The whole log text, or null when nothing was ever recorded. */
    fun readAll(): String? = runCatching {
        logFile.readText().takeIf { it.isNotBlank() }
    }.getOrNull()

    fun lastCrashAtMs(): Long? = readAll()?.let { CrashReportLog.lastCrashAtMs(it) }

    /** Log text if its newest crash hasn't been shown to the user yet. */
    fun unsurfacedReport(): String? {
        val text = readAll() ?: return null
        val latest = CrashReportLog.lastCrashAtMs(text) ?: return null
        val surfaced = runCatching { surfacedFile.readText().trim().toLongOrNull() }.getOrNull()
        return if (surfaced == latest) null else text
    }

    /** The current newest crash has been shown — don't offer it again. */
    fun markSurfaced() {
        runCatching {
            val latest = lastCrashAtMs() ?: return
            dir.mkdirs()
            surfacedFile.writeText(latest.toString())
        }
    }
}

/** The tiny 'call in flight' stamp (part D). File presence = a live call. */
class CallInFlightMarker(
    private val dir: File,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val file = File(dir, "call-in-flight")

    fun set() {
        runCatching {
            dir.mkdirs()
            // Keep the ORIGINAL stamp across state emissions — the marker
            // means "a call has been live since T", not "was live at last sync".
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

/**
 * Process-wide diagnostics root. [install] goes first in Application.onCreate
 * so the handler exists before any other code can throw; [get] hands the
 * store to MainActivity (share prompt) and SoftphoneManager (call marker).
 */
class CrashDiagnostics private constructor(baseDir: File, val appVersion: String) {
    val store = CrashReportStore(File(baseDir, "crash-reports"))
    val callMarker = CallInFlightMarker(File(baseDir, "crash-reports"))

    /** Record a failure a coroutine handler intercepted (process survives). */
    fun recordNonFatal(tag: String, error: Throwable) {
        store.record("coroutine:$tag", error, appVersion)
        // #169: caught-but-broken states become fleet-visible in the Firebase
        // console, not just the local file. Diagnostics must never throw.
        runCatching {
            com.google.firebase.crashlytics.FirebaseCrashlytics.getInstance()
                .recordException(error)
        }
    }

    companion object {
        @Volatile
        private var instance: CrashDiagnostics? = null

        /**
         * Create the singleton and chain the default uncaught handler.
         * Idempotent — a second call returns the existing instance without
         * stacking another handler.
         */
        fun install(context: Context, appVersion: String): CrashDiagnostics {
            instance?.let { return it }
            synchronized(this) {
                instance?.let { return it }
                val created = CrashDiagnostics(context.filesDir, appVersion)
                Thread.setDefaultUncaughtExceptionHandler(
                    ChainingUncaughtHandler(
                        record = { thread, error ->
                            created.store.record(thread.name, error, appVersion)
                        },
                        previous = Thread.getDefaultUncaughtExceptionHandler(),
                    ),
                )
                instance = created
                return created
            }
        }

        /** The installed instance (installing lazily if onCreate was missed). */
        fun get(context: Context): CrashDiagnostics =
            instance ?: install(context.applicationContext, versionOf(context))

        private fun versionOf(context: Context): String = runCatching {
            context.packageManager.getPackageInfo(context.packageName, 0).versionName
        }.getOrNull() ?: "unknown"
    }
}
