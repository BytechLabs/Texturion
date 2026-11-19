package com.loonext.android.features.settings

import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.loonext.android.core.data.RecordDeletionRepository
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.TrashLinkedTask
import com.loonext.android.ui.common.Choice
import com.loonext.android.ui.common.ChoiceCards
import com.loonext.android.ui.common.ConfirmDialog
import kotlinx.coroutines.CancellationException

internal enum class TrashSource(val kind: String, val titleKey: String) {
    MESSAGE("message", "trash.deleteMessage"),
    NOTE("message", "trash.deleteNote"),
    CALL("call", "trash.deleteCall"),
}

@Composable
internal fun TrashSourceDialog(
    repository: RecordDeletionRepository,
    companyId: String,
    id: String,
    source: TrashSource,
    sentTextNotice: String? = null,
    onDismiss: () -> Unit,
    onConfirm: (includeTasks: Boolean) -> Unit,
) {
    var linked by remember(companyId, id) { mutableStateOf<List<TrashLinkedTask>?>(null) }
    var failed by remember(companyId, id) { mutableStateOf(false) }
    var attempt by remember(companyId, id) { mutableStateOf(0) }
    var includeTasks by remember(companyId, id) { mutableStateOf(false) }
    LaunchedEffect(companyId, id, source, attempt) {
        failed = false
        linked = try {
            repository.sourceTasks(companyId, source.kind, id)
        } catch (cause: CancellationException) {
            throw cause
        } catch (_: Exception) {
            failed = true
            null
        }
    }

    val jobs = linked.orEmpty()
    val explanation = when {
        failed -> t("trash.linkedJobLoadFailed")
        linked == null -> t("trash.loadingMore")
        jobs.isNotEmpty() -> t("trash.linkedJobErase", "number" to jobs.joinToString(", #") { it.number.toString() })
        else -> t("trash.sourceDeleteBody")
    }
    ConfirmDialog(
        title = t(source.titleKey),
        body = listOfNotNull(sentTextNotice, explanation).joinToString("\n\n"),
        confirmLabel = t("trash.moveToTrash"),
        onConfirm = { onConfirm(jobs.isNotEmpty() && includeTasks) },
        onDismiss = onDismiss,
        destructive = true,
        confirmEnabled = linked != null,
        extraContent = {
            if (failed) {
                TextButton(onClick = { attempt++ }) { Text(t("trash.retryLinkedJob")) }
            }
            if (jobs.isNotEmpty()) {
                ChoiceCards(
                    choices = listOf(
                        Choice(false, t("${source.titleKey}Only")),
                        Choice(true, t("${source.titleKey}AndJob")),
                    ),
                    selected = includeTasks,
                    onSelect = { includeTasks = it },
                )
            }
        },
    )
}
