package com.loonext.android.core.realtime

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * #302 — Phoenix Presence, as a pure function of the frames.
 *
 * WHY THIS IS SEPARATE FROM [RealtimeClient]. The socket layer is hand-rolled
 * Phoenix over OkHttp and cannot be exercised on this machine, so the part that
 * can be got wrong quietly — parsing `presence_state` and `presence_diff` into
 * "who is on this thread" — lives here, where the JVM suite runs it. Same
 * reasoning as GalleryLogic.kt next door.
 *
 * THE WIRE FORMAT BELOW WAS OBSERVED, NOT GUESSED. It was captured off the
 * working web client's socket with two signed-in browsers on one conversation:
 *
 *   join     → config.presence = { key: <user_id>, enabled: true }   ← `enabled`
 *              is REQUIRED; without it the server accepts the join and silently
 *              sends no presence at all.
 *   track    → event "presence", payload
 *              { type: "presence", event: "track", payload: { …entry… } }
 *   state    ← event "presence_state", payload { <key>: { metas: [ {…} ] } }
 *              (an empty object when nobody is tracked yet)
 *   diff     ← event "presence_diff", payload { joins: {…}, leaves: {…} },
 *              each side shaped exactly like `presence_state`
 *
 * Every meta carries `phx_ref` plus whatever the client tracked. One key can
 * hold several metas — the same person on two devices — which is why the shared
 * rule collapses by user id rather than trusting the key to be unique.
 */

/** One tracked entry, matching the shared PresenceEntry contract. */
data class PresenceEntry(
    val userId: String,
    val displayName: String,
    val conversationId: String,
    val at: Long,
    val typing: Boolean,
)

/**
 * The presence map for one topic: key → the metas under it.
 *
 * Kept as the raw shape Phoenix sends rather than flattened on arrival, because
 * a `leaves` diff names the key and its departing metas, and reconciling that
 * against a flattened list means guessing which entry went.
 */
typealias PresenceMap = Map<String, List<PresenceEntry>>

private fun parseMeta(meta: JsonObject): PresenceEntry? {
    val userId = meta["user_id"]?.jsonPrimitive?.contentOrNullSafe() ?: return null
    val conversationId =
        meta["conversation_id"]?.jsonPrimitive?.contentOrNullSafe() ?: return null
    return PresenceEntry(
        userId = userId,
        displayName = meta["display_name"]?.jsonPrimitive?.contentOrNullSafe().orEmpty(),
        conversationId = conversationId,
        // A missing or unparseable timestamp reads as epoch, which the staleness
        // rule then discards. Dropping the entry outright would be the same
        // outcome by a less obvious route.
        at = meta["at"]?.jsonPrimitive?.longOrNull ?: 0L,
        typing = meta["typing"]?.jsonPrimitive?.booleanOrNull ?: false,
    )
}

private fun kotlinx.serialization.json.JsonPrimitive.contentOrNullSafe(): String? =
    runCatching { content }.getOrNull()?.takeIf { it.isNotEmpty() && it != "null" }

/** Parse one `{ key: { metas: [...] } }` object into the map shape. */
private fun parseKeyed(payload: JsonObject): PresenceMap {
    val out = LinkedHashMap<String, List<PresenceEntry>>()
    for ((key, value) in payload) {
        val metas = runCatching { value.jsonObject["metas"]?.jsonArray }.getOrNull()
        // A key whose metas are missing or unreadable is STILL a key that is
        // present. Recording it empty rather than skipping it keeps a later
        // `leaves` able to find and remove it — dropping it here would leave a
        // phantom that no diff can ever clear. It also keeps a malformed
        // payload looking like a malformed payload rather than like an absence.
        out[key] = metas
            ?.mapNotNull { runCatching { parseMeta(it.jsonObject) }.getOrNull() }
            ?: emptyList()
    }
    return out
}

/** `presence_state` replaces everything: it is the server's complete answer. */
fun applyPresenceState(payload: JsonObject): PresenceMap = parseKeyed(payload)

/**
 * `presence_diff` is additive-then-subtractive, and the ORDER matters.
 *
 * A rejoin arrives as a leave of the old ref and a join of the new one, and the
 * two can land in the same diff. Applying leaves last would delete the key that
 * the joins half just re-established — the person would blink out of the thread
 * every time their token refreshed.
 */
fun applyPresenceDiff(current: PresenceMap, payload: JsonObject): PresenceMap {
    val joins = runCatching { payload["joins"]?.jsonObject }.getOrNull()
    val leaves = runCatching { payload["leaves"]?.jsonObject }.getOrNull()

    val next = LinkedHashMap(current)
    if (leaves != null) {
        for (key in parseKeyed(leaves).keys) next.remove(key)
    }
    if (joins != null) {
        for ((key, entries) in parseKeyed(joins)) next[key] = entries
    }
    return next
}

/** Every entry across every key, for the shared staleness/label rule. */
fun presenceEntries(map: PresenceMap): List<PresenceEntry> = map.values.flatten()

/**
 * Who else is on this conversation — the Kotlin port of the shared
 * `presenceFor` (packages/shared/src/presence.ts). Kept in lockstep by
 * PresenceLogicTest, which asserts the same cases the TS suite does.
 */
fun viewersOf(
    entries: List<PresenceEntry>,
    conversationId: String,
    selfUserId: String,
    now: Long,
    healthy: Boolean,
): List<Viewer> {
    if (!healthy) return emptyList()

    val seen = LinkedHashMap<String, Pair<PresenceEntry, Boolean>>()
    for (entry in entries) {
        if (entry.conversationId != conversationId) continue
        if (entry.userId == selfUserId) continue
        val age = now - entry.at
        if (age < -PRESENCE_TTL_MS) continue
        if (age > PRESENCE_TTL_MS) continue

        val prior = seen[entry.userId]
        val typing = (entry.typing && age <= TYPING_TTL_MS) || (prior?.second ?: false)
        if (prior == null || entry.at > prior.first.at) {
            seen[entry.userId] = entry to typing
        } else if (typing != prior.second) {
            seen[entry.userId] = prior.first to typing
        }
    }

    return seen.values
        .sortedByDescending { it.first.at }
        .map { (entry, typing) ->
            Viewer(
                userId = entry.userId,
                displayName = entry.displayName.trim().ifEmpty { "A teammate" },
                typing = typing,
            )
        }
}

data class Viewer(val userId: String, val displayName: String, val typing: Boolean)

/** The one line the crew reads. Port of the shared `presenceLabel`. */
fun presenceLabel(viewers: List<Viewer>): String? {
    if (viewers.isEmpty()) return null

    val typing = viewers.filter { it.typing }
    when (typing.size) {
        0 -> Unit
        1 -> return "${typing[0].displayName} is replying…"
        2 -> return "${typing[0].displayName} and ${typing[1].displayName} are replying…"
        else -> return "${typing.size} people are replying…"
    }

    return when (viewers.size) {
        1 -> "${viewers[0].displayName} is also here"
        2 -> "${viewers[0].displayName} and ${viewers[1].displayName} are also here"
        else -> "${viewers.size} teammates are also here"
    }
}

/** Mirrors packages/shared/src/presence.ts. Kept in step by the parity test. */
const val PRESENCE_TTL_MS = 45_000L
const val PRESENCE_HEARTBEAT_MS = 15_000L
const val TYPING_TTL_MS = 6_000L
const val TYPING_THROTTLE_MS = 2_000L
