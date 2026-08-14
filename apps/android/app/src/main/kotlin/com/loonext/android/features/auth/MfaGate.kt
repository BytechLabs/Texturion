package com.loonext.android.features.auth

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.t
import com.loonext.android.features.settings.SettingsRepository
import kotlinx.coroutines.launch
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * #496/#314 — the two-factor wall, and the way through it.
 *
 * #496 is the reason it exists at all: "I am able to login without any 2fa
 * codes even though 2fa is enabled." GoTrue signs a password login in at `aal1`
 * and expects the APPLICATION to ask for the code; nothing in it refuses the
 * session on its own, and before this nothing on any client asked. So "two
 * factor is on" meant a factor existed and a password still opened everything.
 *
 * One screen with two states rather than two screens, because the question is
 * one question — "prove your second factor" — and the answer only differs in
 * whether they have one yet:
 *
 *   * ENROLLED (#496) — enter the code from the app. The common case.
 *   * NOT ENROLLED (#314) — the WORKSPACE requires a factor and this person has
 *     none, so the first step is getting one. Never shipped to the phones when
 *     #314 landed, which meant an Android user in an enforcing workspace met a
 *     bare "Couldn't load your workspace." — a lockout with no explanation and
 *     no route out.
 *
 * The design constraint is not friction, it is LOCKOUT: an authenticator lives
 * on a phone, and this IS the phone. Somebody who lost or replaced it must see
 * the way out without hunting, so the recovery path is on screen rather than
 * behind a menu — and it says plainly what it costs, because burning a code
 * REMOVES the factor rather than letting them past it once.
 */
private sealed interface GateStep {
    data object Loading : GateStep

    /** Has a factor: ask for the six digits. */
    data object Challenge : GateStep

    /** Has none and the workspace insists: get one first. */
    data class Enrol(val factorId: String, val uri: String, val secret: String) : GateStep

    /** The authenticator is gone. Burning a code turns the factor OFF. */
    data object Recovery : GateStep
}

@Composable
fun MfaGate(
    graph: AppGraph,
    /** True when the WORKSPACE demands a factor this person does not have. */
    enrolmentRequired: Boolean,
    onSatisfied: () -> Unit,
    onSignOut: () -> Unit,
) {
    var step by remember { mutableStateOf<GateStep>(GateStep.Loading) }
    var code by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val repo = remember(graph) { SettingsRepository(graph.api) }

    /*
     * #228 — the four failure sentences, resolved HERE.
     *
     * Every one of them is assigned from inside a `scope.launch { }` or a
     * `runCatching { }.onFailure { }`, and neither is a composable scope, so
     * `t()` cannot be called at the point the failure happens. Reading them
     * once in composition and letting the lambdas close over the result keeps
     * the words in the reader's language without moving the error state out of
     * this function.
     */
    val setupFailed = t("auth.mfaSetupFailed")
    val codeRejected = t("auth.mfaCodeRejected")
    val recoveryRejected = t("auth.mfaRecoveryRejected")
    val noAuthenticator = t("auth.mfaNoAuthenticator")

    LaunchedEffect(enrolmentRequired) {
        step = if (enrolmentRequired) {
            try {
                val token = graph.api.freshSession()?.accessToken ?: error("signed out")
                val enrolled = graph.supabaseAuth.enrollTotp(token, "Loonext")
                val totp = enrolled["totp"]?.jsonObject
                GateStep.Enrol(
                    factorId = enrolled["id"]!!.jsonPrimitive.content,
                    uri = totp?.get("uri")?.jsonPrimitive?.content.orEmpty(),
                    secret = totp?.get("secret")?.jsonPrimitive?.content.orEmpty(),
                )
            } catch (cause: Exception) {
                error = setupFailed
                GateStep.Challenge
            }
        } else {
            GateStep.Challenge
        }
    }

    fun verify(factorId: String?) {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                val token = graph.api.freshSession()?.accessToken ?: error("signed out")
                val id = factorId ?: repo.mfa().factors.firstOrNull()?.id
                    ?: error("no factor")
                val challenge = graph.supabaseAuth.challengeFactor(token, id)
                // The verify response is a FRESH session at aal2. Storing it is
                // the whole point — without that the app keeps presenting the
                // old aal1 token and the gate never opens.
                val next = graph.supabaseAuth.verifyFactor(
                    token, id, challenge, code.filter { it.isDigit() },
                )
                graph.sessionStore.save(next.toSession())
                // Codes are issued only after the factor is verified: a set
                // handed out before the app is proven working would be recovery
                // for a lock that was never fitted.
                if (factorId != null) runCatching { repo.issueRecoveryCodes() }
                code = ""
                onSatisfied()
            } catch (cause: Exception) {
                // One message for every failure mode: telling a wrong code apart
                // from an expired one helps an attacker more than the person
                // holding the phone, who tries the next one either way.
                error = codeRejected
            } finally {
                busy = false
            }
        }
    }

    fun recover() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            try {
                repo.recoverWithCode(code.trim())
                // The factor is gone, so this session no longer needs lifting.
                // Settings will show two-factor as off, which is the honest
                // state and the prompt to set it up again.
                code = ""
                onSatisfied()
            } catch (cause: Exception) {
                error = recoveryRejected
            } finally {
                busy = false
            }
        }
    }

    val current = step
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (current is GateStep.Loading) {
            CircularProgressIndicator()
            return@Column
        }

        Text(
            when (current) {
                is GateStep.Enrol -> t("auth.mfaEnrolTitle")
                GateStep.Recovery -> t("auth.mfaRecoveryTitle")
                else -> t("auth.mfaChallengeTitle")
            },
            style = MaterialTheme.typography.headlineSmall,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(
            when (current) {
                is GateStep.Enrol -> t("auth.mfaEnrolBody")
                GateStep.Recovery -> t("auth.mfaRecoveryBody")
                else -> t("auth.mfaChallengeBody")
            },
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )

        if (current is GateStep.Enrol) {
            Spacer(Modifier.height(16.dp))
            OutlinedButton(
                onClick = {
                    // The mobile answer to "scan this QR with this phone": a code
                    // shown ON the device that would have to scan it is useless.
                    runCatching {
                        context.startActivity(Intent(Intent.ACTION_VIEW, current.uri.toUri()))
                    }.onFailure {
                        error = noAuthenticator
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(t("auth.mfaOpenAuthenticator")) }
            Spacer(Modifier.height(8.dp))
            Text(
                current.secret,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }

        Spacer(Modifier.height(20.dp))
        OutlinedTextField(
            value = code,
            onValueChange = {
                code = it
                error = null
            },
            singleLine = true,
            enabled = !busy,
            isError = error != null,
            label = {
                Text(
                    if (current is GateStep.Recovery) {
                        t("auth.mfaRecoveryLabel")
                    } else {
                        t("auth.mfaCodeLabel")
                    },
                )
            },
            keyboardOptions = KeyboardOptions(
                keyboardType = if (current is GateStep.Recovery) {
                    KeyboardType.Text
                } else {
                    KeyboardType.NumberPassword
                },
            ),
            modifier = Modifier.fillMaxWidth(),
        )
        val message = error
        if (message != null) {
            Spacer(Modifier.height(8.dp))
            Text(
                message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
        Spacer(Modifier.height(16.dp))
        Button(
            onClick = {
                when (current) {
                    is GateStep.Enrol -> verify(current.factorId)
                    GateStep.Recovery -> recover()
                    else -> verify(null)
                }
            },
            enabled = !busy && code.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (busy) {
                CircularProgressIndicator(
                    modifier = Modifier.height(18.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(
                    if (current is GateStep.Recovery) {
                        t("auth.mfaUseThisCode")
                    } else {
                        t("auth.mfaContinue")
                    },
                )
            }
        }

        // Only offered to somebody who HAS a factor: recovery codes are issued
        // at enrolment, so a person who has not enrolled has none to burn.
        if (current !is GateStep.Enrol) {
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = {
                step = if (current is GateStep.Recovery) GateStep.Challenge else GateStep.Recovery
                code = ""
                error = null
            }) {
                Text(
                    if (current is GateStep.Recovery) {
                        t("auth.mfaHaveAuthenticator")
                    } else {
                        t("auth.mfaNoAuthenticatorSwitch")
                    },
                )
            }
        }
        // Sign-out stays reachable on every gate in this app (#207): a person
        // who can satisfy neither path must still be able to get out.
        TextButton(onClick = onSignOut) { Text(t("auth.signOut")) }
    }
}
