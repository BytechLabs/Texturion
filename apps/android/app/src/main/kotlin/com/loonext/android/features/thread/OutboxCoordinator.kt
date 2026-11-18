package com.loonext.android.features.thread

import android.util.Base64
import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.model.OutboundMedia
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow

data class OutboxDelivery(val row: QueuedSend, val message: Message)

class OutboxCoordinator(
    val store: Outbox,
    private val repository: MessagingRepository,
    private val activeUserId: suspend () -> String?,
    private val locale: suspend () -> String?,
    notice: suspend (QueuedSend) -> Unit = {},
) {
    private val delivered = MutableSharedFlow<OutboxDelivery>(extraBufferCapacity = 16)
    val deliveries = delivered.asSharedFlow()
    val rows get() = store.snapshots

    private val flusher = OutboxFlusher(
        outbox = store,
        currentLocale = locale,
        onBlocked = notice,
        send = ::send,
    )

    suspend fun flush(): FlushResult {
        val userId = activeUserId() ?: return FlushResult()
        return flusher.flush { row ->
            (row.ownerUserId == null || row.ownerUserId == userId) && activeUserId() == userId
        }
    }

    suspend fun enqueue(row: QueuedSend, photos: List<OutboxMediaBytes>): Boolean =
        row.ownerUserId != null && row.ownerUserId == activeUserId() && store.enqueue(row, photos)

    private suspend fun send(row: QueuedSend): SendOutcome {
        val media = row.media.mapNotNull { queued ->
            store.readMedia(row.localId, queued)?.let { bytes ->
                OutboundMedia(
                    content_type = queued.contentType,
                    base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                )
            }
        }
        if (media.size != row.media.size) return SendOutcome.Refused(outboxMediaLostMessage(locale()))

        return try {
            val message = repository.send(
                companyId = row.companyId,
                conversationId = row.conversationId,
                body = row.body,
                media = media.takeIf { it.isNotEmpty() },
                idempotencyKey = row.localId,
            )
            delivered.tryEmit(OutboxDelivery(row, message))
            SendOutcome.Sent
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (cause: Exception) {
            val code = (cause as? ApiException)?.code
            val message = cause.userMessage(locale() ?: MessageLocale.EN)
            if (code == ApiErrorCode.NETWORK || code == ApiErrorCode.UNAUTHORIZED ||
                code == ApiErrorCode.MFA_REQUIRED
            ) {
                SendOutcome.Unreachable(message)
            } else {
                SendOutcome.Refused(message)
            }
        }
    }
}
