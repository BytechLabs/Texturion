package com.loonext.android.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * #243 — outbound webhook endpoints.
 *
 * The signing secret is not a field here, because it is not a field in any
 * list response. It arrives exactly twice in the product's whole life — when an
 * endpoint is created and when its key is rotated — and both of those answer
 * with [MintedWebhookSecret], whose field is named `secret_once` so a caller
 * storing the response wholesale is at least storing something that says what
 * it is.
 */
@Serializable
data class WebhookEndpoint(
    val id: String,
    val url: String,
    val description: String? = null,
    val events: List<String> = emptyList(),
    val active: Boolean = true,
    /** A catalogue KEY when WE turned it off, so this phone can translate it. */
    @SerialName("disabled_reason") val disabledReason: String? = null,
    @SerialName("disabled_at") val disabledAt: String? = null,
    @SerialName("consecutive_failures") val consecutiveFailures: Int = 0,
    @SerialName("last_success_at") val lastSuccessAt: String? = null,
    @SerialName("last_failure_at") val lastFailureAt: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
)

@Serializable
data class WebhookEndpointList(
    val endpoints: List<WebhookEndpoint> = emptyList(),
    val cap: Int = 0,
)

/** What PATCH answers: the row as it now is, wrapped. */
@Serializable
data class WebhookEndpointEnvelope(
    val endpoint: WebhookEndpoint,
)

@Serializable
data class MintedWebhookSecret(
    val endpoint: WebhookEndpoint,
    @SerialName("secret_once") val secretOnce: String,
)

@Serializable
data class WebhookDelivery(
    val id: String,
    @SerialName("event_type") val eventType: String,
    val status: String,
    val attempts: Int = 0,
    @SerialName("response_status") val responseStatus: Int? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("delivered_at") val deliveredAt: String? = null,
)

@Serializable
data class WebhookDeliveryList(
    val deliveries: List<WebhookDelivery> = emptyList(),
)

@Serializable
data class CreateWebhookEndpointBody(
    val url: String,
    val events: List<String>,
    val description: String? = null,
)

@Serializable
data class UpdateWebhookEndpointBody(
    val url: String? = null,
    val events: List<String>? = null,
    val description: String? = null,
    val active: Boolean? = null,
)

/**
 * What the far end said about a test ping.
 *
 * A refusal is a SUCCESSFUL test — the person pressed the button to find out,
 * and both answers are the button working — so the route answers 200 either
 * way and the difference is carried here.
 */
@Serializable
data class WebhookTestResult(
    val ok: Boolean,
    val status: Int? = null,
    val reason: String? = null,
)
