package com.loonext.android.core.model

import kotlinx.serialization.Serializable

@Serializable
data class Member(
    val id: String,
    val user_id: String,
    val role: String,
    val deactivated_at: String? = null,
    val created_at: String,
    val display_name: String = "",
)

@Serializable
data class Invite(
    val id: String,
    val company_id: String,
    val email: String,
    val role: String,
    val invited_by: String,
    val expires_at: String,
    val accepted_at: String? = null,
    val revoked_at: String? = null,
    val created_at: String,
    /**
     * #521: why the inviter said they were adding this person, or null when
     * they said nothing, which is most invites. Written once, at invite time:
     * the words went out in an email somebody has already read, so there is no
     * edit path for them here or on the server.
     */
    val note: String? = null,
    /** POST /v1/invites only: false = send failed, fall back to Copy link. */
    val email_sent: Boolean? = null,
    /** GET /v1/invites/mine only: inviting company's name for the banner. */
    val company_name: String? = null,
)

/** POST /v1/invites/accept response (member row + company_id). */
@Serializable
data class AcceptedInvite(
    val id: String,
    val user_id: String,
    val role: String,
    val deactivated_at: String? = null,
    val created_at: String,
    val company_id: String,
)
