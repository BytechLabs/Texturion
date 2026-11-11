package com.loonext.android.features.settings

import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.model.TrashKind
import com.loonext.android.ui.common.formatPhone
import java.time.Duration
import java.time.Instant

/** Looks a catalogue key up: `say("trash.restore")`, `say("trash.daysLeftMany", mapOf("count" to "5"))`. */
internal typealias Say = (String, Map<String, String>) -> String

private val ONE_DAY: Duration = Duration.ofDays(1)

/**
 * #735: whole days until the nightly purge, rounded up, and 0 when less than a
 * day remains, so "1 day left" never means "gone in an hour". Mirrors web's
 * `daysLeft` in `lib/settings/trash-row.ts`.
 */
internal fun trashDaysLeft(purgeAfter: String, now: Instant = Instant.now()): Int {
    val at = runCatching { Instant.parse(purgeAfter) }.getOrNull() ?: return 0
    val remaining = Duration.between(now, at)
    if (remaining < ONE_DAY) return 0
    return ((remaining.toMillis() + ONE_DAY.toMillis() - 1) / ONE_DAY.toMillis()).toInt()
}

internal fun trashDaysLeftLabel(purgeAfter: String, say: Say, now: Instant = Instant.now()): String =
    when (val days = trashDaysLeft(purgeAfter, now)) {
        0 -> say("trash.daysLeftToday", emptyMap())
        1 -> say("trash.daysLeftOne", emptyMap())
        else -> say("trash.daysLeftMany", mapOf("count" to "$days"))
    }

/** What the item is: Conversation, Message, Note, Call or Voicemail. */
internal fun trashKindLabel(item: TrashItem, say: Say): String = when (item.kind) {
    TrashKind.CONVERSATION -> say("trash.kindConversation", emptyMap())
    TrashKind.MESSAGE ->
        if (item.message?.direction == "note") say("trash.kindNote", emptyMap())
        else say("trash.kindMessage", emptyMap())
    TrashKind.CALL -> say("trash.kindCall", emptyMap())
    TrashKind.VOICEMAIL -> say("trash.kindVoicemail", emptyMap())
    else -> item.kind
}

/** The customer, as a name when there is one and a number when there is not. */
internal fun trashWhoLabel(item: TrashItem, say: Say): String {
    val name: String?
    val phone: String?
    when (item.kind) {
        TrashKind.CONVERSATION -> { name = item.conversation?.contact_name; phone = item.conversation?.contact_phone }
        TrashKind.MESSAGE -> { name = item.message?.contact_name; phone = item.message?.contact_phone }
        TrashKind.CALL -> { name = item.call?.contact_name; phone = item.call?.contact_phone }
        else -> { name = item.voicemail?.contact_name; phone = item.voicemail?.contact_phone }
    }
    return name?.trim()?.takeIf { it.isNotEmpty() }
        ?: phone?.let { formatPhone(it) }
        ?: say("trash.unknownContact", emptyMap())
}

/** The second line: what is inside, in a few words. */
internal fun trashDetailLabel(item: TrashItem, say: Say): String = when (item.kind) {
    TrashKind.CONVERSATION -> {
        val count = item.conversation?.message_count ?: 0
        say(if (count == 1) "trash.messageCountOne" else "trash.messageCountMany", mapOf("count" to "$count"))
    }
    TrashKind.MESSAGE ->
        item.message?.snippet?.trim()?.takeIf { it.isNotEmpty() } ?: say("trash.noSnippet", emptyMap())
    TrashKind.CALL -> {
        val outcome = item.call?.outcome
        val base = when (outcome) {
            "missed" -> say("trash.callOutcomeMissed", emptyMap())
            "voicemail" -> say("trash.callOutcomeVoicemail", emptyMap())
            else -> say("trash.callOutcomeAnswered", emptyMap())
        }
        if (item.call?.has_voicemail == true && outcome != "voicemail") {
            "$base · ${say("trash.callWithVoicemail", emptyMap())}"
        } else {
            base
        }
    }
    TrashKind.VOICEMAIL -> {
        val seconds = item.voicemail?.voicemail_seconds
        if (seconds != null && seconds > 0) say("trash.voicemailLength", mapOf("seconds" to "$seconds"))
        else say("trash.kindVoicemail", emptyMap())
    }
    else -> ""
}

/** "Deleted 3:42 PM by you", or without the by-clause when somebody else deleted it. */
internal fun trashDeletedLine(item: TrashItem, meUserId: String, deletedAt: String, say: Say): String =
    if (item.deleted_by_user_id != null && item.deleted_by_user_id == meUserId) {
        say("trash.deletedByLine", mapOf("when" to deletedAt, "who" to say("trash.you", emptyMap())))
    } else {
        say("trash.deletedByUnknown", mapOf("when" to deletedAt))
    }

/** A row's identity: a call and its voicemail share one id, so the kind is part of it. */
internal fun trashKey(item: TrashItem): String = "${item.kind}:${item.id}"
