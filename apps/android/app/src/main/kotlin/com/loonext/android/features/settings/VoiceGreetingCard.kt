package com.loonext.android.features.settings

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaPlayer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * #309 — "Your own voice".
 *
 * Hand-port of `apps/web/src/components/settings/voice-greeting-card.tsx`,
 * keeping the three rules that shape it:
 *
 * - **You cannot save a take you have not heard.** Save appears only once
 *   there IS a recording, beside the player. Recording your own voice is the
 *   one thing people redo, and a flow that saves the first take unheard is one
 *   that assumes it was good.
 * - **The name is pre-filled** with what most owners are recording. An empty
 *   required field between somebody and their first playback is friction with
 *   no purpose.
 * - **Deleting asks first**, because it changes what every caller to a line
 *   using it hears and this card cannot show which lines those are.
 * - **There is a second way in, and it is a phone call.** Some owners will
 *   never record in an app — the permission prompt, the phone held at arm's
 *   length. "Have us call you" rings them and they talk. It sits behind a text
 *   button rather than beside Record, because two equally-weighted ways to do
 *   one thing is a decision nobody asked for, and it moves to the front the
 *   moment the microphone is refused, which is exactly when it is the answer.
 */
@Composable
internal fun VoiceGreetingCard(scope: SettingsScope, canEdit: Boolean) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    // The recorder's failures and the save confirmations are all written from
    // callbacks and coroutines, so the reader's language is read once here.
    val locale = LocalAppLocale.current
    val recorder = remember { GreetingRecorder(context) }

    var rows by remember { mutableStateOf(emptyList<VoicemailGreeting>()) }
    var take by remember { mutableStateOf<GreetingTake?>(null) }
    var name by remember { mutableStateOf(DEFAULT_GREETING_NAME) }
    var recording by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<VoicemailGreeting?>(null) }
    // #309's phone path. `null` is closed; `phase` tells the one dialog whether
    // it is still asking or already waiting on a call that is out there.
    var capture by remember { mutableStateOf<CaptureState?>(null) }
    // True once the microphone has actually been refused, which is when the
    // phone path stops being an alternative and starts being the way through.
    var micRefused by remember { mutableStateOf(false) }
    // The take's own player. Held here so it can be released with the screen —
    // a MediaPlayer left holding a file is a leak the member never sees.
    val player = remember { mutableStateOf<MediaPlayer?>(null) }

    suspend fun refresh() {
        rows = try {
            scope.repo.voicemailGreetings(scope.companyId)
        } catch (cause: Exception) {
            error = cause.userMessage()
            rows
        }
    }

    LaunchedEffect(scope.companyId) { refresh() }

    // A microphone left open by a screen the member walked away from is the one
    // thing this must never do.
    DisposableEffect(Unit) {
        onDispose {
            recorder.discard()
            player.value?.release()
            player.value = null
        }
    }

    /**
     * Hear it back.
     *
     * This is not a nicety: the whole flow rests on an owner hearing their own
     * take before it becomes what customers hear. Without a player here the
     * Android card would ask them to trust a recording they have never heard,
     * which is the failure the web version was built to avoid.
     */
    fun playTake() {
        val current = take ?: return
        player.value?.release()
        player.value = try {
            MediaPlayer().apply {
                setDataSource(current.file.absolutePath)
                setOnCompletionListener { it.release(); player.value = null }
                prepare()
                start()
            }
        } catch (_: Exception) {
            error = AppStrings.translate(locale, "settingsMore.takeWontPlay")
            null
        }
    }

    fun begin() {
        error = null
        if (!recorder.start()) {
            // Almost always the mic is held by a call, or the permission was
            // revoked between the check and here. Say what to do, not that it
            // failed.
            error = AppStrings.translate(locale, "settingsMore.micUnavailable")
            micRefused = true
            return
        }
        micRefused = false
        recording = true
    }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            begin()
        } else {
            error = AppStrings.translate(locale, "settingsMore.micRefused")
            micRefused = true
        }
    }

    fun onRecord() {
        val granted = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) begin() else micLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    fun onStop() {
        recording = false
        take = recorder.finish()
        if (take == null) {
            error = AppStrings.translate(locale, "settingsMore.nothingRecorded")
        }
    }

    fun onSave() {
        val current = take ?: return
        coroutines.launch {
            pending = true
            error = null
            try {
                scope.repo.recordGreeting(
                    scope.companyId,
                    name.trim(),
                    current.durationMs,
                    current.bytes,
                )
                player.value?.release()
                player.value = null
                recorder.discard()
                take = null
                name = DEFAULT_GREETING_NAME
                refresh()
                scope.showMessage(
                    AppStrings.translate(locale, "settingsMore.greetingSaved"),
                )
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                pending = false
            }
        }
    }

    /**
     * The greeting landing in the list IS the end of the phone flow.
     *
     * The owner is on a call and away from this screen, so the only
     * confirmation the call can produce is the row appearing. Polled by NAME
     * rather than by count: a second person recording at the same moment would
     * move a count and mean nothing about this call.
     */
    LaunchedEffect(capture?.phase, capture?.name) {
        val waiting = capture ?: return@LaunchedEffect
        if (waiting.phase != CapturePhase.CALLING) return@LaunchedEffect
        repeat(CAPTURE_POLLS) {
            delay(CAPTURE_POLL_MS)
            refresh()
            if (rows.any { it.name == waiting.name }) {
                capture = null
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        "settingsMore.namedGreetingSaved",
                        mapOf("name" to waiting.name),
                    ),
                )
                return@LaunchedEffect
            }
        }
    }

    fun startCaptureCall() {
        val current = capture ?: return
        coroutines.launch {
            pending = true
            error = null
            try {
                scope.repo.greetingCaptureCall(
                    scope.companyId,
                    current.name.trim(),
                    current.to.trim(),
                )
                capture = current.copy(phase = CapturePhase.CALLING)
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                pending = false
            }
        }
    }

    SettingsCard(
        title = t("settingsMore.ownVoiceTitle"),
        description = t("settingsMore.ownVoiceDesc"),
    ) {
        Text(
            if (rows.isEmpty()) {
                t("settingsMore.noGreetingsYet")
            } else {
                t("settingsMore.pickGreetingOnNumber")
            },
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        rows.forEach { row ->
            Row(
                Modifier.fillMaxWidth().padding(top = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(row.name, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.width(10.dp))
                Text(
                    formatGreetingDuration(row.duration_ms),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.weight(1f))
                if (canEdit) {
                    TextButton(enabled = !pending, onClick = { confirmDelete = row }) {
                        Text(t("common.delete"))
                    }
                }
            }
        }

        if (canEdit) {
            Column(Modifier.padding(top = 14.dp)) {
                when {
                    take != null -> {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                t(
                                    "settingsMore.recordedLength",
                                    "length" to formatGreetingDuration(take!!.durationMs),
                                ),
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Spacer(Modifier.weight(1f))
                            TextButton(enabled = !pending, onClick = { playTake() }) {
                                Text(t("settingsMore.hearItBack"))
                            }
                        }
                        Text(
                            t("settingsMore.exactlyWhatCallerGets"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = { Text(t("settingsMore.nameIt")) },
                            singleLine = true,
                            enabled = !pending,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        )
                        Row(Modifier.padding(top = 8.dp)) {
                            TextButton(
                                enabled = !pending,
                                onClick = {
                                    player.value?.release()
                                    player.value = null
                                    recorder.discard()
                                    take = null
                                },
                            ) { Text(t("settingsMore.recordAgain")) }
                            Spacer(Modifier.weight(1f))
                            Button(
                                enabled = !pending && name.isNotBlank(),
                                onClick = { onSave() },
                            ) {
                                Text(
                                    if (pending) {
                                        t("common.saving")
                                    } else {
                                        t("settingsMore.saveGreeting")
                                    },
                                )
                            }
                        }
                    }

                    recording -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            t("settingsMore.recordingNow"),
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(Modifier.weight(1f))
                        Button(onClick = { onStop() }) { Text(t("settingsMore.stop")) }
                    }

                    else -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            t("settingsMore.upToTwoMinutes"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.weight(1f))
                        Button(onClick = { onRecord() }) { Text(t("settingsMore.record")) }
                    }
                }

                if (take == null && !recording) {
                    TextButton(
                        enabled = !pending,
                        onClick = {
                            capture = CaptureState(
                                phase = CapturePhase.FORM,
                                name = DEFAULT_GREETING_NAME,
                                to = "",
                            )
                        },
                    ) {
                        Text(
                            if (micRefused) {
                                t("settingsMore.haveUsCallYou")
                            } else {
                                t("settingsMore.ratherOnThePhone")
                            },
                        )
                    }
                }
            }
        }

        error?.let {
            Text(
                it,
                modifier = Modifier.padding(top = 8.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }

    confirmDelete?.let { target ->
        AlertDialog(
            onDismissRequest = { confirmDelete = null },
            title = {
                Text(t("settingsMore.deleteGreetingTitle", "name" to target.name))
            },
            text = { Text(t("settingsMore.deleteGreetingBody")) },
            confirmButton = {
                TextButton(
                    enabled = !pending,
                    onClick = {
                        confirmDelete = null
                        coroutines.launch {
                            pending = true
                            error = null
                            try {
                                scope.repo.deleteGreeting(scope.companyId, target.id)
                                refresh()
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.deletedToast",
                                    ),
                                )
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                pending = false
                            }
                        }
                    },
                ) { Text(t("common.delete")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) {
                    Text(t("settingsMore.keepIt"))
                }
            },
        )
    }

    capture?.let { state ->
        if (state.phase == CapturePhase.CALLING) {
            AlertDialog(
                onDismissRequest = { capture = null },
                title = { Text(t("settingsMore.callingNow", "number" to state.to)) },
                text = {
                    Column {
                        Text(t("settingsMore.answerAndListen"))
                        Spacer(Modifier.height(8.dp))
                        Text(t("settingsMore.captureStep1"))
                        Text(t("settingsMore.captureStep2"))
                        Text(t("settingsMore.captureStep3"))
                        Spacer(Modifier.height(8.dp))
                        Text(
                            t("settingsMore.captureWillAppear", "name" to state.name),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                },
                confirmButton = {
                    TextButton(onClick = { capture = null }) { Text(t("common.close")) }
                },
            )
        } else {
            AlertDialog(
                onDismissRequest = { capture = null },
                title = { Text(t("settingsMore.recordOnPhone")) },
                text = {
                    Column {
                        Text(t("settingsMore.recordOnPhoneBody"))
                        OutlinedTextField(
                            value = state.to,
                            onValueChange = { capture = state.copy(to = it) },
                            label = { Text(t("settingsMore.yourNumber")) },
                            placeholder = { Text(t("settingsMore.captureNumberSample")) },
                            singleLine = true,
                            enabled = !pending,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                            modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        )
                        OutlinedTextField(
                            value = state.name,
                            onValueChange = { capture = state.copy(name = it) },
                            label = { Text(t("settingsMore.nameIt")) },
                            singleLine = true,
                            enabled = !pending,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        )
                    }
                },
                confirmButton = {
                    TextButton(
                        enabled = !pending && state.to.isNotBlank() && state.name.isNotBlank(),
                        onClick = { startCaptureCall() },
                    ) {
                        Text(
                            if (pending) {
                                t("settingsMore.calling")
                            } else {
                                t("settingsMore.callMe")
                            },
                        )
                    }
                },
                dismissButton = {
                    TextButton(onClick = { capture = null }) { Text(t("common.cancel")) }
                },
            )
        }
    }
}

/** Where the phone flow is: still asking, or already on a call. */
internal enum class CapturePhase { FORM, CALLING }

/**
 * The phone flow's whole state.
 *
 * One dialog holds both phases because they are one errand — an owner who puts
 * the phone to their ear mid-flow comes back to the window that told them what
 * to do, not to a closed one.
 */
internal data class CaptureState(
    val phase: CapturePhase,
    val name: String,
    val to: String,
)

/** Five seconds apart for three minutes: long enough to cover a 45-second ring,
 *  a two-minute recording, and the seconds it takes us to store it. */
private const val CAPTURE_POLL_MS = 5_000L
private const val CAPTURE_POLLS = 36

/**
 * What most owners are recording, so the field is never empty.
 *
 * Still editable — a workspace with a holiday greeting and a truck greeting
 * needs to say which is which — but nobody should have to think of a name
 * before they can hear their first take.
 */
private const val DEFAULT_GREETING_NAME = "After hours"
