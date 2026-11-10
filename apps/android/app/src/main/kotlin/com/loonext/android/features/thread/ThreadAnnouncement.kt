package com.loonext.android.features.thread

import com.loonext.android.core.model.Message
import com.loonext.android.core.model.MessageDirection
import com.loonext.android.core.model.MessageStatus

/** What a screen reader should say about a change in a conversation's messages. */
sealed interface ThreadAnnouncement {
    /** A customer's text arrived while the thread was open. */
    data class Incoming(val body: String) : ThreadAnnouncement

    /** One of ours came back undelivered. */
    data object Failed : ThreadAnnouncement
}

/**
 * The one thing worth interrupting a reader for between two reads of the same thread.
 *
 * The first read is the baseline and announces nothing: opening a thread is not news.
 * A failed send outranks an arrival, because the arrival is still on screen to be
 * found and a failure is the one change a reader cannot see happen.
 */
fun threadAnnouncement(before: List<Message>?, after: List<Message>): ThreadAnnouncement? {
    if (before == null) return null
    val known = before.associateBy { it.id }
    val failed = after.any { message ->
        message.direction == MessageDirection.OUTBOUND &&
            message.status == MessageStatus.FAILED &&
            known[message.id]?.status != MessageStatus.FAILED
    }
    if (failed) return ThreadAnnouncement.Failed
    val arrived = after.lastOrNull {
        it.direction == MessageDirection.INBOUND && it.id !in known
    }
    return arrived?.let { ThreadAnnouncement.Incoming(it.body) }
}
