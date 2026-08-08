package com.loonext.android.features.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.core.auth.AppPrefs
import com.loonext.android.core.security.AppLock

/**
 * #330 — the lock in front of the inbox on a phone that is not a work phone.
 *
 * ## What this covers, and what it deliberately does not
 *
 * It covers the handover: a spare phone in the truck passed to whoever is
 * covering the weekend, or a personal handset left on a kitchen table. It does
 * NOT pretend to defend against somebody who has the phone and time — that is
 * the OS's disk encryption and screen lock, and duplicating them here would be
 * theatre.
 *
 * ## Why the wiring is thin and the rules live elsewhere
 *
 * Everything decidable is in [AppLock] with unit tests: cold start always locks,
 * the grace window is a maximum, a clock that went backwards asks again. What is
 * left here is the part no unit test can run — showing the system's own prompt —
 * and it is kept deliberately small so there is little to be wrong.
 *
 * ## The unlock is per-process and never written down
 *
 * `unlockedAt` lives in this composition and nowhere else. Persisting it would
 * mean a phone that was unlocked before it was handed over stays unlocked after,
 * which is the whole case this exists for.
 */
@Composable
fun AppLockGate(prefs: AppPrefs, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val enabled by prefs.appLockEnabled.collectAsStateWithLifecycle(initialValue = false)

    // Null until the first successful unlock IN THIS PROCESS — see the header.
    var unlockedAt by remember { mutableStateOf<Long?>(null) }
    var prompting by remember { mutableStateOf(false) }

    // Re-evaluated whenever the app comes back to the foreground, which is the
    // moment that matters: the question is not "was this ever unlocked" but "has
    // it been away long enough that somebody else could be holding it".
    val lifecycleOwner = LocalLifecycleOwner.current
    var resumeTick by remember { mutableStateOf(0) }
    LaunchedEffect(lifecycleOwner) {
        lifecycleOwner.lifecycle.currentStateFlow.collect { state ->
            if (state.isAtLeast(Lifecycle.State.RESUMED)) resumeTick += 1
        }
    }

    val reason = remember(enabled, unlockedAt, resumeTick) {
        AppLock.reasonToLock(
            enabled = enabled,
            unlockedAtMillis = unlockedAt,
            nowMillis = System.currentTimeMillis(),
        )
    }

    if (reason == null) {
        content()
        return
    }

    // THE CONTENT IS NOT COMPOSED WHILE LOCKED, rather than drawn behind a
    // scrim. A scrim is a screenshot away from being nothing at all, and the
    // recents thumbnail is exactly where a handed-over phone shows its last
    // screen.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(32.dp),
            ) {
                Text(
                    AppLock.headline(reason),
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    // Says whose data it is protecting, not whose fault this is.
                    "Your customers' conversations are on this phone.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Button(
                    enabled = !prompting,
                    onClick = {
                        prompting = true
                        showPrompt(context) { ok ->
                            prompting = false
                            if (ok) unlockedAt = System.currentTimeMillis()
                        }
                    },
                ) { Text("Unlock") }
            }
        }
    }

    // Asked once on arrival so the common case is a fingerprint and not a tap
    // then a fingerprint. The button stays for a refusal, a timeout, or a phone
    // that put the sheet away while it rang.
    LaunchedEffect(reason) {
        if (!prompting) {
            prompting = true
            showPrompt(context) { ok ->
                prompting = false
                if (ok) unlockedAt = System.currentTimeMillis()
            }
        }
    }
}

/**
 * The system prompt, with the device credential as a permitted answer.
 *
 * `BIOMETRIC_WEAK or DEVICE_CREDENTIAL` on purpose: a tradesperson's phone may
 * have a PIN and no working fingerprint (gloves, plaster dust, a cracked
 * sensor), and refusing that phone the feature would be protecting the people
 * with the newest hardware. Strong-only biometrics is the right bar for signing a
 * transaction, not for re-opening an inbox on a device already trusted enough to
 * hold the session.
 */
private fun showPrompt(
    context: android.content.Context,
    onResult: (Boolean) -> Unit,
) {
    val activity = context as? FragmentActivity
    if (activity == null) {
        // No activity to host the sheet. Answering "unlocked" here would defeat
        // the feature, so it stays locked and the button can be pressed again.
        onResult(false)
        return
    }
    val allowed =
        BiometricManager.Authenticators.BIOMETRIC_WEAK or
            BiometricManager.Authenticators.DEVICE_CREDENTIAL
    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(context),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onResult(true)
            }

            override fun onAuthenticationError(code: Int, message: CharSequence) {
                onResult(false)
            }
            // onAuthenticationFailed is deliberately not overridden: a finger the
            // sensor did not recognise is one attempt, not a dismissal, and the
            // system sheet is still up asking again.
        },
    )
    prompt.authenticate(
        BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock Loonext")
            .setSubtitle("Your customers' conversations are on this phone")
            .setAllowedAuthenticators(allowed)
            .build(),
    )
}

/** Whether this phone can enforce a lock at all — see [AppLock.canEnable]. */
fun deviceCanLock(context: android.content.Context): Boolean {
    val manager = BiometricManager.from(context)
    fun ok(authenticators: Int) =
        manager.canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    return AppLock.canEnable(
        hasBiometric = ok(BiometricManager.Authenticators.BIOMETRIC_WEAK),
        hasDeviceCredential = ok(BiometricManager.Authenticators.DEVICE_CREDENTIAL),
    )
}
