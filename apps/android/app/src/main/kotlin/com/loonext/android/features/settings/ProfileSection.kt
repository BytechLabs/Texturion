package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material3.Button
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.UiLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.MessageLocale
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.rememberHaptics
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
    // #228: directly under the name and above the theme, because the three are
    // the same question asked three ways — how this app presents YOU, to
    // teammates and to yourself. Language leads the two appearance settings
    // because it is the one somebody can be locked out by.
    LanguageCard(scope)
    ThemeCard(scope)
    AccountCard(scope, authClient)
    // #314: directly under the password, because it is the same question —
    // how somebody proves they are you.
    TwoFactorCard(scope)
    SignOutCard(onSignOut)
    // #346: last — leaving is not one of the everyday account settings.
    DeleteAccountCard(scope, onDeleted = onSignOut)
}

@Composable
private fun DisplayNameCard(scope: SettingsScope) {
    var name by remember { mutableStateOf(scope.me.display_name) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current
    val trimmed = name.trim()
    val dirty = trimmed != scope.me.display_name
    val valid = trimmed.length in 1..80

    SettingsCard(
        title = t("settingsMore.yourName"),
        description = t("settingsMore.yourNameDesc"),
    ) {
        OutlinedTextField(
            value = name,
            onValueChange = { name = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            isError = dirty && !valid,
            supportingText = if (dirty && !valid) {
                { Text(t("settingsMore.nameLength")) }
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
                            scope.showMessage(
                                AppStrings.translate(locale, "settingsMore.nameSaved"),
                            )
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            saving = false
                        }
                    }
                },
                enabled = valid && !saving,
                modifier = Modifier.padding(top = 10.dp),
            ) { Text(if (saving) t("common.saving") else t("common.save")) }
        }
    }
}

/**
 * #228 — the language THIS PERSON reads the app in, which is not the language
 * their customers are texted in.
 *
 * WHY IT IS A SEPARATE CARD FROM THE WORKSPACE ONE, and must stay separate. The
 * card in Settings › Workspace decides what an automated text says to a
 * CUSTOMER; it is the owner's, it reaches four sends, and it is worded to
 * promise nothing about the interface. This one decides what the CREW reads,
 * belongs to each member alone, and reaches every screen. Merging them would
 * make a French owner's choice silently re-language their English-speaking
 * tech's phone, which is the exact failure the user > device > company chain in
 * `UiLocale` exists to prevent.
 *
 * Three options, so a radio list rather than a picker: all three and the one in
 * force are readable without a tap. "Same as my phone" is a REAL choice and not
 * an absence — it is the only way back to following the device once somebody
 * has picked, and it is what everybody starts on.
 */
@Composable
private fun LanguageCard(scope: SettingsScope) {
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // The mirror rather than `scope.me.locale`: this is the same value the
    // Compose root resolves the app's language from, so the radio and the app
    // can never disagree about what was chosen — and writing it is what makes
    // the change visible in the same frame instead of on the next launch.
    val chosen by scope.graph.prefs.uiLocale.collectAsState(initial = null)
    val deviceTag = remember { UiLocale.deviceTag() }
    // What "Same as my phone" actually resolves to today, named rather than
    // implied: a rule without its answer sends somebody back to guessing.
    val followed = remember(deviceTag) {
        UiLocale.normalizeDevice(deviceTag) ?: MessageLocale.DEFAULT
    }

    fun choose(value: String?) {
        if (value == chosen) return
        error = null
        saving = true
        coroutines.launch {
            try {
                // The SERVER first, then the mirror. The other order would show
                // somebody a language the laptop they sign into next has never
                // heard of, which is worse than a save that visibly failed.
                scope.graph.meRepo.updateLocale(value)
                scope.graph.prefs.setUiLocale(value)
                haptics.confirm()
                scope.showMessage(
                    AppStrings.translate(value ?: followed, "shell.languageSaved"),
                )
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                saving = false
            }
        }
    }

    SettingsCard(
        title = t("shell.languageTitle"),
        description = t("shell.languageDescription"),
    ) {
        // The stored value always appears, even when this build has not heard
        // of it: a list that silently omitted somebody's language would render
        // every option unselected and read as though nothing were set.
        val options: List<String?> =
            (listOf<String?>(null) + MessageLocale.ALL + listOfNotNull(chosen)).distinct()
        // ONE selectable group, so TalkBack says "2 of 3" rather than reading
        // three unrelated switches. `role = RadioButton` on each row is the
        // other half: without it the row announces as a button and the choice
        // it is part of is invisible to anybody not looking at the screen.
        Column(Modifier.selectableGroup()) {
            options.forEach { value ->
                val selected = chosen == value
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = selected,
                            enabled = !saving,
                            role = Role.RadioButton,
                            onClick = { choose(value) },
                        )
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = selected, onClick = null, enabled = !saving)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            // A language names ITSELF, never translated — the
                            // same rule the workspace card and both other
                            // clients follow.
                            value?.let { MessageLocale.label(it) }
                                ?: t("shell.languageSameAsPhone"),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        // Tight under its own option, because it belongs to
                        // that option and to nothing else.
                        if (value == null) {
                            ReadOnlyLine(
                                t(
                                    "shell.languageFollowingDevice",
                                    "language" to MessageLocale.label(followed),
                                ),
                            )
                        }
                    }
                }
            }
        }
        InlineError(error)
        // 12dp rather than the 6dp BETWEEN options: this is a note about the
        // whole card, and at the same gap it reads as a fourth choice somebody
        // forgot to put a radio button on.
        Spacer(Modifier.height(12.dp))
        ReadOnlyLine(t("shell.languageNotCustomers"))
    }
}

/**
 * The stored values. Their WORDS come from the catalogue, because a value that
 * goes into preferences and a word somebody reads are two different things —
 * pairing them in one list makes the reader's language part of the storage.
 */
private val THEME_VALUES = listOf("system", "light", "dark")

@Composable
private fun themeLabel(value: String): String = when (value) {
    "light" -> t("settingsMore.themeLight")
    "dark" -> t("settingsMore.themeDark")
    else -> t("settingsMore.themeSystem")
}

@Composable
private fun ThemeCard(scope: SettingsScope) {
    val theme by scope.graph.prefs.theme.collectAsState(initial = "system")
    val coroutines = rememberCoroutineScope()

    SettingsCard(title = t("settingsMore.theme")) {
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            THEME_VALUES.forEachIndexed { index, value ->
                SegmentedButton(
                    selected = theme == value,
                    onClick = { coroutines.launch { scope.graph.prefs.setTheme(value) } },
                    shape = SegmentedButtonDefaults.itemShape(
                        index = index,
                        count = THEME_VALUES.size,
                    ),
                ) { Text(themeLabel(value)) }
            }
        }
    }
}

@Composable
private fun AccountCard(scope: SettingsScope, authClient: SettingsAuthClient) {
    val email by produceState<String?>(initialValue = null) {
        scope.graph.sessionStore.session.collect { value = it?.email }
    }

    val signedInAs = email?.takeIf { it.isNotBlank() }
        ?.let { t("settingsMore.signedInAs", "email" to it) }
    SettingsCard(
        title = t("settingsMore.account"),
        description = signedInAs,
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
    val locale = LocalAppLocale.current

    if (!editing) {
        OutlinedButton(onClick = { editing = true }) { Text(t("settingsMore.changeEmail")) }
        return
    }
    Column {
        OutlinedTextField(
            value = newEmail,
            onValueChange = { newEmail = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !saving,
            label = { Text(t("settingsMore.newEmail")) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        InlineError(error)
        Button(
            onClick = {
                val trimmed = newEmail.trim()
                if (!trimmed.contains('@') || trimmed.length < 3) {
                    error = AppStrings.translate(locale, "settingsMore.enterNewEmail")
                    return@Button
                }
                saving = true
                error = null
                coroutines.launch {
                    try {
                        val session = scope.graph.api.freshSession()
                            ?: throw ApiException(
                                ApiErrorCode.UNAUTHORIZED,
                                AppStrings.translate(locale, "settingsMore.signedOut"),
                                401,
                            )
                        authClient.updateEmail(session.accessToken, trimmed, locale)
                        editing = false
                        newEmail = ""
                        scope.showMessage(
                            AppStrings.translate(locale, "settingsMore.emailConfirmSent"),
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
        ) {
            Text(
                if (saving) {
                    t("settingsMore.sending")
                } else {
                    t("settingsMore.sendConfirmLinks")
                },
            )
        }
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
    val locale = LocalAppLocale.current

    if (!editing) {
        Column {
            OutlinedButton(onClick = { editing = true }) {
                Text(t("settingsMore.changePassword"))
            }
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settingsMore.passwordOauthNote"))
        }
        return
    }

    fun submit() {
        if (password.length < 8) {
            error = AppStrings.translate(locale, "settingsMore.passwordTooShort")
            return
        }
        saving = true
        error = null
        coroutines.launch {
            try {
                val session = scope.graph.api.freshSession()
                    ?: throw ApiException(
                        ApiErrorCode.UNAUTHORIZED,
                        AppStrings.translate(locale, "settingsMore.signedOut"),
                        401,
                    )
                authClient.updatePassword(
                    accessToken = session.accessToken,
                    password = password,
                    nonce = nonce.trim().ifEmpty { null },
                    locale = locale,
                )
                editing = false
                password = ""
                nonce = ""
                nonceNeeded = false
                scope.showMessage(
                    AppStrings.translate(locale, "settingsMore.passwordUpdated"),
                )
            } catch (cause: ApiException) {
                if (cause.code == REAUTHENTICATION_NEEDED && !nonceNeeded) {
                    // Stale session: GoTrue wants a fresh proof. Email the
                    // one-time code, then retry the same change with it.
                    try {
                        val session = scope.graph.api.freshSession()
                        if (session != null) {
                            authClient.requestReauthenticationNonce(session.accessToken, locale)
                            nonceNeeded = true
                            error = null
                        } else {
                            error = AppStrings.translate(locale, "settingsMore.signedOut")
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
            label = { Text(t("settingsMore.newPassword")) },
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            supportingText = { Text(t("settingsMore.atLeast8")) },
        )
        if (nonceNeeded) {
            Text(
                t("settingsMore.reauthCodeNote"),
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
                label = { Text(t("settingsMore.codeFromEmail")) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
        }
        InlineError(error)
        Button(
            onClick = { submit() },
            enabled = !saving && password.isNotEmpty() && (!nonceNeeded || nonce.isNotBlank()),
            modifier = Modifier.padding(top = 8.dp),
        ) {
            Text(
                if (saving) t("common.saving") else t("settingsMore.savePassword"),
            )
        }
    }
}

@Composable
private fun SignOutCard(onSignOut: () -> Unit) {
    SettingsCard(title = t("settingsMore.signOut")) {
        OutlinedButton(onClick = onSignOut) { Text(t("settingsMore.signOutThisDevice")) }
    }
}
