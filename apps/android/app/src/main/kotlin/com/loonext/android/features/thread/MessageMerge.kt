package com.loonext.android.features.thread

import com.loonext.android.core.model.Message

/**
 * How far along an outbound message is. A send only ever moves FORWARD:
 * queued (accepted by us) → sent (the carrier took it) → delivered/failed.
 *
 * `received` is the inbound resting state and shares the floor, since an
 * inbound message never transitions.
 */
private fun statusRank(status: String?): Int = when (status) {
    "sent" -> 1
    "delivered", "failed" -> 2
    else -> 0
}

/**
 * Keep whichever status is further along when the same message arrives twice.
 *
 * A page refetch and the realtime status broadcast race constantly, because the
 * send inserts the queued row and bumps the conversation in ONE transaction,
 * before the carrier is even called: the refetch that bump triggers reads the
 * row while it still says queued, and can land AFTER the broadcast that says
 * sent. Replacing the cached row wholesale walked the bubble backwards to
 * "Sending…" and left it there, because nothing refetches again and the
 * broadcast does not replay.
 *
 * Ported from the web client's `mergeMessage`, so all three clients agree about
 * what a message's state is.
 */
fun mergeMessage(existing: Message, incoming: Message): Message {
    val existingStatus = existing.status
    val incomingStatus = incoming.status
    // A note carries no status; there is nothing to move backwards.
    if (existingStatus == null || incomingStatus == null) return incoming
    if (statusRank(incomingStatus) >= statusRank(existingStatus)) return incoming
    // The incoming row is otherwise newer, so take it and keep only the status
    // it is behind on.
    return incoming.copy(
        status = existingStatus,
        error_code = existing.error_code,
        error_detail = existing.error_detail,
    )
}

/**
 * [mergeFirstPage] for MESSAGES: identical ordering, except a fresh row may not
 * move a message's status backwards.
 */
fun mergeMessagesFirstPage(existing: List<Message>, fresh: List<Message>): List<Message> {
    val existingById = existing.associateBy { it.id }
    val reconciled = fresh.map { row ->
        val prior = existingById[row.id]
        if (prior == null) row else mergeMessage(prior, row)
    }
    return mergeFirstPage(existing, reconciled, { it.id }, { it.created_at })
}
