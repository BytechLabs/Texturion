package com.loonext.android.features.inbox

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import com.loonext.android.AppGraph
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.formatPhone
import kotlinx.serialization.json.JsonPrimitive

/**
 * The global inbound-message toast (#165): while the app is open, a customer
 * text landing in any conversation the user is NOT looking at surfaces as a
 * one-line snackbar with a View action — the web's toast-outside-the-thread
 * parity. The realtime payload only routes; the line's content (who + what)
 * is refetched through the authed API, and the toast is suppressed when its
 * thread is on screen (the thread itself shows the bubble).
 *
 * Shell-hostable: the integrator mounts this ONCE above the tab bar
 * (alongside CallsOverlay) and passes the currently-open conversation id
 * plus the open-thread navigation:
 *
 *   InboundMessageToastHost(
 *       graph = graph,
 *       companyId = companyId,
 *       viewedConversationId = { openConversationId },
 *       onView = { conversationId -> openThread(conversationId) },
 *   )
 */
@Composable
fun InboundMessageToastHost(
    graph: AppGraph,
    companyId: String,
    viewedConversationId: () -> String?,
    onView: (conversationId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val repo = remember(graph) { MessagingRepository(graph.api) }
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(graph, companyId) {
        graph.realtime.events.collect { event ->
            val conversationId =
                (event.payload["conversation_id"] as? JsonPrimitive)?.content
            val direction = (event.payload["direction"] as? JsonPrimitive)?.content
            if (!shouldToastInbound(
                    eventName = event.event,
                    conversationId = conversationId,
                    direction = direction,
                    viewedConversationId = viewedConversationId(),
                )
            ) {
                return@collect
            }
            checkNotNull(conversationId) // shouldToastInbound guarantees it

            // ID-only payload → refetch who + what through the API. A fetch
            // failure just skips the toast — the push/badge paths still tell
            // the story, and a wrong guess would be worse than silence.
            val detail = runCatching { repo.detail(companyId, conversationId) }
                .getOrNull() ?: return@collect
            val newestInbound = detail.messages.data
                .firstOrNull { it.direction == MessageDirection.INBOUND }
                ?: return@collect

            // Re-check after the fetch: the user may have opened this thread
            // while the detail was in flight.
            if (viewedConversationId() == conversationId) return@collect

            val line = inboundToastLine(
                contactName = detail.contact.name
                    ?: formatPhone(detail.contact.phone_e164),
                body = newestInbound.body,
                hasAttachments = newestInbound.attachments.isNotEmpty(),
            )
            val result = snackbar.showSnackbar(
                message = line,
                actionLabel = "View",
                duration = SnackbarDuration.Short,
            )
            if (result == SnackbarResult.ActionPerformed) onView(conversationId)
        }
    }

    SnackbarHost(snackbar, modifier = modifier)
}
