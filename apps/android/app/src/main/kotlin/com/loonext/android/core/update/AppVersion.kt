package com.loonext.android.core.update

import kotlinx.serialization.Serializable

/**
 * #339 — comparing app versions. Hand-ported from
 * `packages/shared/src/app-version.ts`; `AppVersionTest.kt` asserts the same
 * table of cases the TypeScript test does.
 *
 * TWO RULES, both there to fail safe:
 *
 *   1. UNPARSEABLE IS NEVER NEWER. A version we cannot read is "unknown", and
 *      unknown always means "do not act". A lenient parser would let a build
 *      claim compliance it does not have.
 *   2. A MISSING POLICY DEMANDS NOTHING. The cost of a missed prompt is one
 *      person on last week's build; the cost of a false block is a plumber
 *      standing in a customer's basement with no phone.
 *
 * NOTE for anyone editing the regex: Kotlin's `\b` is a BACKSPACE character in
 * a normal string literal, not a word boundary. This pattern uses neither, but
 * that trap has bitten this repo before — keep patterns in raw strings.
 */

private val VERSION_PATTERN = Regex("""^[0-9]{1,4}(\.[0-9]{1,4}){0,3}$""")

/**
 * A version as four comparable integers, or null when it is not a version.
 *
 * Padded to four so "2" and "2.0.0.0" are one build, and compared segment-wise
 * so 1.10.0 outranks 1.9.0 — which a string compare gets backwards.
 */
fun versionKey(version: String?): IntArray? {
    if (version.isNullOrEmpty() || !VERSION_PATTERN.matches(version)) return null
    val parts = version.split(".").map { it.toIntOrNull() ?: return null }
    return IntArray(4) { index -> parts.getOrNull(index) ?: 0 }
}

/**
 * Is [version] strictly older than [floor]?
 *
 * False whenever either side is unreadable. That is the safety property: a
 * parse failure can never lock somebody out.
 */
fun isOlderThan(version: String?, floor: String?): Boolean {
    val a = versionKey(version) ?: return false
    val b = versionKey(floor) ?: return false
    for (i in 0 until 4) {
        if (a[i] != b[i]) return a[i] < b[i]
    }
    return false
}

/** The policy as the public GET /app-release returns it. */
@Serializable
data class AppReleasePolicy(
    val platform: String = "android",
    val recommended_version: String? = null,
    val minimum_version: String? = null,
    val message: String? = null,
    val update_url: String? = null,
)

/**
 * What this build should do about itself.
 *
 * NONE  — nothing to say, and the overwhelmingly common answer.
 * SOFT  — an update exists and is worth having. Dismissible, never blocking.
 * BLOCK — below the floor. D71 reserves this for security or genuine
 *         incompatibility, because being locked out is worse than most bugs.
 */
enum class UpdateRequirement { NONE, SOFT, BLOCK }

/**
 * Decide once, the same way web and iOS decide.
 *
 * Every uncertainty — no policy, no version, an unreadable version on either
 * side — resolves to NONE, the answer that leaves the person working.
 */
fun updateRequirement(current: String?, policy: AppReleasePolicy?): UpdateRequirement {
    if (policy == null) return UpdateRequirement.NONE
    // A build that does not know its own version cannot be judged behind.
    // Blocking it would turn our build mistake into the customer's outage.
    if (versionKey(current) == null) return UpdateRequirement.NONE

    if (isOlderThan(current, policy.minimum_version)) return UpdateRequirement.BLOCK
    if (isOlderThan(current, policy.recommended_version)) return UpdateRequirement.SOFT
    return UpdateRequirement.NONE
}
