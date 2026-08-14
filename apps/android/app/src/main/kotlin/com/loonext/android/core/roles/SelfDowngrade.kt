package com.loonext.android.core.roles

import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.model.MemberRole

/**
 * #538 — taking powers away from yourself, said out loud first.
 *
 * The hand-port of `packages/shared/src/self-downgrade.ts`.
 *
 * ## The trap
 *
 * An admin who sets their own role to member loses the ability to change roles in
 * the same stroke — which is the ability that would let them change it back.
 * Nothing asked, nothing warned, and the way out is to go and find the owner. In a
 * workspace whose owner is on a roof with no signal, that is a real afternoon lost
 * to a control that looked like a dropdown.
 *
 * ## Why this cannot be a rank comparison
 *
 * Roles here are capability SETS, not rungs (#315). A bookkeeper has billing that a
 * plain member does not, so "is this a downgrade" is a question about what is being
 * taken away rather than about which role sits higher — there is no higher.
 *
 * ## Why the capability table is repeated here
 *
 * Android has no capability model of its own; the server is the authority and the
 * clients have never needed one. Rather than build one for a single warning, the
 * sets sit here — and `SelfDowngradeTest` reads
 * `packages/shared/src/capabilities.ts` and fails if any role's set drifts, so this
 * copy cannot quietly disagree with the source about what a role costs.
 */
object SelfDowngrade {

    /** The field the server requires before it will take somebody's own access. */
    const val ACK = "confirm_losing_access"

    /**
     * What each capability means to somebody deciding whether to give it up.
     *
     * Written as things they DO. "team.manage" tells a developer what is being
     * revoked and tells an owner nothing.
     */
    private val PLAIN_KEYS = mapOf(
        "billing.manage" to "domain.capBilling",
        "settings.manage" to "domain.capSettings",
        "team.manage" to "domain.capTeam",
        "numbers.manage" to "domain.capNumbers",
        "history.read" to "domain.capHistory",
        "contacts.bulk" to "domain.capContactsBulk",
    )

    /** The capability set for each role. Kept in step with the shared module by test. */
    internal val CAPABILITIES: Map<String, List<String>> = mapOf(
        MemberRole.MEMBER to listOf(
            "workspace.access",
            "conversations.read",
            "conversations.send",
            "conversations.note",
        ),
        MemberRole.READ_ONLY to listOf("workspace.access", "conversations.read"),
        // Billing and NOT the history log. Getting this wrong by one entry is
        // exactly what the parity test caught on the first run — a hand-written
        // copy of somebody else's table is wrong until something checks it.
        MemberRole.BOOKKEEPER to listOf("workspace.access", "billing.manage"),
        MemberRole.ADMIN to listOf(
            "workspace.access",
            "conversations.read",
            "conversations.send",
            "conversations.note",
            "billing.manage",
            "settings.manage",
            "team.manage",
            "numbers.manage",
            "history.read",
            "contacts.bulk",
        ),
    )

    /**
     * The owner holds everything, so it is derived rather than listed.
     *
     * Spelling out an owner's set would be a fourth place to forget a new
     * capability, and the one role where a gap is silent — an owner never gets a
     * refusal that would reveal it.
     */
    private fun capabilitiesOf(role: String): List<String> =
        if (role == MemberRole.OWNER) {
            CAPABILITIES.values.flatten().distinct() + OWNER_ONLY
        } else {
            CAPABILITIES[role] ?: emptyList()
        }

    /** What only an owner can do. Named so the parity test can check it. */
    internal val OWNER_ONLY = listOf("workspace.own")

    /** What a member would lose by moving from one role to another. */
    fun capabilitiesLost(from: String, to: String): List<String> {
        val after = capabilitiesOf(to).toSet()
        return capabilitiesOf(from).filterNot { it in after }
    }

    /** Does this change take anything away? False for a promotion. */
    fun isDowngrade(from: String, to: String): Boolean =
        capabilitiesLost(from, to).isNotEmpty()

    /**
     * The one that cannot be undone by the person doing it.
     *
     * `team.manage` is the capability that changes roles, so losing it is the moment
     * somebody stops being able to reverse their own decision. Singled out because
     * it is the difference between "you will have less access" — which people accept
     * easily and correctly — and "you will not be able to put this back", which is
     * the part they would want to know.
     */
    fun losesRoleControl(from: String, to: String): Boolean =
        capabilitiesLost(from, to).contains("team.manage")

    /**
     * The sentence to show before somebody takes powers off themselves.
     *
     * Null when the change takes nothing away, so a caller can ask unconditionally
     * and get silence on a promotion.
     *
     * Names at most three things and then counts the rest: six revoked capabilities
     * listed in full reads as legal boilerplate and gets skipped, which defeats the
     * whole point of asking.
     */
    fun warning(from: String, to: String, locale: String? = null): String? {
        val lost = capabilitiesLost(from, to)
        if (lost.isEmpty()) return null
        fun say(key: String, vars: Map<String, String> = emptyMap()) =
            AppStrings.translate(locale, key, vars)

        val named = lost.mapNotNull { PLAIN_KEYS[it] }.map { key -> say(key) }
        val head = named.take(3)
        val rest = named.size - head.size
        val list = when {
            head.isEmpty() -> say("domain.selfDowngradeSomeOfWhat")
            head.size == 1 -> head[0]
            else -> say(
                "domain.selfDowngradeListPair",
                mapOf("first" to head.dropLast(1).joinToString(", "), "last" to head.last()),
            )
        }
        val scope = if (rest > 0) {
            say("domain.selfDowngradeMore", mapOf("list" to list, "count" to rest.toString()))
        } else {
            list
        }
        val undo = if (losesRoleControl(from, to)) say("domain.selfDowngradeUndo") else ""
        return say("domain.selfDowngradeWarning", mapOf("scope" to scope, "undo" to undo))
    }
}
