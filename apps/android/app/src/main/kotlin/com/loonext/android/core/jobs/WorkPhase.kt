package com.loonext.android.core.jobs

/**
 * #294 — before and after, the one classification the trade actually uses.
 *
 * The hand-port of `packages/shared/src/work-phase.ts`.
 *
 * ## Where it lives, and why that is not an implementation detail
 *
 * D28 decided attachments enter through exactly two doors — a text, or a note — and
 * that a task's files are a DERIVED view over those, never a third upload path. So
 * "mark this photo as an after" cannot be a property of the photo without inventing
 * the ingress D28 removed.
 *
 * It is a property of the NOTE instead. A note is already the link between a set of
 * files and a job: it has an author, a moment, and a task. A tech does not photograph
 * one thing before and a different thing after — they take a handful when they arrive
 * and a handful when they finish, and each handful arrives together on one note.
 *
 * ## Why grouping and attribution come free
 *
 * Once the note carries the label, a job's photo set groups by note, orders by the
 * note's time, and attributes to the note's author with nothing further stored.
 *
 * ## Why the order is chronological rather than before-then-after
 *
 * A job record should read as what happened, in the order it happened. That puts the
 * befores first anyway, because that is when they were taken — and when somebody
 * mislabels one, the timeline stays honest instead of quietly reordering the day to
 * match the label.
 */
object WorkPhase {

    const val BEFORE = "before"
    const val AFTER = "after"

    /** The two labels, in the order they appear on a job. */
    val ALL = listOf(BEFORE, AFTER)

    /** What each is called on screen. */
    fun label(phase: String): String = when (phase) {
        BEFORE -> "Before"
        AFTER -> "After"
        else -> phase
    }

    /**
     * The choice offered when there is no label yet.
     *
     * Named rather than "None", because most notes are neither: a note saying the
     * part is on order is not an unlabelled before. Offering "None" invites a tech to
     * think they have failed to fill something in.
     */
    const val UNSET_LABEL = "Not a before or after"

    /** One line under the control, for somebody who has never seen it. */
    const val HINT =
        "Marks these photos as how it looked when you arrived, or how you left it."

    fun isPhase(value: String?): Boolean = value == BEFORE || value == AFTER
}

/**
 * The shape the grouping needs, so the rule does not depend on one screen's model.
 */
interface JobPhotoLike {
    val id: String
    /** The note it arrived on. Null for the customer's own texted media. */
    val noteId: String?
    val workPhase: String?
    /** Who added it. Null when the customer sent it. */
    val addedByUserId: String?
    val createdAt: String
}

/** A set of files that arrived together, at one moment, from one person. */
data class JobPhotoGroup<T : JobPhotoLike>(
    /**
     * The note they came in on, or null for the customer's own texted media. Also the
     * group's identity: two notes written in the same second are still two visits'
     * worth of photos and must not merge.
     */
    val noteId: String?,
    val workPhase: String?,
    val addedByUserId: String?,
    /** The earliest item in the group — what the group is ordered by. */
    val at: String,
    val items: List<T>,
)

/**
 * Group a task's derived files into what a person would call visits.
 *
 * Everything the customer texted lands in ONE group with a null note, because it did
 * not arrive in visits and pretending otherwise would invent structure that is not
 * there. Everything else groups by the note it arrived on.
 *
 * Stable: items keep their relative order inside a group, groups are ordered by their
 * earliest item, and ties break on the group key so two notes written in the same
 * second do not swap places between frames.
 */
fun <T : JobPhotoLike> groupJobPhotos(items: List<T>): List<JobPhotoGroup<T>> {
    val order = mutableListOf<String>()
    val byKey = LinkedHashMap<String, MutableList<T>>()
    for (item in items) {
        val key = item.noteId ?: ""
        if (byKey[key] == null) {
            byKey[key] = mutableListOf()
            order += key
        }
        byKey.getValue(key) += item
    }
    return order
        .map { key ->
            val group = byKey.getValue(key)
            val head = group.first()
            JobPhotoGroup(
                noteId = head.noteId,
                workPhase = head.workPhase,
                addedByUserId = head.addedByUserId,
                // The group's time is its EARLIEST file, so a slow second upload does
                // not move a visit later in the day than it happened.
                at = group.minOf { it.createdAt },
                items = group,
            )
        }
        .sortedWith(compareBy({ it.at }, { it.noteId ?: "" }))
}

/**
 * The one-line summary of a job's photo set: "3 before, 5 after".
 *
 * Null when there is nothing labelled, so a caller renders no summary at all rather
 * than "0 before, 0 after" — which reads as a broken count rather than as a job
 * whose photos nobody classified.
 */
fun jobPhaseSummary(items: List<JobPhotoLike>): String? {
    val before = items.count { it.workPhase == WorkPhase.BEFORE }
    val after = items.count { it.workPhase == WorkPhase.AFTER }
    if (before == 0 && after == 0) return null
    return listOfNotNull(
        if (before > 0) "$before before" else null,
        if (after > 0) "$after after" else null,
    ).joinToString(", ")
}
