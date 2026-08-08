package com.loonext.android.features.thread

import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * #330 — the outbox does not outlive the session.
 *
 * Against the REAL store rather than the fake in [OutboxTest], because what is being
 * asserted is that bytes leave a DataStore and a directory on disk. A fake whose
 * `clear()` empties two maps proves only that the fake was written correctly.
 *
 * The case: a tech leaves, the owner signs their phone out from Devices (#236), and
 * what they were half-way through saying to a homeowner is still sitting on a phone
 * the company does not own and cannot ask back. Worse, it could flush later under a
 * session that no longer exists.
 */
@RunWith(RobolectricTestRunner::class)
// 34, matching the other Robolectric suites here: the target SDK is ahead of what
// Robolectric ships an image for, and DataStore is not what changed between them.
@Config(sdk = [34])
class OutboxClearTest {

    private fun store() = Outbox(ApplicationProvider.getApplicationContext())

    private fun queued(localId: String) = QueuedSend(
        localId = localId,
        companyId = "co1",
        conversationId = "c1",
        body = "On my way — should be twenty minutes",
        createdAt = "2026-07-28T10:00:00Z",
    )

    @Test
    fun `clearing takes the messages and the photos with them`() = runTest {
        val outbox = store()
        val media = outbox.saveMedia(
            "k1",
            listOf(OutboxMediaBytes("image/jpeg", byteArrayOf(9, 8, 7))),
        )
        assertEquals("the fixture itself must have written a photo", 1, media.size)
        outbox.put(queued("k1").copy(media = media))
        outbox.put(queued("k2"))
        assertEquals("the fixture itself must have queued two", 2, outbox.all().size)

        outbox.clear()

        assertTrue("the queue must be empty", outbox.all().isEmpty())
        assertEquals(
            "the photo bytes must be gone, not just unreferenced",
            null,
            outbox.readMedia("k1", media[0]),
        )
    }

    @Test
    fun `a row nothing can decode still loses its photos`() = runTest {
        // The reason clear() deletes the whole media directory rather than walking
        // the rows: a row that fails to decode is a row `all()` cannot see, so a
        // per-row sweep would leave its photos behind. What must not remain is the
        // bytes, whatever the queue thinks is in it.
        val outbox = store()
        val orphan = outbox.saveMedia(
            "gone",
            listOf(OutboxMediaBytes("image/jpeg", byteArrayOf(1))),
        )

        outbox.clear()

        assertEquals(null, outbox.readMedia("gone", orphan[0]))
    }

    @Test
    fun `clearing an empty outbox is not an error`() = runTest {
        // It runs on every session ending, including the first sign-out on a phone
        // that never queued anything and has no media directory at all.
        store().clear()
        assertTrue(store().all().isEmpty())
    }
}
