package com.loonext.android.core.realtime

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TopicSequenceTrackerTest {
    private val topic = "realtime:company:c1:number:n1"

    private fun TestScope.tracker(gaps: MutableList<String>) =
        TopicSequenceTracker(scope = this, onGap = { gaps += it })

    @Test
    fun `events in order stay quiet`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        for (seq in 1L..4L) tracker.observe(topic, seq)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }

    @Test
    fun `a duplicate and an older sequence are ignored`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        for (seq in listOf(5L, 6L, 6L, 5L, 7L)) tracker.observe(topic, seq)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }

    @Test
    fun `a late event inside the window does not resync`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        tracker.observe(topic, 1)
        tracker.observe(topic, 3)
        advanceTimeBy(REORDER_WINDOW_MS - 1)
        tracker.observe(topic, 2)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }

    @Test
    fun `a hole still open after the window resyncs once`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        tracker.observe(topic, 1)
        tracker.observe(topic, 3)
        tracker.observe(topic, 4)
        advanceTimeBy(REORDER_WINDOW_MS - 1)
        assertEquals(emptyList<String>(), gaps)
        advanceTimeBy(2)
        assertEquals(listOf(topic), gaps)

        // The resync covers what was skipped, so the next event continues from 4.
        tracker.observe(topic, 5)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(listOf(topic), gaps)
    }

    @Test
    fun `the first event after a join only sets the baseline`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        tracker.observe(topic, 900)
        tracker.reset(topic)
        tracker.observe(topic, 4000)
        tracker.observe(topic, 4001)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }

    @Test
    fun `a reset cancels a pending window`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        tracker.observe(topic, 1)
        tracker.observe(topic, 3)
        tracker.resetAll()
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }

    @Test
    fun `topics count independently and a missing sequence is ignored`() = runTest {
        val gaps = mutableListOf<String>()
        val tracker = tracker(gaps)
        tracker.observe("a", 1)
        tracker.observe("b", 10)
        tracker.observe("a", null)
        tracker.observe("a", 2)
        tracker.observe("b", 11)
        advanceTimeBy(REORDER_WINDOW_MS * 2)
        assertEquals(emptyList<String>(), gaps)
    }
}
