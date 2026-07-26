package com.loonext.android.features.compose

import com.loonext.android.features.thread.PickedMention
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #269 — a typed draft must survive leaving the screen.
 *
 * ThreadScreen is a routed overlay: a back press removes it from the
 * composition at once. When the 400 ms debounce ran on `rememberCoroutineScope()`
 * it died with that composition, so anyone who typed and left inside the window
 * reopened the thread to an empty composer with nothing to say the words had
 * ever existed. These drive the state object directly with a cancellable stand-in
 * for the screen's scope, which is the only way to reproduce that race reliably.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ComposerDraftPersistenceTest {

    private class RecordingDrafts : ComposerDrafts {
        val saved = mutableMapOf<String, String>()
        val savedMentions = mutableMapOf<String, List<PickedMention>>()
        var cleared: String? = null

        override suspend fun load(conversationId: String) = saved[conversationId].orEmpty()

        override suspend fun save(conversationId: String, text: String) {
            saved[conversationId] = text
        }

        override suspend fun clear(conversationId: String) {
            cleared = conversationId
            saved.remove(conversationId)
        }

        override suspend fun loadMentions(conversationId: String) =
            savedMentions[conversationId].orEmpty()

        override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) {
            savedMentions[conversationId] = mentions
        }
    }

    @Test
    fun `a draft typed just before leaving still lands`() = runBlocking {
        // Real time, not the test scheduler's: the point of the fix is that
        // the write runs on a scope nothing on screen owns.
        val drafts = RecordingDrafts()
        val composer = ComposerState("conv-1", drafts)

        composer.onTextChange("On my way, be there in 20")
        // The back gesture happens here, well inside the 400 ms debounce —
        // there is nothing left to cancel it with.
        withTimeout(5_000) {
            while (drafts.saved["conv-1"] == null) delay(10)
        }

        assertEquals("On my way, be there in 20", drafts.saved["conv-1"])
    }

    @Test
    fun `the screen's own scope would have dropped it — the regression, pinned`() = runTest {
        // What shipped before: the debounce ran on rememberCoroutineScope(),
        // which Compose cancels the moment a routed overlay is popped. This is
        // that exact wiring, and it loses the words.
        val drafts = RecordingDrafts()
        val screenScope = CoroutineScope(coroutineContext + Job())
        val composer = ComposerState("conv-1", drafts, screenScope)

        composer.onTextChange("On my way, be there in 20")
        screenScope.cancel() // back press, inside the debounce
        advanceUntilIdle()

        assertNull(drafts.saved["conv-1"])
    }

    @Test
    fun `a sent message does not come back as a draft`() = runTest {
        // clearForSend had the mirror-image bug: the clear was cancelled by an
        // immediate back press, so the thread reopened showing the message the
        // user had just sent, still sitting in the composer.
        val drafts = RecordingDrafts()
        val persistScope = CoroutineScope(coroutineContext + Job())
        val composer = ComposerState("conv-1", drafts, persistScope)

        composer.onTextChange("Heading over now")
        advanceUntilIdle()
        assertEquals("Heading over now", drafts.saved["conv-1"])

        composer.clearForSend()
        advanceUntilIdle()

        assertEquals("conv-1", drafts.cleared)
        assertNull(drafts.saved["conv-1"])
    }

    @Test
    fun `the draft written is the text that was typed, not what came after`() = runTest {
        // The write now runs after the screen may be gone, so it captures the
        // words at queue time rather than re-reading state later.
        val drafts = RecordingDrafts()
        val persistScope = CoroutineScope(coroutineContext + Job())
        val composer = ComposerState("conv-1", drafts, persistScope)

        composer.onTextChange("Runn")
        composer.onTextChange("Running late")
        advanceUntilIdle()

        // Keystrokes coalesce: one write, carrying the last thing typed.
        assertEquals("Running late", drafts.saved["conv-1"])
    }

    @Test
    fun `mentions ride with the words`() = runTest {
        // A restored draft that still reads "@Sam" but notifies nobody is worse
        // than a lost one: the note on screen is evidence of something that
        // will not happen.
        val drafts = RecordingDrafts()
        val persistScope = CoroutineScope(coroutineContext + Job())
        val composer = ComposerState("conv-1", drafts, persistScope)

        composer.onTextChange("@Sam can you check the panel size")
        composer.addMention(PickedMention(userId = "user-sam", name = "Sam"))
        advanceUntilIdle()

        assertEquals(
            listOf("user-sam"),
            drafts.savedMentions["conv-1"]?.map { it.userId },
        )
    }
}
