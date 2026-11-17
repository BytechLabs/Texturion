package com.loonext.android.features.tasks

import android.content.Context
import android.net.Uri
import androidx.annotation.MainThread
import com.loonext.android.features.compose.ComposerDrafts
import com.loonext.android.features.compose.ComposerState
import com.loonext.android.features.contacts.MultipartClient
import com.loonext.android.features.contacts.uploadNoteFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class TaskNoteFile(val uri: Uri, val name: String, val size: Long, val mime: String)

internal sealed interface TaskNoteProgress {
    data object Idle : TaskNoteProgress
    data object Posting : TaskNoteProgress
    data class Uploading(val current: Int, val total: Int) : TaskNoteProgress
    data class Posted(val failedFiles: Int) : TaskNoteProgress
    data class Failed(val cause: Exception) : TaskNoteProgress
}

internal class TaskNoteSubmission(
    private val scope: CoroutineScope,
    val draft: ComposerState,
    private val post: suspend (
        String, String, String?, String, List<TaskNoteFile>, (TaskNoteProgress.Uploading) -> Unit,
    ) -> Int,
) {
    private var job: Job? = null
    private val _progress = MutableStateFlow<TaskNoteProgress>(TaskNoteProgress.Idle)
    val progress = _progress.asStateFlow()

    @MainThread
    fun send(companyId: String, taskId: String, conversationId: String?, files: List<TaskNoteFile>): Boolean {
        if (_progress.value != TaskNoteProgress.Idle) return false
        val body = draft.text.trim()
        if (body.isEmpty() && (conversationId == null || files.isEmpty())) return false
        val attachments = files.toList()
        _progress.value = TaskNoteProgress.Posting
        job = scope.launch(Dispatchers.Main) {
            try {
                val failed = post(companyId, taskId, conversationId, body, attachments) { _progress.value = it }
                draft.clearForSend()
                _progress.value = TaskNoteProgress.Posted(failed)
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                _progress.value = TaskNoteProgress.Failed(cause)
            } finally {
                job = null
            }
        }
        return true
    }

    @MainThread
    fun consumeResult(result: TaskNoteProgress): Boolean =
        _progress.compareAndSet(result, TaskNoteProgress.Idle)

    @MainThread
    fun clear() {
        job?.cancel()
        draft.clearForSend()
        _progress.value = TaskNoteProgress.Idle
    }
}

internal class TaskNoteUploads(
    private val scope: CoroutineScope,
    private val context: Context,
    private val drafts: ComposerDrafts,
    private val mutations: TaskMutations,
    private val multipart: MultipartClient,
) {
    private val composers = mutableMapOf<String, TaskNoteSubmission>()

    @MainThread
    fun forTask(taskId: String): TaskNoteSubmission = composers.getOrPut(taskId) {
        TaskNoteSubmission(scope, ComposerState("task:$taskId", drafts, scope), ::post)
    }

    @MainThread
    fun clear() {
        composers.values.forEach(TaskNoteSubmission::clear)
        composers.clear()
    }

    private suspend fun post(
        companyId: String,
        taskId: String,
        conversationId: String?,
        body: String,
        files: List<TaskNoteFile>,
        update: (TaskNoteProgress.Uploading) -> Unit,
    ): Int {
        val ownerId = if (conversationId == null) {
            mutations.addComment(companyId, taskId, body).id
        } else {
            mutations.postNote(companyId, conversationId, body, taskId).id
        }
        val ownerType = if (conversationId == null) "task_comment" else "note"
        var failed = 0
        files.forEachIndexed { index, file ->
            update(TaskNoteProgress.Uploading(index + 1, files.size))
            try {
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(file.uri)?.use { it.readBytes() }
                }
                if (bytes == null) {
                    failed++
                } else {
                    multipart.uploadNoteFile(
                        companyId = companyId,
                        noteId = ownerId,
                        fileName = file.name,
                        contentType = file.mime,
                        bytes = bytes,
                        ownerType = ownerType,
                    )
                }
            } catch (cause: CancellationException) {
                throw cause
            } catch (_: Exception) {
                failed++
            }
        }
        return failed
    }
}
