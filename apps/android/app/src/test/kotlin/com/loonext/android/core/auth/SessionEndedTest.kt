package com.loonext.android.core.auth

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #330 — the customer's data leaves the phone when the session does, whichever way
 * the session ended.
 *
 * A session ends TWO ways: somebody taps Sign out, or the server refuses the refresh
 * token because the session was revoked. Only the first ever went through
 * `AuthManager.signOut`, so only the first cleared the render cache, the unread counts
 * and the Connected-Apps rows. An owner signing a departed tech's phone out from
 * Devices (#236) dropped the token and left everything else on a phone the company
 * does not own and cannot ask back.
 *
 * These assert the wiring that closes that: the store announces the ending, so a
 * third exit path cannot forget.
 */
@RunWith(RobolectricTestRunner::class)
// 34, matching the other Robolectric suites here: the target SDK is ahead of what
// Robolectric ships an image for, and DataStore is not what changed between them.
@Config(sdk = [34])
class SessionEndedTest {

    @After
    fun tearDown() = SessionEnded.reset()

    private fun store() = SessionStore(ApplicationProvider.getApplicationContext())

    @Test
    fun `clearing the session announces it`() = runTest {
        var fired = 0
        SessionEnded.onEnded { fired += 1 }

        store().clear()

        assertEquals("clearing the session must announce it", 1, fired)
    }

    @Test
    fun `a revoked session announces it exactly as a sign-out does`() = runTest {
        // The whole point of hanging this off the store: this test does not go
        // through the sign-out button, because a revocation does not either. It calls
        // clear() the way ApiClient's dead-refresh branch calls it.
        val order = mutableListOf<String>()
        SessionEnded.onEnded { order += "render cache" }
        SessionEnded.onEnded { order += "unread counts" }

        val sessions = store()
        sessions.save(
            Session(
                accessToken = "a",
                refreshToken = "r",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "u",
                email = "a@b.c",
            ),
        )
        sessions.clear()

        assertEquals(listOf("render cache", "unread counts"), order)
        assertEquals("the token itself must be gone too", null, sessions.current())
    }

    @Test
    fun `one listener throwing does not strand the others`() = runTest {
        // A revocation arrives on a background refresh with a screen open. The token
        // is already gone and the person is on their way to the sign-in screen either
        // way, so a failed eviction must not skip the next one — or become a crash on
        // the way out.
        val ran = mutableListOf<String>()
        SessionEnded.onEnded { ran += "first" }
        SessionEnded.onEnded { throw IllegalStateException("cache was already torn down") }
        SessionEnded.onEnded { ran += "third" }

        store().clear()

        assertEquals(listOf("first", "third"), ran)
    }

    @Test
    fun `saving a refreshed token announces nothing`() = runTest {
        // Every active device refreshes roughly hourly. If a save announced an ending,
        // the app would evict its own caches all day.
        var fired = 0
        SessionEnded.onEnded { fired += 1 }

        store().save(
            Session(
                accessToken = "fresh",
                refreshToken = "r",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "u",
                email = "a@b.c",
            ),
        )

        assertEquals("a refresh is not an ending", 0, fired)
    }

    @Test
    fun `the dead-refresh branch is the one that clears`() {
        // A SOURCE LINT, and the reason is that the branch it guards lives inside a
        // catch on a private refresh path with a live network client either side of
        // it. What must not drift is which branch clears: the TRANSIENT one rethrows
        // and keeps the session, because a Supabase 5xx or a shared-office 429 is
        // weather, and signing somebody out of a valid session costs a full re-login.
        val source = repoFile("apps/android/app/src/main/kotlin/com/loonext/android/core/net/ApiClient.kt")
        val transientAt = source.indexOf("if (cause.isTransientRefreshFailure()) throw cause")
        assertTrue("the transient guard has moved", transientAt > 0)
        val clearAt = source.indexOf("sessionStore.clear()", transientAt)
        assertTrue(
            "a rejected refresh token no longer clears the session",
            clearAt > transientAt,
        )
    }

    /** The repo, with carriage returns stripped — this tree is CRLF. */
    private fun repoFile(relative: String): String {
        var dir: java.io.File? = java.io.File("").absoluteFile
        while (dir != null) {
            val candidate = java.io.File(dir, relative)
            if (candidate.exists()) return candidate.readText().filterNot { it == '\r' }
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found")
    }
}
