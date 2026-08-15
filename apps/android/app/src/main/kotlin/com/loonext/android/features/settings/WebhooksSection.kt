package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CreateWebhookEndpointBody
import com.loonext.android.core.model.UpdateWebhookEndpointBody
import com.loonext.android.core.model.WebhookDelivery
import com.loonext.android.core.model.WebhookEndpoint
import com.loonext.android.core.model.WebhookEndpointList
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * #243 — Connections. Parity with the web's /settings/webhooks.
 *
 * # Who this is written for
 *
 * Two people open this screen: the owner who was told "connect it to the
 * scheduling app", and the developer they hired. Everything here is written for
 * the first, because the second can read anything and the first is the one who
 * gives up.
 *
 * # The decisions, and what they cost if reversed
 *
 * **The add form opens with every event already ticked.** An empty form is a
 * decision the person is not equipped to make yet — they do not know which of
 * eight events their tool needs, and eight empty boxes at the exact moment
 * somebody is trying to get started is where they stop. Subscribing to nothing
 * is a mistake rather than a preference, and the API refuses it.
 *
 * **The signing key is a card that stays on screen, not a snackbar.** It is
 * shown once in the product's whole life, and on a phone a snackbar is gone in
 * four seconds — often while the person is still switching to the app they
 * meant to paste it into. It says we cannot show it again in the same breath as
 * showing it, because learning that afterwards is learning it too late.
 *
 * **A stopped endpoint says what was LOST.** "Everything since then has been
 * missed" is the consequence; "disabled" is a state. And "paused by you" is
 * never confused with "we stopped sending" — one is their decision and the
 * other is ours, and a screen that blames somebody for our decision is worse
 * than one that says nothing.
 *
 * **Remove and rotate both confirm.** Both break something that is currently
 * working, and on a phone both sit under a thumb.
 *
 * *Applying: Smart Defaults, Zen of Clarity, Ethical Friction, Loss Aversion.*
 */
@Composable
fun WebhooksSection(scope: SettingsScope) {
    val locale = LocalAppLocale.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<WebhookEndpointList>>(LoadState.Loading) }
    var adding by remember { mutableStateOf(false) }
    // The one-time key, whether it came from a create or a rotation.
    var minted by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(scope.repo.webhookEndpoints(scope.companyId))
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            if (state is LoadState.Ready) scope.showMessage(cause.userMessage(locale))
            else state = LoadState.Failed(cause.userMessage(locale))
        }
    }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val endpoints = current.value.endpoints
            val cap = current.value.cap
            val atCap = cap > 0 && endpoints.size >= cap

            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    t("webhooks.intro"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                minted?.let { secret ->
                    SigningKeyCard(secret = secret, onDone = { minted = null })
                }

                if (endpoints.isEmpty() && !adding) {
                    SettingsCard(title = t("webhooks.empty")) {
                        Text(
                            t("webhooks.emptyBody"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { adding = true }) {
                            Text(t("webhooks.addAction"))
                        }
                    }
                } else {
                    endpoints.forEach { endpoint ->
                        EndpointCard(
                            scope = scope,
                            endpoint = endpoint,
                            onChanged = { refreshKey++ },
                            onRotated = { minted = it },
                        )
                    }

                    if (adding) {
                        AddEndpointCard(
                            scope = scope,
                            onCancel = { adding = false },
                            onCreated = { secret ->
                                adding = false
                                minted = secret
                                refreshKey++
                            },
                        )
                    } else {
                        OutlinedButton(
                            onClick = { adding = true },
                            enabled = !atCap,
                        ) {
                            Text(t("webhooks.addAction"))
                        }
                        if (atCap) {
                            Text(
                                t("webhooks.capReached").replace("{count}", cap.toString()),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                Text(
                    t("webhooks.developerNote"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** Which of the five things is true about an endpoint right now. */
private enum class Health { HEALTHY, NEVER, FAILING, PAUSED, STOPPED }

/**
 * Derived in ONE place rather than at each render site, because "paused by
 * you" and "we stopped sending" are the two a customer must never see
 * confused.
 */
private fun healthOf(endpoint: WebhookEndpoint): Health = when {
    !endpoint.active && endpoint.disabledReason != null -> Health.STOPPED
    !endpoint.active -> Health.PAUSED
    endpoint.consecutiveFailures > 0 -> Health.FAILING
    endpoint.lastSuccessAt != null -> Health.HEALTHY
    else -> Health.NEVER
}

private fun healthKey(health: Health): String = when (health) {
    Health.HEALTHY -> "webhooks.statusHealthy"
    Health.NEVER -> "webhooks.statusNeverUsed"
    Health.FAILING -> "webhooks.statusFailing"
    Health.PAUSED -> "webhooks.statusPaused"
    Health.STOPPED -> "webhooks.statusStopped"
}

/** The catalogue key for an event's human sentence. Mirrors the shared rule. */
private fun eventLabelKey(type: String): String {
    val camel = Regex("""\.(\w)""").replace(type) { it.groupValues[1].uppercase() }
    return "webhooks.event.$camel"
}

/** The eight subscribable events, in the order the API promises them. */
private val EVENT_TYPES = listOf(
    "message.received",
    "message.sent",
    "message.failed",
    "call.completed",
    "voicemail.received",
    "task.created",
    "task.completed",
    "contact.created",
)

@Composable
private fun SigningKeyCard(secret: String, onDone: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    SettingsCard(title = t("webhooks.secretTitle")) {
        Text(
            t("webhooks.secretBody"),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            secret,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                clipboard.setText(AnnotatedString(secret))
                copied = true
            }) {
                Text(if (copied) t("webhooks.secretCopied") else t("webhooks.secretCopy"))
            }
            TextButton(onClick = onDone) { Text(t("webhooks.secretDone")) }
        }
    }
}

@Composable
private fun AddEndpointCard(
    scope: SettingsScope,
    onCancel: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val locale = LocalAppLocale.current
    val coroutineScope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    // Smart Defaults: everything ticked. See the file header.
    var events by remember { mutableStateOf(EVENT_TYPES.toSet()) }
    var saving by remember { mutableStateOf(false) }

    // #228: composed OUTSIDE the coroutine, because `t` cannot be called from
    // one — a sentence decided in a callback has to be hoisted or it renders
    // its own key.
    val needOneEvent = t("webhooks.needOneEvent")

    SettingsCard(title = t("webhooks.addTitle")) {
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text(t("webhooks.urlLabel")) },
            supportingText = { Text(t("webhooks.urlHint")) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = description,
            onValueChange = { description = it },
            label = { Text(t("webhooks.nameLabel")) },
            placeholder = { Text(t("webhooks.namePlaceholder")) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Text(t("webhooks.eventsLabel"), style = MaterialTheme.typography.titleSmall)
        Text(
            t("webhooks.eventsHint"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        EVENT_TYPES.forEach { type ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Checkbox(
                    checked = events.contains(type),
                    onCheckedChange = { on ->
                        events = if (on) events + type else events - type
                    },
                )
                Text(t(eventLabelKey(type)), style = MaterialTheme.typography.bodyMedium)
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                enabled = !saving && url.isNotBlank(),
                onClick = {
                    if (events.isEmpty()) {
                        scope.showMessage(needOneEvent)
                        return@OutlinedButton
                    }
                    saving = true
                    coroutineScope.launch {
                        try {
                            val minted = scope.repo.createWebhookEndpoint(
                                scope.companyId,
                                CreateWebhookEndpointBody(
                                    url = url.trim(),
                                    // Ordered by the promise, not by tap order,
                                    // so two workspaces that picked the same
                                    // events store the same list.
                                    events = EVENT_TYPES.filter { events.contains(it) },
                                    description = description.trim().ifBlank { null },
                                ),
                            )
                            onCreated(minted.secretOnce)
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            // The API answers with a catalogue KEY for every
                            // address rule, so the reason is said in the
                            // reader's own language rather than as "invalid
                            // URL", which tells them nothing they can act on.
                            scope.showMessage(webhookErrorText(cause, locale))
                        } finally {
                            saving = false
                        }
                    }
                },
            ) {
                Text(if (saving) t("webhooks.savingAction") else t("webhooks.saveAction"))
            }
            TextButton(onClick = onCancel) { Text(t("webhooks.cancelAction")) }
        }
    }
}

/**
 * An API refusal, said in the reader's language when we recognise it.
 *
 * The route puts a catalogue key in the message for every address rule. A key
 * we do not have falls through to the ordinary error text rather than being
 * rendered raw — a screen showing `webhooks.urlError.notHttps` to a customer is
 * worse than one showing a generic failure.
 */
private fun webhookErrorText(cause: Exception, locale: String): String {
    val message = cause.userMessage(locale)
    if (!message.startsWith("webhooks.")) return message
    val translated = AppStrings.table(locale)[message]
    return translated ?: cause.userMessage(locale)
}

@Composable
private fun EndpointCard(
    scope: SettingsScope,
    endpoint: WebhookEndpoint,
    onChanged: () -> Unit,
    onRotated: (String) -> Unit,
) {
    val locale = LocalAppLocale.current
    val coroutineScope = rememberCoroutineScope()
    var confirmDelete by remember { mutableStateOf(false) }
    var confirmRotate by remember { mutableStateOf(false) }
    var showDeliveries by remember { mutableStateOf(false) }
    var deliveries by remember { mutableStateOf<List<WebhookDelivery>>(emptyList()) }
    var testing by remember { mutableStateOf(false) }

    val health = healthOf(endpoint)

    // Hoisted for the same reason as above: every one of these is decided
    // inside a coroutine or a callback, where `t` cannot run.
    val testOk = t("webhooks.testOk")
    val testUnreachable = t("webhooks.testUnreachable")
    val testTimeout = t("webhooks.testTimeout")
    val testRefused = t("webhooks.testRefused")

    SettingsCard(title = endpoint.description ?: endpoint.url) {
        if (endpoint.description != null) {
            Text(
                endpoint.url,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            androidx.compose.foundation.layout.Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(
                        when (health) {
                            Health.HEALTHY -> MaterialTheme.colorScheme.primary
                            Health.FAILING -> MaterialTheme.colorScheme.tertiary
                            Health.STOPPED -> MaterialTheme.colorScheme.error
                            else -> MaterialTheme.colorScheme.outlineVariant
                        },
                    ),
            )
            Text(t(healthKey(health)), style = MaterialTheme.typography.bodySmall)
            Text(
                t("webhooks.eventsCount").replace("{count}", endpoint.events.size.toString()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        // What it COST, not what state it is in.
        when (health) {
            Health.STOPPED -> Text(
                t("webhooks.stoppedBody"),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.error,
            )
            Health.FAILING -> Text(
                t("webhooks.failingBody")
                    .replace("{count}", endpoint.consecutiveFailures.toString()),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Health.HEALTHY -> endpoint.lastSuccessAt?.let { at ->
                Text(
                    t("webhooks.lastSuccess").replace("{when}", relativeTime(at)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            else -> Unit
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                enabled = !testing,
                onClick = {
                    testing = true
                    coroutineScope.launch {
                        try {
                            val result =
                                scope.repo.testWebhookEndpoint(scope.companyId, endpoint.id)
                            scope.showMessage(
                                when {
                                    result.ok -> testOk
                                    result.reason == "timeout" -> testTimeout
                                    result.reason == "unreachable" || result.status == null ->
                                        testUnreachable
                                    else -> testRefused.replace(
                                        "{status}",
                                        result.status.toString(),
                                    )
                                },
                            )
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(webhookErrorText(cause, locale))
                        } finally {
                            testing = false
                        }
                    }
                },
            ) {
                Text(if (testing) t("webhooks.testSending") else t("webhooks.testAction"))
            }

            TextButton(onClick = {
                coroutineScope.launch {
                    try {
                        scope.repo.updateWebhookEndpoint(
                            scope.companyId,
                            endpoint.id,
                            UpdateWebhookEndpointBody(active = !endpoint.active),
                        )
                        onChanged()
                    } catch (cause: CancellationException) {
                        throw cause
                    } catch (cause: Exception) {
                        scope.showMessage(webhookErrorText(cause, locale))
                    }
                }
            }) {
                Text(
                    if (endpoint.active) t("webhooks.pauseAction")
                    else t("webhooks.resumeAction"),
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick = {
                showDeliveries = !showDeliveries
                if (showDeliveries) {
                    coroutineScope.launch {
                        try {
                            deliveries = scope.repo
                                .webhookDeliveries(scope.companyId, endpoint.id)
                                .deliveries
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(webhookErrorText(cause, locale))
                        }
                    }
                }
            }) {
                Text(t("webhooks.deliveriesAction"))
            }
            TextButton(onClick = { confirmRotate = true }) {
                Text(t("webhooks.rotateAction"))
            }
            TextButton(onClick = { confirmDelete = true }) {
                Text(t("webhooks.deleteAction"))
            }
        }

        if (showDeliveries) {
            if (deliveries.isEmpty()) {
                Text(
                    t("webhooks.deliveriesEmpty"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                deliveries.forEachIndexed { index, delivery ->
                    if (index > 0) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    Column {
                        Text(
                            delivery.eventType,
                            style = MaterialTheme.typography.bodySmall.copy(
                                fontFamily = FontFamily.Monospace,
                            ),
                        )
                        Text(
                            t(deliveryStatusKey(delivery.status)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }

    // Ethical Friction: both of these break something that is working.
    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text(t("webhooks.deleteTitle")) },
            text = { Text(t("webhooks.deleteBody").replace("{url}", endpoint.url)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    coroutineScope.launch {
                        try {
                            scope.repo.deleteWebhookEndpoint(scope.companyId, endpoint.id)
                            onChanged()
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(webhookErrorText(cause, locale))
                        }
                    }
                }) { Text(t("webhooks.deleteConfirm")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = false }) {
                    Text(t("webhooks.keepIt"))
                }
            },
        )
    }

    if (confirmRotate) {
        AlertDialog(
            onDismissRequest = { confirmRotate = false },
            title = { Text(t("webhooks.rotateTitle")) },
            text = { Text(t("webhooks.rotateBody")) },
            confirmButton = {
                TextButton(onClick = {
                    confirmRotate = false
                    coroutineScope.launch {
                        try {
                            val minted = scope.repo
                                .rotateWebhookSecret(scope.companyId, endpoint.id)
                            onRotated(minted.secretOnce)
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(webhookErrorText(cause, locale))
                        }
                    }
                }) { Text(t("webhooks.rotateConfirm")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmRotate = false }) {
                    Text(t("webhooks.cancelAction"))
                }
            },
        )
    }
}

private fun deliveryStatusKey(status: String): String = when (status) {
    "succeeded" -> "webhooks.deliverySucceeded"
    "failed" -> "webhooks.deliveryFailed"
    "delivering" -> "webhooks.deliveryDelivering"
    else -> "webhooks.deliveryPending"
}
