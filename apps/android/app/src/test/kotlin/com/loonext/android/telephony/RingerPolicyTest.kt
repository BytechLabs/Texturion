package com.loonext.android.telephony

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #167 ringer state machine: the pure (ringerMode, ringingCount) ->
 * RingerCommand reducer every softphone state emission runs through.
 */
class RingerPolicyTest {
    @Test
    fun `no ringing calls means stop - whatever the ringer mode`() {
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.NORMAL, 0))
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.VIBRATE, 0))
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.SILENT, 0))
    }

    @Test
    fun `silent device stays silent - no sound, no vibration`() {
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.SILENT, 1))
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.SILENT, 2))
    }

    @Test
    fun `vibrate mode rings with vibration only`() {
        assertEquals(RingerCommand.VIBRATE_ONLY, RingerPolicy.decide(RingMode.VIBRATE, 1))
    }

    @Test
    fun `normal mode rings with sound and vibration`() {
        assertEquals(RingerCommand.RING_AND_VIBRATE, RingerPolicy.decide(RingMode.NORMAL, 1))
    }

    @Test
    fun `a second simultaneous ring keeps the surface up`() {
        assertEquals(RingerCommand.RING_AND_VIBRATE, RingerPolicy.decide(RingMode.NORMAL, 2))
    }

    @Test
    fun `a defensive negative count is a stop`() {
        assertEquals(RingerCommand.STOP, RingerPolicy.decide(RingMode.NORMAL, -1))
    }
}
