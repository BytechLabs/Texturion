package com.loonext.android.features.thread

import com.loonext.android.features.contacts.Nanp
import kotlinx.serialization.Serializable

private val phoneRun = Regex("""(?:\+?[0-9]|\([0-9]{3}\))[0-9+(). \t-]*[0-9]""")
private val webAddress = Regex("""(?:https?://|www\.)\S+""", RegexOption.IGNORE_CASE)
private val attachedCharacter = Regex("""[\p{L}\p{N}_@/\\]""")

@Serializable
internal data class MessagePhone(val start: Int, val end: Int, val e164: String)

internal fun messagePhones(body: String): List<MessagePhone> {
    val addresses = webAddress.findAll(body).map { it.range }.toList()
    return phoneRun.findAll(body).mapNotNull { match ->
        val start = match.range.first
        val end = match.range.last + 1
        if (body.hasAttachedCharacter(start - 1) || body.hasAttachedCharacter(end)) return@mapNotNull null
        if (addresses.any { start <= it.last && end > it.first }) return@mapNotNull null
        val e164 = Nanp.normalize(match.value) ?: return@mapNotNull null
        MessagePhone(start, end, e164)
    }.toList()
}

private fun String.hasAttachedCharacter(index: Int): Boolean =
    getOrNull(index)?.let { attachedCharacter.matches(it.toString()) } == true
