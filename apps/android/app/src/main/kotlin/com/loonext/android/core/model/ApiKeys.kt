package com.loonext.android.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * #243 — workspace API keys.
 *
 * The token is not a property here, because it is not a field in any response
 * but the one that mints it. It exists outside the caller's own app exactly
 * once, in the 201, as [MintedApiKey.tokenOnce].
 */
@Serializable
data class ApiKey(
    val id: String,
    val name: String,
    /** The first twelve characters, so three keys can be told apart. */
    @SerialName("token_prefix") val tokenPrefix: String,
    val scopes: List<String> = emptyList(),
    @SerialName("created_at") val createdAt: String? = null,
    /** The field that makes switching one off safe: is anything still calling? */
    @SerialName("last_used_at") val lastUsedAt: String? = null,
    @SerialName("revoked_at") val revokedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
)

@Serializable
data class ApiKeyList(
    val keys: List<ApiKey> = emptyList(),
    val cap: Int = 0,
    /** Live keys only — revoking makes room, so the cap counts what is on. */
    val live: Int = 0,
)

@Serializable
data class MintedApiKey(
    val key: ApiKey,
    @SerialName("token_once") val tokenOnce: String,
)

@Serializable
data class CreateApiKeyBody(
    val name: String,
    val scopes: List<String>,
)
