package com.loonext.android.core.security

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #330 — the lock's rules, which are the whole feature.
 *
 * The fingerprint sheet is a platform call. What decides whether a customer's
 * conversations are on screen when somebody else is holding the phone is the
 * arithmetic in [AppLock], and that is what these pin.
 */
class AppLockTest {

    private val now = 1_700_000_000_000L

    @Test
    fun `off means never locked, whatever else is true`() {
        // A sole operator must not meet a lock they never asked for. The product
        // promise is answering inside five minutes; friction nobody chose is the
        // fastest way to have this turned off by everyone.
        assertNull(AppLock.reasonToLock(enabled = false, unlockedAtMillis = null, nowMillis = now))
        assertNull(AppLock.reasonToLock(enabled = false, unlockedAtMillis = 0L, nowMillis = now))
    }

    @Test
    fun `a fresh process locks even though it was unlocked a second ago`() {
        // `unlockedAtMillis` is per-PROCESS and never persisted, so a cold start
        // arrives with null however recently the phone was used. This is the case
        // that matters most: the phone was handed over, the app was killed, and
        // the recipient taps the icon.
        assertEquals(
            AppLock.Reason.NEVER_UNLOCKED,
            AppLock.reasonToLock(enabled = true, unlockedAtMillis = null, nowMillis = now),
        )
    }

    @Test
    fun `a glance at another app and straight back does not ask again`() {
        // Checking the map or the dialler is seconds. Re-authenticating for that
        // teaches people to turn this off, which protects nobody.
        assertNull(
            AppLock.reasonToLock(
                enabled = true,
                unlockedAtMillis = now - 5_000L,
                nowMillis = now,
            ),
        )
    }

    @Test
    fun `the grace window is a boundary, not a suggestion`() {
        // Exactly at the window is still unlocked; one millisecond past is not.
        // Asserted because an off-by-one here is either a lock that never fires
        // or one that fires a minute early, and both read as "it is broken".
        assertNull(
            AppLock.reasonToLock(
                enabled = true,
                unlockedAtMillis = now - AppLock.GRACE_MILLIS,
                nowMillis = now,
            ),
        )
        assertEquals(
            AppLock.Reason.AWAY_TOO_LONG,
            AppLock.reasonToLock(
                enabled = true,
                unlockedAtMillis = now - AppLock.GRACE_MILLIS - 1L,
                nowMillis = now,
            ),
        )
    }

    @Test
    fun `a clock that went backwards locks rather than trusting a negative age`() {
        // Moving the phone's clock back would otherwise make every unlock look
        // like it happened moments ago — a way past the lock that needs no
        // fingerprint at all. An age that cannot be trusted asks again.
        assertEquals(
            AppLock.Reason.AWAY_TOO_LONG,
            AppLock.reasonToLock(
                enabled = true,
                unlockedAtMillis = now + 60_000L,
                nowMillis = now,
            ),
        )
    }

    @Test
    fun `it refuses to turn on where the phone cannot enforce it`() {
        // A device with no fingerprint and no screen lock has nothing to ask
        // with. Accepting the toggle anyway would leave somebody believing the
        // phone in their glovebox was protected.
        assertFalse(AppLock.canEnable(hasBiometric = false, hasDeviceCredential = false))
        assertTrue(AppLock.canEnable(hasBiometric = true, hasDeviceCredential = false))
        assertTrue(AppLock.canEnable(hasBiometric = false, hasDeviceCredential = true))
        assertTrue(AppLock.CANNOT_ENABLE_NOTE.contains("screen lock"))
    }

    @Test
    fun `the lock screen never reads as a fault`() {
        // Nothing has gone wrong when this shows: the person asked for it, and the
        // phone is theirs. "Session expired" would be a lie about whose doing it
        // is, and reads as the app having lost something.
        for (reason in AppLock.Reason.entries) {
            val headline = AppLock.headline(reason)
            assertTrue(headline, headline.startsWith("Unlock"))
            for (word in listOf("expired", "error", "failed", "invalid", "denied")) {
                assertFalse("$reason said: $headline", headline.lowercase().contains(word))
            }
        }
    }
}
