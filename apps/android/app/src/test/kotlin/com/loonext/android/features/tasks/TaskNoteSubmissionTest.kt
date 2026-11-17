package com.loonext.android.features.tasks

import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.ComposerState
import com.loonext.android.features.thread.PickedMention
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TaskNoteSubmissionTest {
    private class RecordingDrafts : ComposerDrafts {
        private val values = mutableMapOf<String, String>()

        override suspend fun load(conversationId: String): String = values[conversationId].orEmpty()

        override suspend fun save(conversationId: String, text: String) {
            values[conversationId] = text
        }

        override suspend fun clear(conversationId: String) {
            values.remove(conversationId)
        }

        override suspend fun loadMentions(conversationId: String): List<PickedMention> = emptyList()

        override suspend fun saveMentions(conversationId: String, mentions: List<PickedMention>) = Unit
    }

    @Test
    fun `an upload outlives the screen and a second tap cannot post a duplicate`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val finishUpload = CompletableDeferred<Unit>()
            val drafts = RecordingDrafts()
            val draft = ComposerState("task:job-1", drafts, backgroundScope)
            val sent = mutableListOf<String>()
            val submission = TaskNoteSubmission(backgroundScope, draft) { _, _, _, body, _, update ->
                sent += body
                update(TaskNoteProgress.Uploading(1, 1))
                finishUpload.await()
                0
            }
            val screen = launch { submission.progress.collect { } }

            draft.onTextChange("Checked the pump")
            assertTrue(submission.send("company-1", "job-1", null, emptyList()))
            runCurrent()
            assertEquals(TaskNoteProgress.Uploading(1, 1), submission.progress.value)
            screen.cancelAndJoin()
            assertFalse(submission.send("company-1", "job-1", null, emptyList()))
            finishUpload.complete(Unit)
            runCurrent()

            assertEquals(listOf("Checked the pump"), sent)
            assertEquals(TaskNoteProgress.Posted(0), submission.progress.value)
            assertEquals("", draft.text)
            assertTrue(submission.consumeResult(TaskNoteProgress.Posted(0)))
            assertFalse(submission.consumeResult(TaskNoteProgress.Posted(0)))
        } finally {
            Dispatchers.resetMain()
        }
    }
}
