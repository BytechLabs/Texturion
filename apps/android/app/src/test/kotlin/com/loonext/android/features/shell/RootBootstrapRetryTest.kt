package com.loonext.android.features.shell

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #483: the hydrated /v1/me is the only source of the access-filtered number
 * list, and a failure handed the realtime client an EMPTY one — company topic
 * joined, not a single per-number topic — until the next re-JOIN, which on a
 * healthy socket can be hours away.
 *
 * The schedule is asserted on VIRTUAL time: runTest skips the delays, so these
 * describe the real production waits without spending them.
 */
class RootBootstrapRetryTest {

    @Test
    fun `it stops at the first attempt that lands`() = runTest {
        var attempts = 0
        val healed = retryNumberList { ++attempts >= 2 }

        assertTrue(healed)
        // Two, not three: nothing keeps re-reading /v1/me once the list it was
        // missing is in hand.
        assertEquals(2, attempts)
    }

    @Test
    fun `it gives up, because the re-JOIN heal is still behind it`() = runTest {
        var attempts = 0
        val healed = retryNumberList { attempts++; false }

        assertFalse(healed)
        assertEquals(NUMBER_LIST_RETRY_DELAYS_MS.size, attempts)
    }

    // TestScope.currentTime — the virtual clock is still experimental API.
    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun `it waits before the first attempt and widens after each`() = runTest {
        val attemptedAtMs = mutableListOf<Long>()

        retryNumberList { attemptedAtMs.add(currentTime); false }

        // Never immediate: a read that just failed fails the same way in the same
        // millisecond. Widening so a provider blip and a short outage are both
        // covered inside one bounded ~17s window.
        assertEquals(listOf(1_000L, 5_000L, 17_000L), attemptedAtMs)
    }
}
