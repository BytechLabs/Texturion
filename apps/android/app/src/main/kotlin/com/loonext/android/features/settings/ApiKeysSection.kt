package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.ApiKey
import com.loonext.android.core.model.ApiKeyList
import com.loonext.android.core.model.CreateApiKeyBody
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * #243 — API keys. Parity with the web's /settings/api-keys.
 *
 * # Why the defaults here invert the ones next door
 *
 * Connections opens its form with every event ticked, because subscribing to
 * nothing is a mistake and eight empty boxes is where somebody gives up.
 *
 * This form opens with only the READ scopes ticked, and that is the same
 * principle reaching the opposite answer: a Smart Default is only smart when
 * being wrong about it is cheap. Being wrong about which events you receive
 * costs a redundant webhook. Being wrong about what a key can do costs
 * whatever the key can do.
 *
 * It is still a default rather than an empty form — reading is what a first
 * integration does, and somebody who needs writing knows they do.
 *
 * # The rest
 *
 * **"Last used" is the headline, not the creation date.** The question this
 * screen exists to answer is "can I safely switch this off", and that is the
 * only fact that answers it. It is repeated inside the confirmation when the
 * answer is "yes, recently".
 *
 * **Revoked keys stay in the list.** "What did we turn off, and when" is an
 * incident question a hiding list cannot answer.
 *
 * **The token is a card that stays on screen, not a snackbar.** It exists once
 * in the product's whole life, and on a phone a snackbar is gone in four
 * seconds — usually while the person is switching to the app they meant to
 * paste it into.
 *
 * *Applying: Smart Defaults (inverted, and said why), Loss Aversion, Ethical
 * Friction, Zen of Clarity.*
 */
@Composable
fun ApiKeysSection(scope: SettingsScope) {
    val locale = LocalAppLocale.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<ApiKeyList>>(LoadState.Loading) }
    var creating by remember { mutableStateOf(false) }
    var minted by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(scope.repo.apiKeys(scope.companyId))
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
            val rows = current.value.keys
            val cap = current.value.cap
            val atCap = cap > 0 && current.value.live >= cap

            Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(
                    t("apiKeys.intro"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                minted?.let { token ->
                    TokenCard(token = token, onDone = { minted = null })
                }

                if (rows.isEmpty() && !creating) {
                    SettingsCard(title = t("apiKeys.empty")) {
                        Text(
                            t("apiKeys.emptyBody"),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        TextButton(onClick = { creating = true }) {
                            Text(t("apiKeys.createAction"))
                        }
                    }
                } else {
                    rows.forEach { key ->
                        ApiKeyCard(
                            scope = scope,
                            apiKey = key,
                            onChanged = { refreshKey++ },
                        )
                    }

                    if (creating) {
                        CreateApiKeyCard(
                            scope = scope,
                            onCancel = { creating = false },
                            onCreated = { token ->
                                creating = false
                                minted = token
                                refreshKey++
                            },
                        )
                    } else {
                        OutlinedButton(onClick = { creating = true }, enabled = !atCap) {
                            Text(t("apiKeys.createAction"))
                        }
                        if (atCap) {
                            Text(
                                t("apiKeys.capReached").replace("{count}", cap.toString()),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                Text(
                    t("apiKeys.developerNote"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** The seven scopes, in the order the API promises them. */
private val SCOPES = listOf(
    "conversations:read",
    "messages:read",
    "messages:send",
    "contacts:read",
    "contacts:write",
    "tasks:read",
    "tasks:write",
)

/** The safe half, and what a first integration actually needs. */
private val DEFAULT_SCOPES = SCOPES.filter { it.endsWith(":read") }.toSet()

/** The catalogue key for a scope's human sentence. Mirrors the shared rule. */
private fun scopeLabelKey(scope: String): String {
    val camel = Regex(""":(\w)""").replace(scope) { it.groupValues[1].uppercase() }
    return "apiKeys.scope.$camel"
}

@Composable
private fun TokenCard(token: String, onDone: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    SettingsCard(title = t("apiKeys.tokenTitle")) {
        Text(
            t("apiKeys.tokenBody"),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            token,
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(onClick = {
                clipboard.setText(AnnotatedString(token))
                copied = true
            }) {
                Text(if (copied) t("apiKeys.tokenCopied") else t("apiKeys.tokenCopy"))
            }
            TextButton(onClick = onDone) { Text(t("apiKeys.tokenDone")) }
        }
    }
}

@Composable
private fun CreateApiKeyCard(
    scope: SettingsScope,
    onCancel: () -> Unit,
    onCreated: (String) -> Unit,
) {
    val locale = LocalAppLocale.current
    val coroutineScope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    // Smart Defaults, inverted. See the file header.
    var scopes by remember { mutableStateOf(DEFAULT_SCOPES) }
    var saving by remember { mutableStateOf(false) }

    // #228: composed OUTSIDE the coroutine — `t` is @Composable and cannot run
    // in one, so a sentence decided in a callback has to be hoisted or it
    // renders its own key.
    val needOneScope = t("apiKeys.needOneScope")

    SettingsCard(title = t("apiKeys.createTitle")) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            label = { Text(t("apiKeys.nameLabel")) },
            placeholder = { Text(t("apiKeys.namePlaceholder")) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )

        Text(t("apiKeys.scopesLabel"), style = MaterialTheme.typography.titleSmall)
        Text(
            t("apiKeys.scopesHint"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SCOPES.forEach { scopeName ->
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Checkbox(
                    checked = scopes.contains(scopeName),
                    onCheckedChange = { on ->
                        scopes = if (on) scopes + scopeName else scopes - scopeName
                    },
                )
                Text(
                    t(scopeLabelKey(scopeName)),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                enabled = !saving && name.isNotBlank(),
                onClick = {
                    if (scopes.isEmpty()) {
                        scope.showMessage(needOneScope)
                        return@OutlinedButton
                    }
                    saving = true
                    coroutineScope.launch {
                        try {
                            val result = scope.repo.createApiKey(
                                scope.companyId,
                                CreateApiKeyBody(
                                    name = name.trim(),
                                    // Ordered by the promise, not by tap order,
                                    // so two workspaces that picked the same
                                    // scopes store the same list.
                                    scopes = SCOPES.filter { scopes.contains(it) },
                                ),
                            )
                            onCreated(result.tokenOnce)
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(cause.userMessage(locale))
                        } finally {
                            saving = false
                        }
                    }
                },
            ) {
                Text(if (saving) t("apiKeys.savingAction") else t("apiKeys.saveAction"))
            }
            TextButton(onClick = onCancel) { Text(t("apiKeys.cancelAction")) }
        }
    }
}

@Composable
private fun ApiKeyCard(
    scope: SettingsScope,
    apiKey: ApiKey,
    onChanged: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val coroutineScope = rememberCoroutineScope()
    var confirming by remember { mutableStateOf(false) }

    val revoked = apiKey.revokedAt != null

    SettingsCard(title = apiKey.name) {
        Text(
            "${apiKey.tokenPrefix}…",
            style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Text(
            when {
                revoked ->
                    t("apiKeys.revokedOn")
                        .replace("{when}", relativeTime(apiKey.revokedAt ?: ""))
                apiKey.lastUsedAt != null ->
                    t("apiKeys.lastUsed")
                        .replace("{when}", relativeTime(apiKey.lastUsedAt))
                else -> t("apiKeys.neverUsed")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        apiKey.scopes.forEach { scopeName ->
            Text(
                t(scopeLabelKey(scopeName)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (!revoked) {
            TextButton(onClick = { confirming = true }) {
                Text(t("apiKeys.revokeAction"))
            }
        }
    }

    // Ethical Friction: this breaks a live integration and cannot be undone.
    if (confirming) {
        val body = buildString {
            append(t("apiKeys.revokeBody"))
            apiKey.lastUsedAt?.let { at ->
                append(" ")
                append(
                    t("apiKeys.revokeUsedWarning").replace("{when}", relativeTime(at)),
                )
            }
        }
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(t("apiKeys.revokeTitle")) },
            text = { Text(body) },
            confirmButton = {
                TextButton(onClick = {
                    confirming = false
                    coroutineScope.launch {
                        try {
                            scope.repo.revokeApiKey(scope.companyId, apiKey.id)
                            onChanged()
                        } catch (cause: CancellationException) {
                            throw cause
                        } catch (cause: Exception) {
                            scope.showMessage(cause.userMessage(locale))
                        }
                    }
                }) { Text(t("apiKeys.revokeConfirm")) }
            },
            dismissButton = {
                TextButton(onClick = { confirming = false }) {
                    Text(t("apiKeys.keepIt"))
                }
            },
        )
    }
}
