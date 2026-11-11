package com.loonext.android.features.calls

import androidx.compose.foundation.layout.Arrangement
import com.loonext.android.ui.common.PaperCard
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Call
import com.loonext.android.core.time.TimestampFormat
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.ui.common.LoadError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.features.activity.ActivityRecordType
import com.loonext.android.features.activity.ActivityTimeline
import com.loonext.android.ui.common.Timestamp
import com.loonext.android.ui.common.VoicemailTranscript
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.rememberCacheFirst
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * #734: a call's own page, where a call row's Details action lands. Reads top
 * to bottom, like the web's call page: who called, what happened, the words,
 * then the facts, including why no phone rang (#721) and how it ended (#725).
 *
 * *Applying: Prioritize Intent. The words come first, because someone here is
 * usually here to read them.*
 */
@Composable
fun CallDetailScreen(
    graph: AppGraph,
    companyId: String,
    sessionId: String,
    modifier: Modifier = Modifier,
    onOpenConversation: (String) -> Unit = {},
    onOpenContact: (String) -> Unit = {},
) {
    val repo = remember(graph) { CallsRepository(graph.api) }
    var refreshKey by remember { mutableStateOf(0) }
    val state = rememberCacheFirst(
        cache = graph.storeCache,
        key = CacheKeys.call(companyId, sessionId),
        refreshKey = refreshKey,
    ) { repo.call(companyId, sessionId) }

    when (val current = state) {
        is LoadState.Loading -> CenteredLoading()
        is LoadState.Failed -> LoadError(current.message, onRetry = { refreshKey++ })
        is LoadState.Ready -> CallDetailBody(
            graph = graph,
            call = current.value,
            repo = repo,
            companyId = companyId,
            modifier = modifier,
            onOpenConversation = onOpenConversation,
            onOpenContact = onOpenContact,
        )
    }
}

@Composable
private fun CallDetailBody(
    graph: AppGraph,
    call: Call,
    repo: CallsRepository,
    companyId: String,
    modifier: Modifier,
    onOpenConversation: (String) -> Unit,
    onOpenContact: (String) -> Unit,
) {
    val who = callerDisplayName(call)
    val transcript = callTranscriptState(call)
    val locale = LocalAppLocale.current
    val routingReason = callRoutingReason(call.routing, locale)
    val endReason = callEndReason(call.ended_reason, locale)

    LazyColumn(
        modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 18.dp, end = 18.dp, top = 6.dp, bottom = 32.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        item {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                ScreenTitle(who)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        t(callOutcomeLineKey(call)) + " · ",
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Timestamp(
                        call.started_at,
                        style = TimestampFormat.Style.LONG,
                        fontSize = 13.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (call.conversation_id != null || call.contact_id != null) {
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    call.conversation_id?.let { id ->
                        OutlinedButton(
                            onClick = { onOpenConversation(id) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(t("shell.openConversation")) }
                    }
                    call.contact_id?.let { id ->
                        OutlinedButton(
                            onClick = { onOpenContact(id) },
                            modifier = Modifier.heightIn(min = 48.dp),
                        ) { Text(t("shell.viewContact")) }
                    }
                }
            }
        }
        // The words first: see the note on the screen.
        item {
            PaperCard(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        t("shell.voicemail"),
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                    )
                    if (transcript.muted) {
                        Text(
                            t(checkNotNull(transcript.key)),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    } else {
                        VoicemailTranscript(checkNotNull(transcript.text))
                    }
                    if (call.has_voicemail == true) {
                        VoicemailPlayerRow(
                            repo = repo,
                            companyId = companyId,
                            sessionId = call.call_session_id,
                            seconds = call.voicemail_seconds ?: 0,
                            transcriptShown = true,
                        )
                    }
                }
            }
        }
        item {
            PaperCard(Modifier.fillMaxWidth()) {
                val rows = buildList<Pair<String, @Composable () -> Unit>> {
                    add(
                        t("shell.directionLabel") to {
                            DetailValue(
                                t(
                                    if (call.direction == "outbound") {
                                        "shell.directionOutgoing"
                                    } else {
                                        "shell.directionIncoming"
                                    },
                                ),
                            )
                        },
                    )
                    call.caller_e164?.takeIf { it.isNotBlank() }?.let { number ->
                        add(t("shell.numberLabel") to { DetailValue(formatPhone(number)) })
                    }
                    call.answered_by_name?.takeIf { it.isNotBlank() }?.let { name ->
                        add(
                            t(if (call.direction == "outbound") "shell.placedBy" else "shell.answeredBy") to
                                { DetailValue(name) },
                        )
                    }
                    add(
                        t("shell.startedLabel") to {
                            Timestamp(call.started_at, style = TimestampFormat.Style.LONG, fontSize = 14.sp)
                        },
                    )
                    call.ended_at?.let { endedAt ->
                        add(
                            t("shell.endedLabel") to {
                                Timestamp(endedAt, style = TimestampFormat.Style.LONG, fontSize = 14.sp)
                            },
                        )
                    }
                    call.stir_attestation?.takeIf { it.isNotBlank() }?.let { attestation ->
                        add(
                            t("shell.callerVerified") to {
                                DetailValue(
                                    if (attestation == "A") {
                                        t("shell.callerVerifiedYes")
                                    } else {
                                        t("shell.callerVerifiedPartly", "attestation" to attestation)
                                    },
                                )
                            },
                        )
                    }
                    routingReason?.let { add(t("shell.whyNoPhoneRang") to { DetailValue(it) }) }
                    endReason?.let { add(t("shell.howItEnded") to { DetailValue(it) }) }
                }
                rows.forEachIndexed { index, (label, value) ->
                    if (index > 0) RowDivider()
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            label,
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(end = 16.dp),
                        )
                        value()
                    }
                }
            }
        }
        // #714: the same activity timeline a customer, a job and a thread show,
        // which for a call is its steps from ringing to hang-up (#725).
        item {
            Column {
                SectionHeader(t("activity.heading"))
                ActivityTimeline(
                    graph = graph,
                    companyId = companyId,
                    recordType = ActivityRecordType.CALL,
                    recordId = call.id,
                    onOpenConversation = { id, _ -> onOpenConversation(id) },
                    onOpenContact = onOpenContact,
                )
            }
        }
    }
}

@Composable
private fun DetailValue(text: String) {
    Text(text, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurface)
}
