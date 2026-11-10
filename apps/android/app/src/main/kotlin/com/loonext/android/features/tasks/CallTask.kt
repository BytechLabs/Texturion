package com.loonext.android.features.tasks

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material.icons.outlined.Voicemail
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ConversationEvent
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.TaskAddressInput
import com.loonext.android.core.model.TaskSourceCall
import com.loonext.android.core.net.ApiDecodeException
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.calls.formatCallDuration
import com.loonext.android.features.thread.MakeTaskSheet
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonPrimitive

/**
 * D64: an answered call can become a task. The pure parts live here so they
 * unit-test on the JVM; the composables below are thin.
 */

/** Who rang, for a task promoted from a call: name, else number, else unknown. */
fun taskCallerName(call: TaskSourceCall, locale: String?): String =
    call.caller_name?.takeIf { it.isNotBlank() }
        ?: call.caller_e164?.takeIf { it.isNotBlank() }?.let { formatPhone(it) }
        ?: AppStrings.translate(locale, "contactsTasks.callUnknownCaller")

/**
 * The carrier session id of a timeline line that narrates an ANSWERED call, else
 * null. A voicemail or transfer line carries a `kind`, and an outbound or missed
 * call is not one a task can come from: the server refuses anything but an
 * answered call. Mirrors the web's system-line.tsx.
 */
fun answeredCallSessionOf(event: ConversationEvent): String? {
    if (event.type != "call_completed") return null
    fun text(key: String): String? =
        (event.payload[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
    if (text("outcome") != "answered") return null
    if (event.payload.containsKey("kind")) return null
    return text("call_session_id")?.takeIf { it.isNotBlank() }
}

/** The caller named on a timeline call line, for the seeded title. */
fun callLineCallerOf(event: ConversationEvent, locale: String?): String =
    (event.payload["caller"] as? JsonPrimitive)?.takeIf { it.isString }?.content
        ?.takeIf { it.isNotBlank() }
        ?: AppStrings.translate(locale, "contactsTasks.callUnknownCaller")

/** GET /v1/calls/:sessionId, read only for the call's own id. */
@Serializable
private data class CallIdRef(val id: String)

/**
 * "Make a task" on an answered call: one quiet icon that opens the same sheet a
 * message uses, seeded "Call from {name}". The caller renders it only for an
 * answered call that landed in a conversation.
 *
 * The call log knows the call's id ([callId]). The thread's call line carries
 * only the carrier session id ([sessionId]), so the id is read when the sheet
 * is opened, not once per line in a long thread.
 */
@Composable
fun CallTaskButton(
    graph: AppGraph,
    companyId: String,
    conversationId: String,
    callerName: String,
    modifier: Modifier = Modifier,
    callId: String? = null,
    sessionId: String? = null,
) {
    var open by remember(callId, sessionId) { mutableStateOf(false) }
    IconButton(onClick = { open = true }, modifier = modifier.size(48.dp)) {
        Icon(
            Icons.Outlined.AddTask,
            contentDescription = t("thread.makeTaskFromCall"),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp),
        )
    }
    if (open) {
        CallTaskSheetHost(
            graph = graph,
            companyId = companyId,
            conversationId = conversationId,
            callerName = callerName,
            callId = callId,
            sessionId = sessionId,
            onDismiss = { open = false },
        )
    }
}

@Composable
private fun CallTaskSheetHost(
    graph: AppGraph,
    companyId: String,
    conversationId: String,
    callerName: String,
    callId: String?,
    sessionId: String?,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val locale = LocalAppLocale.current
    val scope = rememberCoroutineScope()
    var members by remember { mutableStateOf<List<Member>>(emptyList()) }
    var meUserId by remember { mutableStateOf<String?>(null) }
    androidx.compose.runtime.LaunchedEffect(companyId) {
        runCatching { CallsRepository(graph.api).members(companyId).data }
            .onSuccess { members = it }
        runCatching { graph.meRepo.me(companyId) }.onSuccess { meUserId = it.user_id }
    }
    fun say(key: String) = AppStrings.translate(locale, key)

    MakeTaskSheet(
        message = null,
        contactName = callerName,
        members = members,
        meUserId = meUserId,
        aiRepo = graph.aiRepo,
        companyId = companyId,
        conversationId = conversationId,
        callTitle = AppStrings.translate(locale, "thread.callTaskTitle", mapOf("name" to callerName)),
        onCreate = { title, assignedUserId, dueAtIso, address: TaskAddressInput? ->
            onDismiss()
            scope.launch {
                val notice = try {
                    val id = callId
                        ?: graph.api.get<CallIdRef>(
                            "/v1/calls/${java.net.URLEncoder.encode(sessionId.orEmpty(), "UTF-8")}",
                            companyId = companyId,
                        ).id
                    TaskMutations(graph.api).create(
                        companyId = companyId,
                        title = title,
                        assignedUserId = assignedUserId,
                        dueAt = dueAtIso,
                        address = address,
                        sourceCallId = id,
                    )
                    say("thread.taskCreatedFromCall")
                } catch (_: ApiDecodeException) {
                    // The task WAS created (2xx); only the response decode failed.
                    say("thread.taskCreatedFromCall")
                } catch (cause: Exception) {
                    if ((cause as? ApiException)?.code == ApiErrorCode.CONFLICT) {
                        say("thread.alreadyHasCallTask")
                    } else {
                        cause.userMessage(locale ?: "en")
                    }
                }
                Toast.makeText(context, notice, Toast.LENGTH_SHORT).show()
            }
        },
        onDismiss = onDismiss,
    )
}

/** The lime-barred card naming the call a task was promoted from (D64). */
@Composable
internal fun SourceCallCard(
    call: TaskSourceCall,
    onOpenConversation: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    val locale = LocalAppLocale.current
    Surface(
        shape = MaterialTheme.shapes.large,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier,
    ) {
        Row(
            Modifier
                .padding(horizontal = 15.dp, vertical = 12.dp)
                .height(IntrinsicSize.Min),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                Modifier
                    .width(3.dp)
                    .fillMaxHeight()
                    .background(BrandColor.LimeBright, CircleShape),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    t("contactsTasks.callFrom", "name" to taskCallerName(call, locale)),
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    callMeta(call),
                    fontSize = 11.5.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 3.dp),
                )
                if (call.has_voicemail) {
                    Row(
                        Modifier.padding(top = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                    ) {
                        Icon(
                            Icons.Outlined.Voicemail,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.size(14.dp),
                        )
                        Text(
                            t("contactsTasks.callVoicemailLeft"),
                            fontSize = 11.5.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (onOpenConversation != null) {
                    Text(
                        t("contactsTasks.openConversationArrow"),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier
                            .padding(top = 6.dp)
                            .clickable(onClick = onOpenConversation),
                    )
                }
            }
        }
    }
}

/** "3h · Talked for 4m 32s": when it was, and how long they spoke. */
@Composable
internal fun callMeta(call: TaskSourceCall): String {
    val when_ = relativeTime(call.started_at)
    if (call.forward_seconds <= 0) return when_
    val talk = t("contactsTasks.callTalkTime", "duration" to formatCallDuration(call.forward_seconds))
    return "$when_ · $talk"
}
