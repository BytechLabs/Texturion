package com.loonext.android.ui.common

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DebouncedTextSaveTest {
    @Test
    fun `flushing before the timer saves the newest draft once`() = runTest {
        val writes = mutableListOf<String>()
        val autosave = DebouncedTextSave(this, "old") {
            writes.add(it)
            true
        }
        autosave.schedule("first edit")
        autosave.schedule(" newest edit ")
        autosave.flush()
        autosave.flush()
        advanceUntilIdle()
        assertEquals(listOf("newest edit"), writes)
    }

    @Test
    fun `a flush during a request waits and saves the next draft in order`() = runTest {
        val writes = mutableListOf<String>()
        val finishFirst = CompletableDeferred<Unit>()
        val autosave = DebouncedTextSave(this, "old") {
            writes.add(it)
            if (writes.size == 1) finishFirst.await()
            true
        }
        autosave.schedule("first edit")
        autosave.flush()
        runCurrent()
        autosave.schedule("latest")
        autosave.flush()
        assertEquals(listOf("first edit"), writes)
        finishFirst.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("first edit", "latest"), writes)
    }
}
