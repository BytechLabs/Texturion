package com.loonext.android.core.model

import kotlinx.serialization.Serializable

/**
 * Contact rows. Detail + list share the shape; `opted_out` rides every read,
 * `last_activity_at` only on list rows (conversation activity, never edits).
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
    val last_activity_at: String? = null,
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
