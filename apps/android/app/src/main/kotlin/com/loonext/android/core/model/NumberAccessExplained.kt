package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/**
 * #348 — what one member reaches on every number, and WHY.
 *
 * Hand-port of `packages/shared/src/number-access-explained.ts`. The access
 * model has three interacting principal kinds and a precedence order, and all
 * of it was invisible: nothing showed an owner which numbers a member reaches,
 * at what level, or which rule decided it.
 *
 * The wording lives in shared and is ported here rather than reinvented,
 * because three clients describing one security rule three different ways is
 * the #437 failure on the surface where it would matter most.
 */
@Serializable
data class NumberAccessExplanation(
    val phone_number_id: String,
    val number_e164: String? = null,
    /** "text" | "note" | "none" */
    val level: String,
    /** user | role | all | no-match | unruled | role-override | not-a-member */
    val decided_by: String,
    /** The role a 'role' rule named. Null for every other kind. */
    val principal: String? = null,
)

/** GET /v1/numbers/access/explain/{userId} — owner/admin only. */
@Serializable
data class MemberNumberAccess(
    val user_id: String,
    val numbers: List<NumberAccessExplanation> = emptyList(),
)

/** What they can do, in the crew's words rather than the schema's. */
fun numberAccessLevelLabel(level: String): String = when (level) {
    "text" -> "Can text"
    "note" -> "Read and notes only"
    else -> "Hidden"
}

/**
 * Why, in one short clause naming the rule an owner would go and edit.
 *
 * The two that carry the most weight look alike and are not: `unruled` means
 * nobody has restricted this number, `no-match` means somebody did and left
 * this person out. Both leave the member un-named by any rule; only one is a
 * mistake, and confusing them is how an owner concludes the rules are broken.
 */
fun numberAccessReason(
    decidedBy: String,
    principal: String?,
    /**
     * #286: who is reading. An owner inspecting somebody else's access reads
     * "them"; a member asking about their own reads "you".
     *
     * A PARAMETER and not a second function, matching the shared TypeScript:
     * these clauses are the one place a security rule is put into words, and a
     * copy of them written for the member-facing screen is a copy that drifts.
     */
    self: Boolean = false,
): String = when (decidedBy) {
    "user" -> if (self) "A rule naming you" else "A rule naming them"
    "role" ->
        if (principal != null) "A rule for ${principal}s"
        else if (self) "A rule for your role" else "A rule for their role"
    "all" -> "A rule for everyone"
    "no-match" ->
        if (self) "This number has rules, and none of them include you"
        else "This number has rules, and none of them include them"
    "unruled" -> "Nobody has restricted this number"
    "role-override" ->
        if (principal == "owner") "Owners reach every number" else "Admins reach every number"
    else -> if (self) "You are no longer in this workspace" else "No longer in this workspace"
}

/**
 * #286 — what a MEMBER is owed when a number is missing from their app.
 *
 * The issue names the failure precisely: a new tech who can see one line and
 * not another reads the absence as the app being broken, and "silent absence
 * is the worse failure". This is the sentence under the list, and it is the
 * part that stops the reader concluding it is a bug and stops them asking the
 * owner one at a time.
 *
 * Null when there is nothing to explain: a member who reaches everything has
 * no absence to account for, and a paragraph reassuring them about a problem
 * they do not have is furniture.
 */
fun numberAccessSelfNote(rows: List<NumberAccessExplanation>): String? {
    val hidden = rows.count { it.level == "none" }
    val readOnly = rows.count { it.level == "note" }
    if (hidden == 0 && readOnly == 0) return null

    val parts = mutableListOf<String>()
    if (hidden > 0) {
        parts += "$hidden ${if (hidden == 1) "number is" else "numbers are"} hidden from you"
    }
    if (readOnly > 0) {
        parts += "$readOnly ${if (readOnly == 1) "is" else "are"} read-only"
    }
    return parts.joinToString(" and ") +
        ". That is deliberate — somebody set it up that way, and it is not " +
        "the app failing. Ask an owner or admin if you need more."
}

/** Anything short of full use is a restriction worth showing first. */
fun numberAccessIsRestricted(level: String): Boolean = level != "text"

/**
 * Restricted first, then by number.
 *
 * Somebody opening this screen is checking a suspicion, not reading a report,
 * and a list that opens with six unrestricted rows buries the one that answers
 * them. Sorted by number inside each group so comparing two members puts the
 * same numbers in the same places.
 */
fun List<NumberAccessExplanation>.sortedForOwner(): List<NumberAccessExplanation> =
    sortedWith(
        compareByDescending<NumberAccessExplanation> { numberAccessIsRestricted(it.level) }
            .thenBy { it.number_e164.orEmpty() },
    )
