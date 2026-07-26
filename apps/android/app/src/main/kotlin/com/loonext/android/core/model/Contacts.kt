package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/** The customer texted STOP and our webhook saw it: a block only they can lift. */
const val OPT_OUT_SOURCE_STOP = "stop_keyword"

/**
 * #331: the same block, learned afterwards — Telnyx refused a send with 40300,
 * or the nightly reconciliation found the number on their list and not ours.
 * The customer still said stop; we just were not told at the time.
 */
const val OPT_OUT_SOURCE_CARRIER = "carrier"

/**
 * Whether this opt-out is enforced by the carrier, and so cannot be undone
 * from in here whatever the screen offers. A function rather than a comparison
 * because there are now two such sources and every site that named one would
 * quietly start offering a revoke the server answers with a 409.
 */
fun isCarrierEnforcedOptOut(source: String?): Boolean =
    source == OPT_OUT_SOURCE_STOP || source == OPT_OUT_SOURCE_CARRIER

/**
 * Contact rows. Detail + list share the shape; `opted_out` rides every read,
 * `last_activity_at` only on list rows (conversation activity, never edits).
 *
 * #191 attribution: the actor ids plus their server-resolved company-member
 * display names ride the detail read. Contacts that predate attribution carry
 * null actors (no backfill lie) — the UI shows the line only when a name
 * resolves. Nullable-with-default so older payloads still decode.
 */
@Serializable
data class Contact(
    val id: String,
    val phone_e164: String,
    val name: String? = null,
    val address: String? = null,
    val notes: String? = null,
    val consent_source: String? = null,
    val consent_at: String? = null,
    val consent_attested_by: String? = null,
    val deleted_at: String? = null,
    val created_at: String,
    val updated_at: String,
    val opted_out: Boolean = false,
    /**
     * Which kind of opt-out this is, because only some of them can be undone
     * from inside the app. "stop_keyword" and "carrier" are both CARRIER
     * blocks: clearing our record would not clear theirs, so every send would
     * still be rejected. Ask [isCarrierEnforcedOptOut] rather than comparing
     * to one of them. "manual" and "import" are records someone in the office
     * made, with no carrier involved. Null when not opted out.
     */
    val opt_out_source: String? = null,
    val last_activity_at: String? = null,
    val created_by_user_id: String? = null,
    val created_by_name: String? = null,
    val updated_by_user_id: String? = null,
    val updated_by_name: String? = null,
)

@Serializable
data class OptOut(
    val id: String,
    val phone_e164: String,
    val source: String,
    val created_at: String,
    val revoked_at: String? = null,
)

/** POST /v1/contacts/import + import-vcard response. */
@Serializable
data class ImportResult(
    val imported: Int,
    val updated: Int,
    val skipped: Int,
    val errors: List<ImportRowError> = emptyList(),
) {
    @Serializable
    data class ImportRowError(val row: Int, val reason: String)
}
