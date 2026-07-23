package com.loonext.android.core.diag

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.io.File
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The call-flow event log (#198 — the evidence channel #195 asked for). A
 * never-throwing, process-wide, append-only trace of every telephony moment:
 * push received, ring presented, answer/decline, leg bound, phase changes,
 * timers armed/fired, socket health, recovery, audio routes. When a ring goes
 * missing on the founder's device, this is the timeline that says where.
 *
 * Two sinks, both bounded:
 *  - an in-memory deque (last [MAX_MEMORY_ENTRIES]) published as a StateFlow
 *    the Diagnostics screen tails live;
 *  - a best-effort file append to `filesDir/diag/callflow.txt` on a single
 *    daemon writer thread, size-capped at [MAX_FILE_BYTES] with one `.1`
 *    rotation — so the trace survives the process and stays shareable.
 *
 * PRIVACY (BINDING): no tokens ever; phone numbers only through [mask]
 * (last-4); opaque ids (session/leg) only through [tail]. A diagnostics
 * channel must never become a data leak — or a crash: [log] swallows
 * absolutely everything.
 *
 * The pure parts ([formatLine], [mask], [tail], [shouldRotate]) are
 * JVM-tested next to the crash-diagnostics tests.
 */
object CallFlowLog {
    /** In-memory tail the Diagnostics screen renders. */
    const val MAX_MEMORY_ENTRIES = 400

    /** File size cap before rotating the current log to `.1` (~256KB). */
    const val MAX_FILE_BYTES = 256L * 1024

    const val FILE_NAME = "callflow.txt"
    const val ROTATED_FILE_NAME = "callflow.txt.1"

    private val memoryLock = Any()
    private val ring = ArrayDeque<String>(MAX_MEMORY_ENTRIES)

    private val _entries = MutableStateFlow<List<String>>(emptyList())

    /** The live tail (bounded, newest LAST) for the Diagnostics screen. */
    val entries: StateFlow<List<String>> = _entries

    @Volatile
    private var dir: File? = null

    @Volatile
    private var writer: ExecutorService? = null

    /**
     * Wire the file sink — call once from Application.onCreate (which also
     * runs before any FCM service callback, so a cold-process wake logs to
     * the file too). Idempotent; before it runs, [log] is memory-only.
     */
    fun install(directory: File) {
        synchronized(memoryLock) {
            if (dir != null) return
            dir = directory
            writer = Executors.newSingleThreadExecutor { runnable ->
                Thread(runnable, "callflow-log").apply { isDaemon = true }
            }
        }
    }

    /**
     * Record one event. NEVER throws and never does I/O on the caller's
     * thread — telephony code must be able to call this from anywhere
     * (main thread, Telecom callback, FCM handler) with zero risk.
     */
    fun log(tag: String, message: String) {
        try {
            val line = formatLine(System.currentTimeMillis(), tag, message)
            synchronized(memoryLock) {
                ring.addLast(line)
                while (ring.size > MAX_MEMORY_ENTRIES) ring.removeFirst()
                _entries.value = ring.toList()
            }
            writer?.execute { appendToFile(line) }
        } catch (_: Throwable) {
            // The evidence channel must never become the incident.
        }
    }

    /** The current in-memory tail (newest last). */
    fun snapshot(): List<String> = _entries.value

    /**
     * Everything recorded: the rotated file + the current file when the sink
     * is wired (best-effort), else the in-memory tail. Never throws. Callers
     * sharing this should read it off the main thread.
     */
    fun readAll(): String = try {
        val directory = dir
        if (directory == null) {
            snapshot().joinToString(separator = "\n")
        } else {
            buildString {
                val rotated = File(directory, ROTATED_FILE_NAME)
                if (rotated.exists()) append(rotated.readText())
                val current = File(directory, FILE_NAME)
                if (current.exists()) append(current.readText())
            }.ifBlank { snapshot().joinToString(separator = "\n") }
        }
    } catch (_: Throwable) {
        snapshot().joinToString(separator = "\n")
    }

    // -------------------------------------------------------------- pure parts

    /** One line: iso-UTC time + [tag] + message, newlines flattened so one
     *  event is always exactly one line (the file format's only invariant). */
    fun formatLine(timeMs: Long, tag: String, message: String): String {
        val flat = message.replace('\n', ' ').replace('\r', ' ').trim()
        return "${isoUtc(timeMs)} [$tag] $flat"
    }

    /**
     * Last-4 masking for anything phone-shaped — the log NEVER carries a full
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

    /** Short correlation handle for OPAQUE ids (session/leg) — last 4 chars.
     *  Enough to line events up, never the whole identifier. */
    fun tail(id: String?): String = id?.takeIf { it.isNotBlank() }?.takeLast(4) ?: "-"

    /** Rotation decision: would appending [incomingBytes] push a non-empty
     *  file past [capBytes]? (An empty file never rotates — a single oversized
     *  line must not rotate forever without ever writing.) */
    fun shouldRotate(
        currentBytes: Long,
        incomingBytes: Long,
        capBytes: Long = MAX_FILE_BYTES,
    ): Boolean = currentBytes > 0 && currentBytes + incomingBytes > capBytes

    // ---------------------------------------------------------- file plumbing

    /** Runs only on the single writer thread; best-effort by contract. */
    private fun appendToFile(line: String) {
        try {
            val directory = dir ?: return
            directory.mkdirs()
            val file = File(directory, FILE_NAME)
            val bytes = (line + "\n").toByteArray(Charsets.UTF_8)
            val current = if (file.exists()) file.length() else 0L
            if (shouldRotate(current, bytes.size.toLong())) {
                val rotated = File(directory, ROTATED_FILE_NAME)
                rotated.delete()
                file.renameTo(rotated)
            }
            file.appendBytes(bytes)
        } catch (_: Throwable) {
            // Disk trouble never surfaces — the in-memory tail still works.
        }
    }

    private fun isoUtc(timeMs: Long): String {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        format.timeZone = TimeZone.getTimeZone("UTC")
        return format.format(Date(timeMs))
    }

    // ------------------------------------------------------------- test seams

    /** JVM tests only: drop all state so each test starts clean. */
    internal fun resetForTest() {
        synchronized(memoryLock) {
            ring.clear()
            _entries.value = emptyList()
            writer?.shutdown()
            writer = null
            dir = null
        }
    }

    /** JVM tests only: block until every queued file append has landed. */
    internal fun awaitWritesForTest() {
        writer?.submit { }?.get()
    }
}
