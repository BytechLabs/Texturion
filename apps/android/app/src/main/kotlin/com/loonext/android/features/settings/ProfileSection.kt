package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Profile & account (#157): your display name (PATCH /v1/me), the theme
 * choice, who you're signed in as, and the two GoTrue account operations —
 * change email (double-confirm) and change/set password (with the
 * reauthentication-nonce retry when the session is stale).
 */
@Composable
fun ProfileSection(scope: SettingsScope, onSignOut: () -> Unit) {
    val authClient = remember(scope.graph) {
        SettingsAuthClient(
            client = scope.graph.http,
            supabaseUrl = BuildConfig.SUPABASE_URL,
            publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY,
        )
    }
    DisplayNameCard(scope)
    ThemeCard(scope)
    AccountCard(scope, authClient)
    SignOutCard(onSignOut)
}

@Composable
private fun DisplayNameCard(scope: SettingsScope) {
    var name by remember { mutableStateOf(scope.me.display_name) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val trimmed = name.trim()
    val dirty = trimmed != scope.me.display_name
    val valid = trimmed.length in 1..80

    SettingsCard(
        title = "Your name",
        description = "Shown to teammates on messages, notes, tasks, and the members list.",
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            isError = dirty && !valid,
            supportingText = if (dirty && !valid) {
                { Text("1 to 80 characters.") }
            } else {
                null
            },
        )
        InlineError(error)
        if (dirty) {
            Button(
                onClick = {
                    error = null
                    saving = true
                    coroutines.launch {
                        try {
                            scope.graph.meRepo.updateDisplayName(trimmed)
                            scope.showMessage("Name saved.")
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            saving = false
                        }
                    }
                },
                enabled = valid && !saving,
                modifier = Modifier.padding(top = 10.dp),
            ) { Text(if (saving) "Saving…" else "Save") }
        }
    }
}

private val THEME_OPTIONS = listOf("system" to "System", "light" to "Light", "dark" to "Dark")

@Composable
private fun ThemeCard(scope: SettingsScope) {
    val theme by scope.graph.prefs.theme.collectAsState(initial = "system")
    val coroutines = rememberCoroutineScope()

    SettingsCard(title = "Theme") {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            THEME_OPTIONS.forEachIndexed { index, (value, label) ->
                SegmentedButton(
                    selected = theme == value,
                    onClick = { coroutines.launch { scope.graph.prefs.setTheme(value) } },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = THEME_OPTIONS.size,
                    ),
                ) { Text(label) }
            }
        }
    }
}

@Composable
private fun AccountCard(scope: SettingsScope, authClient: SettingsAuthClient) {
    val email by produceState<String?>(initialValue = null) {
        scope.graph.sessionStore.session.collect { value = it?.email }
    }

    SettingsCard(
        title = "Account",
        description = email?.takeIf { it.isNotBlank() }?.let { "Signed in as $it." },
    ) {
        ChangeEmailBlock(scope, authClient)
        Spacer(Modifier.height(16.dp))
        ChangePasswordBlock(scope, authClient)
    }
}

@Composable
private fun ChangeEmailBlock(scope: SettingsScope, authClient: SettingsAuthClient) {
    var editing by remember { mutableStateOf(false) }
    var newEmail by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    if (!editing) {
        OutlinedButton(onClick = { editing = true }) { Text("Change email") }
        return
    }
    Column {
        OutlinedTextField(
            value = newEmail,
            onValueChange = { newEmail = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !saving,
            label = { Text("New email") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        InlineError(error)
        Button(
            onClick = {
                val trimmed = newEmail.trim()
                if (!trimmed.contains('@') || trimmed.length < 3) {
                    error = "Enter your new email address."
                    return@Button
                }
                saving = true
                error = null
                coroutines.launch {
                    try {
                        val session = scope.graph.api.freshSession()
                            ?: throw ApiException(
                                ApiErrorCode.UNAUTHORIZED, "You're signed out.", 401,
                            )
                        authClient.updateEmail(session.accessToken, trimmed)
                        editing = false
                        newEmail = ""
                        scope.showMessage(
                            "Check both inboxes. Confirmation links went to your old " +
                                "and new address. Nothing changes until you confirm.",
                        )
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        saving = false
                    }
                }
            },
            enabled = !saving && newEmail.isNotBlank(),
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(if (saving) "Sending…" else "Send confirmation links") }
    }
}

@Composable
private fun ChangePasswordBlock(scope: SettingsScope, authClient: SettingsAuthClient) {
    var editing by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var nonce by remember { mutableStateOf("") }
    var nonceNeeded by remember { mutableStateOf(false) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()

    if (!editing) {
        Column {
            OutlinedButton(onClick = { editing = true }) { Text("Change or set password") }
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(
                "If you signed up with Google or Apple, this sets a password you can " +
                    "also sign in with.",
            )
        }
        return
    }

    fun submit() {
        if (password.length < 8) {
            error = "Use at least 8 characters."
            return
        }
        saving = true
        error = null
        coroutines.launch {
            try {
                val session = scope.graph.api.freshSession()
                    ?: throw ApiException(ApiErrorCode.UNAUTHORIZED, "You're signed out.", 401)
                authClient.updatePassword(
                    accessToken = session.accessToken,
                    password = password,
                    nonce = nonce.trim().ifEmpty { null },
                )
                editing = false
                password = ""
                nonce = ""
                nonceNeeded = false
                scope.showMessage("Password updated.")
            } catch (cause: ApiException) {
                if (cause.code == REAUTHENTICATION_NEEDED && !nonceNeeded) {
                    // Stale session: GoTrue wants a fresh proof. Email the
                    // one-time code, then retry the same change with it.
                    try {
                        val session = scope.graph.api.freshSession()
                        if (session != null) {
                            authClient.requestReauthenticationNonce(session.accessToken)
                            nonceNeeded = true
                            error = null
                        } else {
                            error = "You're signed out."
                        }
                    } catch (nonceCause: Exception) {
                        error = nonceCause.userMessage()
                    }
                } else {
                    error = cause.userMessage()
                }
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    Column {
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !saving,
            label = { Text("New password") },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            supportingText = { Text("At least 8 characters.") },
        )
        if (nonceNeeded) {
            Text(
                "To confirm it's you, we emailed you a one-time code. Enter it here " +
                    "and save again.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp),
            )
            OutlinedTextField(
                value = nonce,
                onValueChange = { nonce = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
                singleLine = true,
                enabled = !saving,
                label = { Text("Code from the email") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
        InlineError(error)
        Button(
            onClick = { submit() },
            enabled = !saving && password.isNotEmpty() && (!nonceNeeded || nonce.isNotBlank()),
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(if (saving) "Saving…" else "Save password") }
    }
}

@Composable
private fun SignOutCard(onSignOut: () -> Unit) {
    SettingsCard(title = "Sign out") {
        OutlinedButton(onClick = onSignOut) { Text("Sign out on this device") }
    }
}
