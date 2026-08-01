package com.loonext.android.features.inbox

import com.loonext.android.core.model.Member
import com.loonext.android.core.model.Tag
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull

/**
 * #280 — saved views on Android.
 *
 * # This is a hand port, and the thing being ported is a CONTRACT
 *
 * `packages/shared/src/saved-views.ts` decides what a view may hold; four
 * things replay those filters and must agree. A drift here does not crash — it
 * produces a view that saves on the phone and opens something else on the web,
 * which is the exact failure the whole feature is judged on.
 *
 * So the allow-list below mirrors the TypeScript one key for key, and
 * `SavedViewsPortTest` asserts a positive case for each rather than only the
 * refusals: a port that rejects everything passes a refusal-only test suite.
 *
 * # A view stores the QUERY
 *
 * Never the result. Opening one replays its filters through the ordinary
 * conversations request, so #106 number access applies per viewer and a shared
 * view grants nothing. Nothing in this file reads a conversation.
 */

@Serializable
data class SavedView(
    val id: String,
    val surface: String,
    val name: String,
    val filters: JsonObject = JsonObject(emptyMap()),
    val position: Int = 0,
    /** True when the whole workspace sees it. */
    val shared: Boolean = false,
    @SerialName("created_by") val createdBy: String = "",
)

@Serializable
data class SavedViewDefaults(
    val conversations: String? = null,
    val tasks: String? = null,
)

@Serializable
data class SavedViewPage(
    val data: List<SavedView> = emptyList(),
    val defaults: SavedViewDefaults = SavedViewDefaults(),
)

@Serializable
data class SavedViewCounts(val counts: Map<String, Int> = emptyMap())

/** How many views one counts request will price. Mirrors the shared constant. */
const val SAVED_VIEW_COUNT_MAX_VIEWS = 12

/** Stop counting here and say "99+". */
const val SAVED_VIEW_COUNT_CEILING = 99

/** The longest a view name may be. */
const val SAVED_VIEW_NAME_MAX = 60

/** Render a bounded count the way every client must render it. */
fun formatViewCount(count: Int): String =
    if (count > SAVED_VIEW_COUNT_CEILING) "$SAVED_VIEW_COUNT_CEILING+" else count.toString()

private val UUID_RE =
    Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

private val CONVERSATION_STATUSES = setOf("new", "open", "waiting", "closed")
private val PINNED_VALUES = setOf("only", "exclude")
private val SNOOZED_VALUES = setOf("only", "exclude", "all")

/**
 * Keep only the conversation filters the list endpoint understands.
 *
 * Mirrors `sanitizeFilters` in shared, including the part that matters most:
 * an unknown or stale key is DROPPED rather than rejected, so a view written
 * before a filter was renamed still opens instead of failing on a screen the
 * person cannot repair.
 */
fun sanitizeConversationFilters(raw: JsonObject): JsonObject {
    val out = mutableMapOf<String, JsonElement>()
    for ((key, value) in raw) {
        val text = (value as? JsonPrimitive)?.contentOrNull
        val bool = (value as? JsonPrimitive)?.let { if (it.isString) null else it.booleanOrNull }
        val keep: Boolean = when (key) {
            "status" -> text != null && text in CONVERSATION_STATUSES
            "assigned_user_id" -> text != null && UUID_RE.matches(text)
            "tag_id" -> text != null && UUID_RE.matches(text)
            "assigned_to_me", "is_spam", "unread" -> bool != null
            "pinned" -> text != null && text in PINNED_VALUES
            "snoozed" -> text != null && text in SNOOZED_VALUES
            else -> false
        }
        if (keep) out[key] = value
    }
    // The two assignee filters contradict each other and the contradiction is
    // silent: whichever the request builder read last would win, differently on
    // different clients. The deliberate one takes the slot.
    if (out["assigned_to_me"]?.let { (it as? JsonPrimitive)?.booleanOrNull } == true) {
        out.remove("assigned_user_id")
    } else {
        out.remove("assigned_to_me")
    }
    return JsonObject(out)
}

private fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) it.contentOrNull else null }

private fun JsonObject.bool(key: String): Boolean =
    (this[key] as? JsonPrimitive)?.let { if (it.isString) null else it.booleanOrNull } == true

/**
 * The `assigned_user_id` a request should carry, given the view and who asks.
 *
 * "Mine" is relative on purpose: an owner sharing the crew's morning queue
 * means each person's own work, not the owner's. A stored id would make it one
 * specific human on everybody else's screen.
 */
fun resolveAssignee(filters: JsonObject, viewerUserId: String): String? =
    if (filters.bool("assigned_to_me")) viewerUserId else filters.str("assigned_user_id")

/** The inbox controller state a view describes. */
internal data class ViewSelection(
    val tab: InboxStatusTab,
    val assigneeUserId: String?,
    val assignedToMe: Boolean,
    val tagId: String?,
    val unreadOnly: Boolean,
    val spamOnly: Boolean,
    val snoozedOnly: Boolean,
)

/**
 * A view's stored filters as the inbox's own controls.
 *
 * The tab and the assignee are entangled here exactly as they are on the web:
 * "Mine" is a TAB rather than an assignee chip, so a view holding
 * `assigned_to_me` selects that tab instead of setting a chip nobody could see.
 */
internal fun viewToSelection(filters: JsonObject): ViewSelection {
    val clean = sanitizeConversationFilters(filters)
    val assignedToMe = clean.bool("assigned_to_me")
    val status = clean.str("status")
    val tab = when {
        assignedToMe -> InboxStatusTab.Mine
        status == "open" -> InboxStatusTab.Open
        status == "closed" -> InboxStatusTab.Closed
        else -> InboxStatusTab.All
    }
    return ViewSelection(
        tab = tab,
        assigneeUserId = if (assignedToMe) null else clean.str("assigned_user_id"),
        assignedToMe = assignedToMe,
        tagId = clean.str("tag_id"),
        unreadOnly = clean.bool("unread"),
        spamOnly = clean.bool("is_spam"),
        snoozedOnly = clean.str("snoozed") == "only",
    )
}

/** The inbox's current controls as a view would store them. */
internal fun selectionToView(selection: ViewSelection): JsonObject {
    val raw = buildJsonObject {
        when (selection.tab) {
            InboxStatusTab.Open -> put("status", JsonPrimitive("open"))
            InboxStatusTab.Closed -> put("status", JsonPrimitive("closed"))
            InboxStatusTab.Mine -> put("assigned_to_me", JsonPrimitive(true))
            InboxStatusTab.All -> Unit
        }
        selection.assigneeUserId?.let { put("assigned_user_id", JsonPrimitive(it)) }
        selection.tagId?.let { put("tag_id", JsonPrimitive(it)) }
        if (selection.unreadOnly) put("unread", JsonPrimitive(true))
        if (selection.spamOnly) put("is_spam", JsonPrimitive(true))
        if (selection.snoozedOnly) put("snoozed", JsonPrimitive("only"))
    }
    return sanitizeConversationFilters(raw)
}

/** Is this view the arrangement currently on screen? */
internal fun viewMatchesSelection(filters: JsonObject, selection: ViewSelection): Boolean =
    sanitizeConversationFilters(filters) == selectionToView(selection)

/**
 * A name for the view about to be saved, from what is filtered.
 *
 * The save sheet is never empty: typing a name is the whole friction between
 * arranging a useful screen and keeping it, and the person already said what
 * the view is by building it. Empty for the unfiltered list, because
 * "Everything" is a name to offer only if somebody deliberately saves it.
 */
internal fun suggestViewName(
    selection: ViewSelection,
    assignee: Member? = null,
    tag: Tag? = null,
): String {
    val parts = mutableListOf<String>()
    when (selection.tab) {
        InboxStatusTab.Open -> parts.add("Open")
        InboxStatusTab.Closed -> parts.add("Closed")
        InboxStatusTab.Mine -> parts.add("Mine")
        InboxStatusTab.All -> Unit
    }
    assignee?.let { if (selection.assigneeUserId != null) parts.add(it.display_name.ifBlank { "Assigned" }) }
    tag?.let { if (selection.tagId != null) parts.add(it.name) }
    if (selection.unreadOnly) parts.add("Unread")
    if (selection.spamOnly) parts.add("Spam")
    if (selection.snoozedOnly) parts.add("Snoozed")
    // A middot, not a dash: Law 6 bans em and en dashes in rendered copy and a
    // hyphen reads as part of a word.
    return parts.joinToString(" · ")
}
