package com.loonext.android.features.tasks

import android.widget.Toast
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.net.ApiDecodeException
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.thread.MakeTaskSheet
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * #689: "New task", a task with no text or call behind it. The same sheet a
 * message uses, with a blank title and everything but the title under More.
 *
 * [conversationId] links the task to a conversation (which fixes its contact);
 * otherwise [contactId] links it to a contact. Both are optional.
 */
@Composable
fun NewTaskSheetHost(
    graph: AppGraph,
    companyId: String,
    conversationId: String?,
    contactId: String?,
    contactName: String,
    onDismiss: () -> Unit,
    onCreated: () -> Unit = {},
    /** #739: a due to start with (an instant), read in [zone]; from a calendar tap. */
    initialDueIso: String? = null,
    zone: ZoneId = ZoneId.systemDefault(),
) {
    val context = LocalContext.current
    val locale = LocalAppLocale.current
    val scope = rememberCoroutineScope()
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var meUserId by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(companyId) {
        runCatching { CallsRepository(graph.api).members(companyId).data }
            .onSuccess { members = it }
        runCatching { graph.meRepo.me(companyId) }.onSuccess { meUserId = it.user_id }
    }

    MakeTaskSheet(
        message = null,
        contactName = contactName,
        members = members,
        meUserId = meUserId,
        aiRepo = graph.aiRepo,
        companyId = companyId,
        conversationId = conversationId.orEmpty(),
        standalone = true,
        initialDueIso = initialDueIso,
        zone = zone,
        linked = conversationId != null || contactId != null,
        tagsLoader = { TaskMutations(graph.api).tags(companyId).data },
        onCreate = { _, _, _, _ -> },
        onCreateWithExtras = { title, assignedUserId, dueAtIso, address: TaskAddressInput?, extras ->
            onDismiss()
            scope.launch {
                var createdId: String? = null
                val notice = try {
                    val mutations = TaskMutations(graph.api)
                    val created = mutations.create(
                        companyId = companyId,
                        title = title,
                        assignedUserId = assignedUserId,
                        assigneeIds = extras.assigneeIds,
                        dueAt = dueAtIso,
                        address = address,
                        conversationId = conversationId,
                        contactId = if (conversationId == null) contactId else null,
                        priority = extras.priority,
                        labelIds = extras.labels.filter { it.id.isNotEmpty() }.map { it.id },
                        repeat = extras.repeat,
                    )
                    // A label typed by name does not exist yet; the task does now.
                    extras.labels.filter { it.id.isEmpty() }.forEach { label ->
                        runCatching { mutations.addLabel(companyId, created.id, name = label.name) }
                    }
                    onCreated()
                    createdId = created.id
                    AppStrings.translate(locale, "thread.taskCreatedStandalone")
                } catch (_: ApiDecodeException) {
                    // The task WAS created (2xx); only the response decode failed.
                    onCreated()
                    AppStrings.translate(locale, "thread.taskCreatedStandalone")
                } catch (cause: Exception) {
                    cause.userMessage(locale ?: "en")
                }
                val id = createdId
                if (id != null) {
                    // #724: the confirmation carries Open, so the new task is one tap away.
                    graph.createdTaskNotices.tryEmit(
                        CreatedTaskNotice(notice, AppStrings.translate(locale, "common.open"), id),
                    )
                } else {
                    Toast.makeText(context, notice, Toast.LENGTH_SHORT).show()
                }
            }
        },
        onDismiss = onDismiss,
    )
}

/** The card a standalone task shows where a message or call task shows its source. */
@Composable
internal fun NoSourceCard(contactName: String?, modifier: Modifier = Modifier) {
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier,
    ) {
        Column(Modifier.padding(horizontal = 15.dp, vertical = 12.dp)) {
            Text(
                t("contactsTasks.noSource"),
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                t("contactsTasks.noSourceHint"),
                fontSize = 11.5.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 3.dp),
            )
            if (!contactName.isNullOrBlank()) {
                Text(
                    contactName,
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}
