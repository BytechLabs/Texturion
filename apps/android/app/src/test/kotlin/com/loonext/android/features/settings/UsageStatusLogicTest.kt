package com.loonext.android.features.settings

import com.loonext.android.core.model.Usage
import com.loonext.android.core.model.UsageStatus
import com.loonext.android.core.model.UsageVoice
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #178 fair-use presentation helpers: which meter the 'pacing' warning names,
 * how close the 'capped' state reads, and the decode default that keeps
 * pre-#178 payloads rendering as the calm state.
 */
class UsageStatusLogicTest {
    private fun usage(
        usedSegments: Long = 0,
        includedSegments: Long = 500,
        capSegments: Long? = 5000,
        usedMinutes: Long = 0,
        includedMinutes: Long = 2500,
        capMinutes: Long? = 25000,
    ) = Usage(
        used_segments = usedSegments,
        included_segments = includedSegments,
        cap_segments = capSegments,
        voice = UsageVoice(
            used_minutes = usedMinutes,
            included_minutes = includedMinutes,
            cap_minutes = capMinutes,
        ),
    )

    // -- pacingSubject --------------------------------------------------------

    @Test
    fun `pacingSubject names messages when texts run hotter`() {
        assertEquals(
            "Messages",
            pacingSubject(usage(usedSegments = 450, usedMinutes = 100)),
        )
    }

    @Test
    fun `pacingSubject names calling minutes when voice runs hotter`() {
        assertEquals(
            "Calling minutes",
            pacingSubject(usage(usedSegments = 50, usedMinutes = 2400)),
        )
    }

    @Test
    fun `pacingSubject names both only when both are past included`() {
        assertEquals(
            "Messages and calling minutes",
            pacingSubject(usage(usedSegments = 600, usedMinutes = 2600)),
        )
        // One over, one merely warm: name the hot one alone.
        assertEquals(
            "Messages",
            pacingSubject(usage(usedSegments = 600, usedMinutes = 2000)),
        )
    }

    @Test
    fun `pacingSubject defaults to messages when allowances are zero`() {
        assertEquals(
            "Messages",
            pacingSubject(usage(includedSegments = 0, includedMinutes = 0)),
        )
    }

    // -- capUseRatio / capUsePercent ------------------------------------------

    @Test
    fun `capUseRatio takes the hotter of the two cap meters`() {
        val hotVoice = usage(usedSegments = 500, usedMinutes = 23750)
        assertEquals(0.95, capUseRatio(hotVoice), 1e-9)
        assertEquals(95, capUsePercent(hotVoice))
    }

    @Test
    fun `capUsePercent clamps at 100 once the cap is reached`() {
        assertEquals(100, capUsePercent(usage(usedSegments = 6000)))
    }

    @Test
    fun `capUseRatio reads null caps as zero, never dividing`() {
        assertEquals(
            0.0,
            capUseRatio(usage(capSegments = null, capMinutes = null, usedSegments = 400)),
            1e-9,
        )
    }

    // -- decode default -------------------------------------------------------

    @Test
    fun `payloads without status decode as the calm state`() {
        val json = Json { ignoreUnknownKeys = true }
        val decoded = json.decodeFromString<Usage>("""{"used_segments":12}""")
        assertEquals(UsageStatus.QUIET, decoded.status)
    }
}
