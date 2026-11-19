package com.loonext.android.features.compose

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.IntentCompat
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ConversationListItem
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.PickerOption
import com.loonext.android.ui.common.SearchablePickerSheet
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

data class IncomingShare(val text: String, val files: List<Uri>)

internal fun incomingShareFrom(intent: Intent?): IncomingShare? {
    val action = intent?.action
    if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return null
    val payload = checkNotNull(intent)
    val type = payload.type?.lowercase() ?: return null
    if (!type.startsWith("image/") && type != "application/pdf" && type != "text/plain") return null
    val streams = if (action == Intent.ACTION_SEND_MULTIPLE) {
        IntentCompat.getParcelableArrayListExtra(payload, Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
    } else {
        listOfNotNull(IntentCompat.getParcelableExtra(payload, Intent.EXTRA_STREAM, Uri::class.java))
    }
    val clip = payload.clipData
    val files = (streams.asSequence() + (0 until (clip?.itemCount ?: 0)).asSequence()
        .mapNotNull { clip?.getItemAt(it)?.uri })
        .filter { it.scheme == "content" }
        .distinct()
        .take(MAX_NOTE_FILES + 1)
        .toList()
    val text = payload.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.trim()?.take(4096).orEmpty()
    return IncomingShare(text, files).takeIf { it.text.isNotEmpty() || it.files.isNotEmpty() }
}

internal suspend fun stageIncomingShare(
    context: Context,
    composer: ComposerState,
    share: IncomingShare,
    locale: String,
    onNotice: (String) -> Unit,
) {
    val isNote = composer.mode == ComposerMode.Note
    if (share.text.isNotEmpty()) {
        val joined = listOf(composer.text, share.text).filter { it.isNotBlank() }.joinToString("\n")
        composer.onTextChange(joined.take(4096))
    }
    if (isNote) {
        val room = MAX_NOTE_FILES - composer.files.size
        for (uri in share.files.take(room)) {
            when (val result = stageNoteFile(context, uri, locale)) {
                is FileStageResult.Ready -> composer.files = composer.files + result.file
                is FileStageResult.Rejected -> onNotice(result.reason)
            }
        }
        if (share.files.size > room) onNotice(AppStrings.translate(locale, "thread.attachLimitNote"))
        return
    }
    val room = MAX_PHOTOS - composer.photos.size
    for (uri in share.files.take(room)) {
        when (val result = stageMmsMedia(context, uri, locale)) {
            is MmsStageResult.Ready -> {
                composer.photos = composer.photos + result.media
                composer.mediaInfo = composer.mediaInfo + (result.media.id to result.info)
            }
            is MmsStageResult.Rejected -> onNotice(result.reason)
        }
    }
    if (share.files.size > room) {
        onNotice(AppStrings.translate(locale, "thread.attachLimitText", mapOf("max" to "$MAX_PHOTOS")))
    }
}

@Composable
internal fun ShareTargetSheet(
    repository: MessagingRepository,
    companyId: String,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val locale = LocalAppLocale.current
    var query by remember { mutableStateOf("") }
    var rows by remember { mutableStateOf<List<ConversationListItem>>(emptyList()) }
    var failure by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    LaunchedEffect(companyId, query) {
        loading = true
        failure = null
        if (query.isNotBlank()) delay(250)
        try {
            rows = repository.conversations(
                companyId,
                q = query.trim().ifEmpty { null },
                snoozed = "all",
                textableOnly = true,
            ).data
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            failure = error.userMessage(locale)
        } finally {
            loading = false
        }
    }
    val options = if (loading || failure != null) emptyList() else rows.map { thread ->
        val label = thread.contact.name?.takeIf { it.isNotBlank() } ?: thread.contact.phone_e164
        PickerOption(thread.id, label)
    }
    SearchablePickerSheet(
        options = options,
        selected = null,
        onPick = onSelect,
        onDismiss = onDismiss,
        title = t("thread.shareToThread"),
        onSearch = {
            loading = true
            query = it
        },
        emptyState = {
            when {
                loading -> CircularProgressIndicator()
                failure != null -> Text(failure.orEmpty())
                else -> Text(t("thread.noShareThreads"))
            }
        },
    )
}
