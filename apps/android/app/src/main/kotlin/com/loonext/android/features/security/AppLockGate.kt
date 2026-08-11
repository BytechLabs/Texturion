package com.loonext.android.features.security

import android.app.Activity
import android.os.Build
import android.view.WindowManager
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
import androidx.compose.runtime.DisposableEffect
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
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
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
 *
 * ## #581: the lock is re-evaluated on the way IN, so the way OUT needs its own answer
 *
 * Everything below ticks on RESUMED. At the moment the app LEAVES the foreground
 * it is still unlocked and still composing a thread, and that is the frame the OS
 * photographs for the recents card — so a phone can be swiped up on and read
 * without the lock ever being asked. Re-evaluating earlier does not help: the age
 * of the unlock has not changed yet at pause, so there is nothing new to decide.
 * The card itself has to be turned off, which is [hideFromRecents].
 */
@Composable
fun AppLockGate(prefs: AppPrefs, content: @Composable () -> Unit) {
    val context = LocalContext.current
    val enabled by prefs.appLockEnabled.collectAsStateWithLifecycle(initialValue = false)

    // #581: keyed on the SETTING and nothing else — deliberately not on [reason].
    // The recents card has to already be off before the app is backgrounded, and
    // at that moment the app is by definition unlocked, so a gate on "are we
    // locked" is a gate that is always open when it matters. Gated on `enabled`
    // rather than applied to everyone because both mechanisms cost something (see
    // [RecentsCover]) and nobody who left this switch alone should pay it.
    val activity = context as? Activity
    DisposableEffect(activity, enabled) {
        if (activity != null) hideFromRecents(activity, hide = enabled)
        // Put back on the way out, so this cannot outlive the setting: an
        // activity that is still alive with the switch turned off gets its
        // switcher card and its screenshots back in the same frame.
        onDispose { if (activity != null) hideFromRecents(activity, hide = false) }
    }

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

    // #228: the system sheet is raised from a plain function that has no
    // composition to read a language out of, so its two strings are resolved
    // here and handed over. Read before the early return above would be wasted
    // work on every unlocked frame, which is every frame.
    val promptTitle = t("shell.lockPromptTitle")
    val promptSubtitle = t("shell.lockPromptSubtitle")

    // THE CONTENT IS NOT COMPOSED WHILE LOCKED, rather than drawn behind a
    // scrim. A scrim is a screenshot away from being nothing at all.
    //
    // #581: this does NOT cover the recents thumbnail, which this comment used
    // to claim it did. The thumbnail is taken on the way OUT, while the app is
    // still unlocked and still composing the inbox, so no decision made here can
    // reach it — that is [hideFromRecents], applied above.
    Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(32.dp),
            ) {
                Text(
                    // The headline is the pure module's, in the reader's
                    // language: it is the sentence ABOVE the two below it, and a
                    // half-French wall is the one screen nobody can get past to
                    // the setting that would fix it.
                    AppLock.headline(reason, LocalAppLocale.current),
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
                Text(
                    // Says whose data it is protecting, not whose fault this is.
                    t("shell.lockBody"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                Button(
                    enabled = !prompting,
                    onClick = {
                        prompting = true
                        showPrompt(context, promptTitle, promptSubtitle) { ok ->
                            prompting = false
                            if (ok) unlockedAt = System.currentTimeMillis()
                        }
                    },
                ) { Text(t("shell.lockAction")) }
            }
        }
    }

    // Asked once on arrival so the common case is a fingerprint and not a tap
    // then a fingerprint. The button stays for a refusal, a timeout, or a phone
    // that put the sheet away while it rang.
    LaunchedEffect(reason) {
        if (!prompting) {
            prompting = true
            showPrompt(context, promptTitle, promptSubtitle) { ok ->
                prompting = false
                if (ok) unlockedAt = System.currentTimeMillis()
            }
        }
    }
}

/**
 * #581 — what this Android version can do about the app-switcher card.
 *
 * The two are NOT equivalent, which is the whole reason this is a decision rather
 * than one line at the call site. [RECENTS_CARD_ONLY] blanks the switcher
 * thumbnail and nothing else, so a tradesperson can still screenshot a thread to
 * send a colleague — the thing people actually do with this app. [WHOLE_WINDOW]
 * blanks the card as a side effect of making the window uncapturable, and takes
 * those screenshots with it.
 */
internal enum class RecentsCover {
    /** `Activity.setRecentsScreenshotEnabled(false)`, API 33 and up. */
    RECENTS_CARD_ONLY,

    /**
     * `FLAG_SECURE`, below API 33, where there is no recents-only switch.
     *
     * Chosen rather than doing nothing because `minSdk` is 28 and the phones
     * without the narrow API are exactly the ones this feature was written for:
     * the old spare handset in the truck. A feature that quietly does nothing on
     * the device it was named after is worse than one that costs a screenshot,
     * and the cost is only ever paid by somebody who turned the lock on.
     */
    WHOLE_WINDOW,
}

/**
 * THE version gate, in one place.
 *
 * Separate from [hideFromRecents] so the band of devices that gets which
 * mechanism is an assertion rather than an intention: the failure this shape
 * prevents is a call site that writes only the API-33 branch and ships a no-op to
 * everything below it.
 */
internal fun recentsCoverFor(sdkInt: Int): RecentsCover =
    if (sdkInt >= Build.VERSION_CODES.TIRAMISU) RecentsCover.RECENTS_CARD_ONLY
    else RecentsCover.WHOLE_WINDOW

/**
 * Keep this activity out of the app switcher, or stop doing so.
 *
 * [sdkInt] is a parameter rather than read straight off [Build] so that the
 * pre-33 branch can be exercised on the one Robolectric image this repo pins —
 * see the note on `@Config(sdk = [34])` in `AppLockGateTest`. Production always
 * passes the real one.
 */
internal fun hideFromRecents(
    activity: Activity,
    hide: Boolean,
    sdkInt: Int = Build.VERSION.SDK_INT,
) {
    when (recentsCoverFor(sdkInt)) {
        // `enabled = !hide`: the platform API is phrased as permission, not denial.
        RecentsCover.RECENTS_CARD_ONLY -> activity.setRecentsScreenshotEnabled(!hide)
        RecentsCover.WHOLE_WINDOW ->
            if (hide) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
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
    title: String,
    subtitle: String,
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
            .setTitle(title)
            .setSubtitle(subtitle)
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
