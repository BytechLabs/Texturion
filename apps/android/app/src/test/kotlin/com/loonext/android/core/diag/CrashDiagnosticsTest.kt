package com.loonext.android.core.diag

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/**
 * #168 part A/D (+ #197): the crash-capture pieces that must be bulletproof —
 * entry format, keep-last-[CrashReportLog.MAX_ENTRIES] rotation, the listing
 * metadata parse, explicit delete, handler chaining (record AND delegate,
 * even when recording explodes), the surfaced-once bookkeeping, and the
 * interrupted-call decision.
 */
class CrashDiagnosticsTest {
    @get:Rule
    val tmp = TemporaryFolder()

    // ------------------------------------------------------- CrashReportLog

    @Test
    fun `formatEntry carries timestamp, thread, version, and the stack`() {
        val entry = CrashReportLog.formatEntry(
            timeMs = 1_700_000_000_000,
            threadName = "main",
            stack = "java.lang.IllegalArgumentException: boom\n\tat x.y.z(Q.kt:1)",
            appVersion = "1.0.0",
        )
        assertTrue(entry.startsWith(CrashReportLog.ENTRY_MARKER))
        assertTrue(entry.contains("time_ms=1700000000000"))
        assertTrue(entry.contains("thread=main"))
        assertTrue(entry.contains("version=1.0.0"))
        assertTrue(entry.contains("IllegalArgumentException: boom"))
        assertTrue(entry.contains("at x.y.z(Q.kt:1)"))
    }

    @Test
    fun `appendCapped keeps only the newest twenty entries`() {
        var text = ""
        for (i in 1..23) {
            val entry = CrashReportLog.formatEntry(i.toLong(), "t$i", "stack $i", "1.0.0")
            text = CrashReportLog.appendCapped(text, entry)
        }
        val entries = CrashReportLog.entries(text)
        assertEquals(20, CrashReportLog.MAX_ENTRIES) // #197: 5 buried history
        assertEquals(CrashReportLog.MAX_ENTRIES, entries.size)
        assertTrue("oldest rotated out", entries.none { it.contains("time_ms=1\n") })
        assertTrue(entries.first().contains("time_ms=4"))
        assertTrue(entries.last().contains("time_ms=23"))
    }

    @Test
    fun `lastCrashAtMs reads the NEWEST entry`() {
        var text = ""
        for (t in listOf(100L, 200L, 300L)) {
            text = CrashReportLog.appendCapped(
                text,
                CrashReportLog.formatEntry(t, "main", "stack", "1.0.0"),
            )
        }
        assertEquals(300L, CrashReportLog.lastCrashAtMs(text))
    }

    @Test
    fun `empty or garbled logs parse to nothing instead of throwing`() {
        assertEquals(emptyList<String>(), CrashReportLog.entries(""))
        assertNull(CrashReportLog.lastCrashAtMs(""))
        assertNull(CrashReportLog.lastCrashAtMs("random noise\nno markers"))
        assertEquals(emptyList<String>(), CrashReportLog.entries("noise before any marker"))
    }

    // ------------------------------------------------------------- entryMeta

    @Test
    fun `entryMeta reads time, thread, version, and the stack's first line`() {
        val entry = CrashReportLog.formatEntry(
            timeMs = 1_700_000_000_000,
            threadName = "worker-3",
            stack = "java.lang.IllegalStateException: boom\n\tat x.y.z(Q.kt:1)\n\tat a.b.c(W.kt:2)",
            appVersion = "1.2.3",
        )
        val meta = CrashReportLog.entryMeta(entry)
        assertEquals(1_700_000_000_000, meta.timeMs)
        assertEquals("worker-3", meta.threadName)
        assertEquals("1.2.3", meta.appVersion)
        assertEquals("java.lang.IllegalStateException: boom", meta.firstStackLine)
    }

    @Test
    fun `entryMeta stops metadata parsing at the stack - a stack containing key text is safe`() {
        val entry = CrashReportLog.formatEntry(
            timeMs = 42,
            threadName = "main",
            stack = "SomeError: parsing thread=fake failed\nthread=not-metadata",
            appVersion = "1.0.0",
        )
        val meta = CrashReportLog.entryMeta(entry)
        assertEquals("main", meta.threadName)
        assertEquals("SomeError: parsing thread=fake failed", meta.firstStackLine)
    }

    @Test
    fun `entryMeta on garbled input is all nulls, never a throw`() {
        val meta = CrashReportLog.entryMeta("")
        assertNull(meta.timeMs)
        assertNull(meta.threadName)
        assertNull(meta.appVersion)
        assertNull(meta.firstStackLine)
    }

    // ------------------------------------------------------------ removeEntry

    @Test
    fun `removeEntry drops exactly the given block and keeps order`() {
        val first = CrashReportLog.formatEntry(1, "main", "stack one", "1.0.0")
        val second = CrashReportLog.formatEntry(2, "main", "stack two", "1.0.0")
        val third = CrashReportLog.formatEntry(3, "main", "stack three", "1.0.0")
        var text = ""
        for (entry in listOf(first, second, third)) {
            text = CrashReportLog.appendCapped(text, entry)
        }
        val entries = CrashReportLog.entries(text)

        val without = CrashReportLog.removeEntry(text, entries[1])
        val remaining = CrashReportLog.entries(without)
        assertEquals(2, remaining.size)
        assertTrue(remaining[0].contains("stack one"))
        assertTrue(remaining[1].contains("stack three"))
    }

    @Test
    fun `removeEntry with an unknown block changes nothing - removing the last yields empty`() {
        val only = CrashReportLog.formatEntry(1, "main", "solo stack", "1.0.0")
        val text = CrashReportLog.appendCapped("", only)

        assertEquals(
            CrashReportLog.entries(text),
            CrashReportLog.entries(CrashReportLog.removeEntry(text, "not a real entry")),
        )
        assertEquals("", CrashReportLog.removeEntry(text, CrashReportLog.entries(text).single()))
    }

    @Test
    fun `store delete removes one entry and is total against a missing file`() {
        var clock = 0L
        val store = CrashReportStore(tmp.newFolder("crash-reports"), now = { clock })
        clock = 1
        store.record("main", RuntimeException("keep me"), "1.0.0")
        clock = 2
        store.record("main", RuntimeException("delete me"), "1.0.0")

        val doomed = CrashReportLog.entries(store.readAll().orEmpty())
            .single { it.contains("delete me") }
        store.delete(doomed)
        val remaining = CrashReportLog.entries(store.readAll().orEmpty())
        assertEquals(1, remaining.size)
        assertTrue(remaining.single().contains("keep me"))

        // Deleting the last entry empties the log; the store reads null.
        store.delete(remaining.single())
        assertNull(store.readAll())

        // And a store with no file at all never throws.
        CrashReportStore(java.io.File(tmp.root, "never-created")).delete("whatever")
    }

    // ---------------------------------------------- ChainingUncaughtHandler

    @Test
    fun `records first then delegates to the previous handler`() {
        val order = mutableListOf<String>()
        val handler = ChainingUncaughtHandler(
            record = { _, _ -> order.add("record") },
            previous = { _, _ -> order.add("previous") },
        )
        handler.uncaughtException(Thread.currentThread(), RuntimeException("x"))
        assertEquals(listOf("record", "previous"), order)
    }

    @Test
    fun `a recorder that explodes still delegates - never a crash in the crash handler`() {
        var delegated = false
        val handler = ChainingUncaughtHandler(
            record = { _, _ -> throw OutOfMemoryError("the disk is full too") },
            previous = { _, _ -> delegated = true },
        )
        handler.uncaughtException(Thread.currentThread(), RuntimeException("x"))
        assertTrue(delegated)
    }

    @Test
    fun `no previous handler is fine - and a throwing previous is contained`() {
        var recorded = false
        ChainingUncaughtHandler(record = { _, _ -> recorded = true }, previous = null)
            .uncaughtException(Thread.currentThread(), RuntimeException("x"))
        assertTrue(recorded)

        // A previous handler that throws must not propagate out of ours.
        ChainingUncaughtHandler(
            record = { _, _ -> },
            previous = { _, _ -> throw IllegalStateException("platform tantrum") },
        ).uncaughtException(Thread.currentThread(), RuntimeException("x"))
    }

    // ------------------------------------------------------ PostCrashHonesty

    @Test
    fun `interrupted only when a crash is NEWER than the call marker`() {
        assertTrue(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 150))
        assertTrue(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 100))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = 50))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = null, lastCrashAtMs = 150))
        assertFalse(PostCrashHonesty.callInterruptedByCrash(markerSetAtMs = 100, lastCrashAtMs = null))
    }

    // ------------------------------------------------------ CrashReportStore

    @Test
    fun `record - read - surface once - new crash surfaces again`() {
        var clock = 1_000L
        val store = CrashReportStore(tmp.newFolder("crash-reports"), now = { clock })

        assertNull(store.readAll())
        assertNull(store.unsurfacedReport())

        store.record("main", RuntimeException("first boom"), "1.0.0")
        val report = store.unsurfacedReport()
        assertNotNull(report)
        assertTrue(report!!.contains("first boom"))
        assertEquals(1_000L, store.lastCrashAtMs())

        store.markSurfaced()
        assertNull("same crash never offered twice", store.unsurfacedReport())

        clock = 2_000L
        store.record("worker", IllegalStateException("second boom"), "1.0.1")
        val second = store.unsurfacedReport()
        assertNotNull("a NEW crash surfaces again", second)
        assertTrue(second!!.contains("second boom"))
        assertEquals(2_000L, store.lastCrashAtMs())
    }

    @Test
    fun `the store rotates - twenty-three crashes keep the newest twenty`() {
        var clock = 0L
        val store = CrashReportStore(tmp.newFolder("crash-reports"), now = { clock })
        for (i in 1..23) {
            clock = i.toLong()
            store.record("main", RuntimeException("boom $i"), "1.0.0")
        }
        val entries = CrashReportLog.entries(store.readAll().orEmpty())
        assertEquals(CrashReportLog.MAX_ENTRIES, entries.size)
        assertTrue(entries.first().contains("boom 4"))
        assertTrue(entries.last().contains("boom 23"))
    }

    @Test
    fun `record never throws - even against an unwritable directory`() {
        // A FILE where the directory should be makes every write fail.
        val blocked = tmp.newFile("not-a-directory")
        val store = CrashReportStore(java.io.File(blocked, "nested"))
        store.record("main", RuntimeException("boom"), "1.0.0")
        assertNull(store.readAll())
        store.markSurfaced() // also total
    }

    // ---------------------------------------------------- CallInFlightMarker

    @Test
    fun `marker set - read - clear round trip, first stamp wins`() {
        var clock = 500L
        val marker = CallInFlightMarker(tmp.newFolder("crash-reports"), now = { clock })
        assertNull(marker.setAtMs())

        marker.set()
        assertEquals(500L, marker.setAtMs())

        // A second set during the same live stretch keeps the ORIGINAL stamp.
        clock = 900L
        marker.set()
        assertEquals(500L, marker.setAtMs())

        marker.clear()
        assertNull(marker.setAtMs())

        // A fresh call after the clear stamps anew.
        marker.set()
        assertEquals(900L, marker.setAtMs())
    }
}
