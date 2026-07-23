package com.loonext.android.features.contacts

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneId

/**
 * The consent card's one line — ported copy from the web /contacts/[id]
 * ConsentLine, so the two clients never explain consent differently.
 */
class ConsentLineTest {

    private val clock: Clock =
        Clock.fixed(Instant.parse("2026-07-15T12:00:00Z"), ZoneId.of("UTC"))

    private val members = mapOf("u1" to "Dana Fields")
    private fun memberName(userId: String?): String? = members[userId]

    @Test
    fun `no consent recorded teaches how it gets recorded`() {
        assertEquals(
            "No consent recorded yet. It's recorded when they text you first, " +
                "or when you send them their first text, which attests they asked for it.",
            consentLine(null, null, null, ::memberName, clock),
        )
    }

    @Test
    fun `inbound sms reads texted-you-first with the date`() {
        assertEquals(
            "Texted you first · Jul 8",
            consentLine(
                ConsentSource.INBOUND_SMS,
                "2026-07-08T15:00:00Z",
                null,
                ::memberName,
                clock,
            ),
        )
    }

    @Test
    fun `inbound sms without a date omits the suffix`() {
        assertEquals(
            "Texted you first",
            consentLine(ConsentSource.INBOUND_SMS, null, null, ::memberName, clock),
        )
    }

    @Test
    fun `attested consent names the member who recorded it`() {
        assertEquals(
            "Consent recorded by Dana Fields · Jul 8",
            consentLine(
                ConsentSource.ATTESTED,
                "2026-07-08T15:00:00Z",
                "u1",
                ::memberName,
                clock,
            ),
        )
    }

    @Test
    fun `an unresolvable attester is omitted, not faked`() {
        assertEquals(
            "Consent recorded · Jul 8",
            consentLine(
                ConsentSource.ATTESTED,
                "2026-07-08T15:00:00Z",
                "u-gone",
                ::memberName,
                clock,
            ),
        )
    }

    @Test
    fun `import-sourced consent reads as recorded`() {
        assertEquals(
            "Consent recorded",
            consentLine(ConsentSource.IMPORT, null, null, ::memberName, clock),
        )
    }

    @Test
    fun `an unparseable consent date drops the suffix rather than crashing`() {
        assertEquals(
            "Texted you first",
            consentLine(ConsentSource.INBOUND_SMS, "garbage", null, ::memberName, clock),
        )
    }
}
