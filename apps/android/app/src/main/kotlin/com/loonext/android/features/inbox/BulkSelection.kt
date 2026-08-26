package com.loonext.android.features.inbox

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.BulkConversationsResult
import com.loonext.android.core.model.MessageLocale
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/**
 * #275 — what "selected" means. The Kotlin twin of
 * `apps/web/src/lib/inbox/bulk-selection.ts`, kept pure so both clients can be
 * held to the same assertions.
 *
 * THE TRAP THIS EXISTS TO AVOID. The obvious implementation holds a set of ids
 * and, when the user asks for everything, fills it with the ids it happens to
 * have paged in. The inbox is cursor-paged, so that set is 25 rows out of 340 —
 * and the bar then says "select all" while acting on the page. #275 names it:
 * *selecting only the loaded page while implying more is a trap.*
 *
 * So there are two DIFFERENT kinds of selection and they are not interchangeable:
 *
 *   [Ids]    the user pointed at rows. We know exactly which, and how many.
 *   [Filter] the user asked for everything matching what they are looking at. We
 *            do NOT know how many, because the server has not counted them yet,
 *            and this file refuses to guess. The count comes back as `matched`.
 */
sealed interface BulkSelection {
    data class Ids(val ids: Set<String>) : BulkSelection
    data object Filter : BulkSelection

    companion object {
        val EMPTY: BulkSelection = Ids(emptySet())
    }
}

fun BulkSelection.isEmpty(): Boolean = this is BulkSelection.Ids && ids.isEmpty()

/** True when this row should render as checked. */
fun BulkSelection.isRowSelected(conversationId: String): Boolean = when (this) {
    // In filter mode every row is included by definition — including rows that
    // page in later.
    is BulkSelection.Filter -> true
    is BulkSelection.Ids -> conversationId in ids
}

/**
 * Toggle one row.
 *
 * Toggling while in filter mode DROPS OUT of filter mode, keeping the loaded rows
 * minus the one just unticked. Anything else would be a lie: the user has said
 * "not that one" about a set we cannot enumerate, so it cannot be honoured as an
 * exclusion — and ignoring the untick would leave a visibly unchecked row inside
 * the selection.
 */
fun BulkSelection.toggleRow(
    conversationId: String,
    loadedIds: List<String>,
): BulkSelection = when (this) {
    is BulkSelection.Filter -> BulkSelection.Ids(loadedIds.toSet() - conversationId)
    is BulkSelection.Ids ->
        BulkSelection.Ids(if (conversationId in ids) ids - conversationId else ids + conversationId)
}

/** Tick every loaded row. Claims nothing about rows not yet fetched. */
fun selectLoaded(loadedIds: List<String>): BulkSelection =
    BulkSelection.Ids(loadedIds.toSet())

/**
 * Whether to offer the escalation to "everything matching".
 *
 * Only once every loaded row is ticked AND there is more to fetch. Offering it
 * when everything is already loaded would be an escalation to the same set,
 * phrased as if it were bigger.
 */
fun BulkSelection.canEscalate(loadedIds: List<String>, hasMore: Boolean): Boolean {
    if (this is BulkSelection.Filter) return false
    if (loadedIds.isEmpty() || !hasMore) return false
    val selected = (this as BulkSelection.Ids).ids
    return loadedIds.all { it in selected }
}

/**
 * The bar's label. NEVER invents a total.
 *
 * Filter mode deliberately carries no number: the server counts the set when it
 * runs the action, and until then the honest phrasing is the one that does not
 * commit to a figure.
 *
 * #228: the two sentences live in `CommonStrings` rather than the inbox's own
 * section because the TASK list reads them through this same function, and one
 * sentence kept in two places is how two surfaces come to disagree about the
 * same number. [locale] is defaulted to English so a caller that has no reader
 * to hand still compiles; the bulk bars pass `LocalAppLocale.current`.
 */
fun BulkSelection.label(locale: String = MessageLocale.EN): String = when (this) {
    is BulkSelection.Filter ->
        AppStrings.translate(locale, "common.bulkSelectedAllMatching")

    is BulkSelection.Ids ->
        AppStrings.translate(
            locale,
            "common.bulkSelectedCount",
            mapOf("count" to "${ids.size}"),
        )
}

/** The ids to send, or null when the server should resolve the filter itself. */
fun BulkSelection.idsOrNull(): List<String>? = when (this) {
    is BulkSelection.Filter -> null
    is BulkSelection.Ids -> ids.toList()
}

/**
 * The sentence shown after an action ran, from what the server actually did.
 *
 * Built from the RESPONSE, never the selection: those two numbers differ whenever
 * a row was on a denied number, already gone, or past the cap, and that
 * difference is exactly what #275 says must not be swallowed.
 */
fun bulkResultMessage(
    verb: String,
    verbMany: String? = null,
    applied: Int,
    failed: Int,
    matched: Int,
    capped: Boolean,
    /** #478: what was acted on. Defaulted so every existing call is unchanged. */
    nounOne: String? = null,
    nounMany: String? = null,
    locale: String = MessageLocale.EN,
): String {
    val one = nounOne ?: AppStrings.translate(locale, "inbox.bulkNounOne")
    val many = nounMany ?: AppStrings.translate(locale, "inbox.bulkNounMany")
    val thing = if (applied == 1) one else many
    val chosenVerb = if (applied == 1) verb else (verbMany ?: verb)
    val message = StringBuilder(
        AppStrings.translate(
            locale,
            "inbox.bulkResultApplied",
            mapOf(
                "verb" to chosenVerb,
                "count" to "$applied",
                "thing" to thing,
            ),
        ),
    )
    // The cap is where "it worked" and "it finished" are different answers, so
    // the remainder is named rather than left to be discovered.
    if (capped && matched > applied) {
        message.append(
            AppStrings.translate(
                locale,
                "inbox.bulkResultCapped",
                mapOf("count" to "${matched - applied}"),
            ),
        )
    }
    if (failed > 0) {
        message.append(
            AppStrings.translate(
                locale,
                if (failed == 1) "inbox.bulkResultFailedOne" else "inbox.bulkResultFailedMany",
                mapOf("count" to "$failed"),
            ),
        )
    }
    return message.toString()
}

/**
 * #275 — one group of the undo plan: the rows that shared a prior value, and the
 * call that puts them back.
 */
data class BulkUndoGroup(
    val action: String,
    val ids: List<String>,
    val targetStatus: String? = null,
    val targetSpam: Boolean? = null,
    val targetUserId: String? = null,
    val unassign: Boolean = false,
)

/**
 * Turn a bulk result into the calls that reverse it, GROUPED by prior value.
 *
 * The web twin is `undoBulkCalls` in `lib/inbox/bulk-selection.ts`; same rule,
 * same grouping. Undoing "close 300 threads that were a mix of new, open and
 * waiting" is three calls rather than three hundred, and every row lands back on
 * the status it ACTUALLY had — not a uniform "open", which would quietly lose the
 * fact that nobody had replied to some of them yet.
 *
 * Returns null when there is nothing to reverse: `mark_read` records no prior
 * state, because "unread" is the absence of a read receipt.
 *
 * `previous` is read defensively. It is server JSON, and a client that crashed on
 * an unexpected shape would take the whole inbox down over an undo button.
 */
fun bulkUndoPlan(result: BulkConversationsResult): List<BulkUndoGroup>? {
    if (result.applied.isEmpty()) return null
    val groups = LinkedHashMap<String, MutableList<String>>()
    val specs = LinkedHashMap<String, BulkUndoGroup>()

    for (row in result.applied) {
        val previous = row.previous
        val spec: BulkUndoGroup? = when {
            previous.containsKey("status") -> {
                val status = (previous["status"] as? JsonPrimitive)?.contentOrNull
                if (status == null) null
                else BulkUndoGroup("set_status", emptyList(), targetStatus = status)
            }
            previous.containsKey("assigned_user_id") -> {
                val userId = (previous["assigned_user_id"] as? JsonPrimitive)?.contentOrNull
                BulkUndoGroup(
                    "assign",
                    emptyList(),
                    targetUserId = userId,
                    // A null prior assignee means the row was unassigned, and the
                    // server needs that said explicitly rather than inferred from a
                    // missing field.
                    unassign = userId == null,
                )
            }
            previous.containsKey("is_spam") -> {
                val wasSpam = (previous["is_spam"] as? JsonPrimitive)?.booleanOrNull
                if (wasSpam == null) null
                else BulkUndoGroup("set_spam", emptyList(), targetSpam = wasSpam)
            }
            previous.containsKey("had_tag") -> {
                // Undoing an add removes only the rows that did NOT already carry
                // the tag; undoing a remove restores only the ones that DID.
                // Otherwise the undo strips a tag somebody applied by hand months
                // ago — a bulk action destroying data it never created.
                val hadTag = (previous["had_tag"] as? JsonPrimitive)?.booleanOrNull ?: false
                when {
                    result.action == "add_tag" && hadTag -> null
                    result.action == "remove_tag" && !hadTag -> null
                    else -> BulkUndoGroup(
                        if (result.action == "add_tag") "remove_tag" else "add_tag",
                        emptyList(),
                    )
                }
            }
            else -> null
        }
        if (spec == null) continue
        val key = "${spec.action}|${spec.targetStatus}|${spec.targetSpam}|" +
            "${spec.targetUserId}|${spec.unassign}"
        specs.putIfAbsent(key, spec)
        groups.getOrPut(key) { mutableListOf() }.add(row.id)
    }

    if (groups.isEmpty()) return null
    return groups.map { (key, ids) -> specs.getValue(key).copy(ids = ids) }
}
