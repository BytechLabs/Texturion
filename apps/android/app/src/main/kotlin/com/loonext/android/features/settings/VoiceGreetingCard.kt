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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.unit.dp
import com.loonext.android.ui.common.userMessage
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
 */
@Composable
internal fun VoiceGreetingCard(scope: SettingsScope, canEdit: Boolean) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    val recorder = remember { GreetingRecorder(context) }

    var rows by remember { mutableStateOf(emptyList<VoicemailGreeting>()) }
    var take by remember { mutableStateOf<GreetingTake?>(null) }
    var name by remember { mutableStateOf(DEFAULT_GREETING_NAME) }
    var recording by remember { mutableStateOf(false) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf<VoicemailGreeting?>(null) }
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
            error = "That recording would not play back. Record it again."
            null
        }
    }

    fun begin() {
        error = null
        if (!recorder.start()) {
            // Almost always the mic is held by a call, or the permission was
            // revoked between the check and here. Say what to do, not that it
            // failed.
            error = "The microphone is not available. Close any call and try again."
            return
        }
        recording = true
    }

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            begin()
        } else {
            error = "Loonext needs the microphone to record a greeting. " +
                "Allow it in Settings, then try again."
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
            error = "Nothing was recorded. Try holding the phone closer."
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
                scope.showMessage("Saved. Choose it on a number to use it.")
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                pending = false
            }
        }
    }

    SettingsCard(
        title = "Your own voice",
        description = "Record the greeting yourself instead of having it read " +
            "aloud. Callers hear a person, which is the thing you are actually " +
            "selling.",
    ) {
        Text(
            if (rows.isEmpty()) {
                "Nothing recorded yet — callers hear the written greeting, read aloud."
            } else {
                "Pick one on a number under Numbers to use it. Anything you have " +
                    "not chosen stays unused."
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
                        Text("Delete")
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
                                "Recorded ${formatGreetingDuration(take!!.durationMs)}",
                                style = MaterialTheme.typography.bodySmall,
                            )
                            Spacer(Modifier.weight(1f))
                            TextButton(enabled = !pending, onClick = { playTake() }) {
                                Text("Hear it back")
                            }
                        }
                        Text(
                            "This is exactly what a caller gets.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedTextField(
                            value = name,
                            onValueChange = { name = it },
                            label = { Text("Name it") },
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
                            ) { Text("Record again") }
                            Spacer(Modifier.weight(1f))
                            Button(
                                enabled = !pending && name.isNotBlank(),
                                onClick = { onSave() },
                            ) { Text(if (pending) "Saving…" else "Save greeting") }
                        }
                    }

                    recording -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("Recording… speak now.", style = MaterialTheme.typography.bodyMedium)
                        Spacer(Modifier.weight(1f))
                        Button(onClick = { onStop() }) { Text("Stop") }
                    }

                    else -> Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Up to two minutes.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.weight(1f))
                        Button(onClick = { onRecord() }) { Text("Record") }
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
            title = { Text("Delete \"${target.name}\"?") },
            text = {
                Text(
                    "Any number using it goes back to the written words, read " +
                        "aloud. Callers hear the change on the next call.",
                )
            },
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
                                scope.showMessage("Deleted.")
                            } catch (cause: Exception) {
                                error = cause.userMessage()
                            } finally {
                                pending = false
                            }
                        }
                    },
                ) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { confirmDelete = null }) { Text("Keep it") }
            },
        )
    }
}

/**
 * What most owners are recording, so the field is never empty.
 *
 * Still editable — a workspace with a holiday greeting and a truck greeting
 * needs to say which is which — but nobody should have to think of a name
 * before they can hear their first take.
 */
private const val DEFAULT_GREETING_NAME = "After hours"
