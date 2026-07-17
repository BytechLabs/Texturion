package com.loonext.android.features.calls

import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.telephony.CallDirection
import com.loonext.android.telephony.CallPhase
import com.loonext.android.telephony.CallSnapshot
import com.loonext.android.telephony.SoftphoneSnapshot
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #167 banner presentation reducer: exactly one RINGING inbound call may own
 * the top banner; every other state belongs to the chip / in-call screen.
 * Plus the "to (workspace number)" line's honesty rule: claimed only when
 * the dialed number is unambiguous (exactly one active number).
 */
class BannerPresentationTest {
    private fun call(
        id: String,
        phase: CallPhase,
        direction: CallDirection = CallDirection.INBOUND,
    ) = CallSnapshot(
        id = id,
        direction = direction,
        peerName = "Dana",
        peerNumber = "+15551230000",
        phase = phase,
    )

    private fun number(
        id: String,
        status: String,
        e164: String? = "+14155550134",
    ) = PhoneNumberSummary(
        id = id,
        status = status,
        country = "US",
        number_e164 = e164,
        created_at = "2026-07-01T00:00:00Z",
    )

    private fun company(numbers: List<PhoneNumberSummary>) = CompanyView(
        id = "co-1",
        name = "Acme Plumbing",
        country = "US",
        us_texting_enabled = true,
        requested_area_code = "415",
        timezone = "America/New_York",
        subscription_status = "active",
        created_at = "2026-07-01T00:00:00Z",
        updated_at = "2026-07-01T00:00:00Z",
        numbers = numbers,
    )

    // ------------------------------------------------------ bannerRingingCall

    @Test
    fun `idle line shows no banner`() {
        assertNull(bannerRingingCall(SoftphoneSnapshot()))
    }

    @Test
    fun `a ringing inbound call owns the banner`() {
        val snapshot = SoftphoneSnapshot(calls = listOf(call("a", CallPhase.RINGING)))
        assertEquals("a", bannerRingingCall(snapshot)?.id)
    }

    @Test
    fun `an outbound call never rings the banner`() {
        val snapshot = SoftphoneSnapshot(
            calls = listOf(
                call("out", CallPhase.CONNECTING, CallDirection.OUTBOUND),
                // Defensive: even a structurally RINGING outbound is ignored.
                call("weird", CallPhase.RINGING, CallDirection.OUTBOUND),
            ),
        )
        assertNull(bannerRingingCall(snapshot))
    }

    @Test
    fun `answered and held calls hand off to the chip - no banner`() {
        for (phase in listOf(CallPhase.CONNECTING, CallPhase.ACTIVE, CallPhase.HELD)) {
            assertNull(bannerRingingCall(SoftphoneSnapshot(calls = listOf(call("a", phase)))))
        }
    }

    @Test
    fun `an ended call never resurrects the banner`() {
        assertNull(
            bannerRingingCall(SoftphoneSnapshot(calls = listOf(call("a", CallPhase.ENDED)))),
        )
    }

    @Test
    fun `call waiting - the second inbound ringing over an active call banners`() {
        val snapshot = SoftphoneSnapshot(
            calls = listOf(call("live", CallPhase.ACTIVE), call("second", CallPhase.RINGING)),
            activeId = "live",
        )
        assertEquals("second", bannerRingingCall(snapshot)?.id)
    }

    @Test
    fun `two simultaneous rings - the earliest wins, its end promotes the next`() {
        val both = SoftphoneSnapshot(
            calls = listOf(call("first", CallPhase.RINGING), call("second", CallPhase.RINGING)),
        )
        assertEquals("first", bannerRingingCall(both)?.id)

        val remaining = SoftphoneSnapshot(calls = listOf(call("second", CallPhase.RINGING)))
        assertEquals("second", bannerRingingCall(remaining)?.id)
    }

    // ------------------------------------------------------- calledNumberLine

    @Test
    fun `one active number is claimed on the banner`() {
        val line = calledNumberLine(company(listOf(number("n1", "active"))))
        assertEquals("to (415) 555-0134", line)
    }

    @Test
    fun `multiple active numbers - never guess which was dialed`() {
        val numbers = listOf(
            number("n1", "active"),
            number("n2", "active", e164 = "+14155550199"),
        )
        assertNull(calledNumberLine(company(numbers)))
    }

    @Test
    fun `non-active numbers do not count toward ambiguity`() {
        val numbers = listOf(
            number("n1", "active"),
            number("n2", "provisioning", e164 = null),
            number("n3", "released", e164 = "+14155550188"),
        )
        assertEquals("to (415) 555-0134", calledNumberLine(company(numbers)))
    }

    @Test
    fun `no usable number and no company mean no claim`() {
        assertNull(calledNumberLine(null))
        assertNull(calledNumberLine(company(emptyList())))
        assertNull(calledNumberLine(company(listOf(number("n1", "active", e164 = null)))))
    }
}
