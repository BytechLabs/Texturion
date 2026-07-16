package com.loonext.android.features.notifications

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import com.loonext.android.AppGraph
import com.loonext.android.core.model.NotificationPrefs
import com.loonext.android.push.PushPrefs
import com.loonext.android.push.PushRegistrar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Per-device push permission state (Android 13+ POST_NOTIFICATIONS runtime
 * model; pre-33 only has the system app-notifications switch).
 */
private enum class DevicePushState { On, Off, Blocked }

/**
 * Embeddable notification settings card (#157's settings screen hosts it):
 * per-user Email + Push toggles (GET/PUT /v1/notification-prefs, optimistic
 * with rollback) and this device's push permission — off ('Turn on' fires the
 * system prompt), blocked (deep link into system settings), on, plus the
 * honest 'push unavailable in this build' state when Firebase isn't
 * configured. Granting permission (or landing here already granted with push
 * on) re-upserts the device token — the #143 self-healing mirror.
 */
@Composable
fun NotificationPrefsCard(graph: AppGraph, companyId: String, modifier: Modifier = Modifier) {
    val repo = remember(graph) { NotificationsFeedRepository(graph.api) }
    val scope = rememberCoroutineScope()

    var state by remember(companyId) {
        mutableStateOf<LoadState<NotificationPrefs>>(LoadState.Loading)
    }
    var saveError by remember(companyId) { mutableStateOf<String?>(null) }
    var retryKey by remember(companyId) { mutableIntStateOf(0) }

    LaunchedEffect(companyId, retryKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            LoadState.Ready(repo.prefs(companyId))
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    fun save(next: NotificationPrefs, previous: NotificationPrefs) {
        state = LoadState.Ready(next)
        saveError = null
        scope.launch {
            try {
                state = LoadState.Ready(repo.updatePrefs(companyId, next))
            } catch (_: Exception) {
                state = LoadState.Ready(previous)
                saveError = "That didn't save. Try again."
            }
        }
    }

    Column(modifier.fillMaxWidth()) {
        Text("Notifications", style = MaterialTheme.typography.titleMedium)

        when (val current = state) {
            is LoadState.Loading -> Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) { LoadingIndicator() }

            is LoadState.Failed -> Column(Modifier.padding(top = 8.dp)) {
                Text(
                    current.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(onClick = {
                    state = LoadState.Loading
                    retryKey++
                }) { Text("Try again") }
            }

            is LoadState.Ready -> {
                val prefs = current.value
                PrefToggleRow(
                    title = "Email",
                    supporting = "An email when a new conversation starts or a customer " +
                        "texts back after a quiet spell. Never one per message.",
                    checked = prefs.email_enabled,
                    onCheckedChange = { checked ->
                        save(prefs.copy(email_enabled = checked), prefs)
                    },
                )
                PrefToggleRow(
                    title = "Push",
                    supporting = "Notifications on your devices for new texts and missed calls.",
                    checked = prefs.push_enabled,
                    onCheckedChange = { checked ->
                        save(prefs.copy(push_enabled = checked), prefs)
                    },
                )
                saveError?.let { message ->
                    Text(
                        message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }

                Spacer(Modifier.padding(top = 12.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                DevicePushSection(
                    graph = graph,
                    companyId = companyId,
                    pushEnabled = prefs.push_enabled,
                )
            }
        }
    }
}

@Composable
private fun PrefToggleRow(
    title: String,
    supporting: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                supporting,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}

@Composable
private fun DevicePushSection(graph: AppGraph, companyId: String, pushEnabled: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val firebaseAvailable = remember { PushRegistrar.isFirebaseAvailable(context) }

    Text(
        "Push on this device",
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
    )

    if (!firebaseAvailable) {
        Text(
            "Push isn't available in this build yet. Everything still shows up in the app.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        return
    }

    // Re-read permission state whenever we come back from the system prompt
    // or the settings screen.
    var permissionTick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        permissionTick++
        onPauseOrDispose { }
    }
    val registrar = remember(graph) { PushRegistrar(context.applicationContext, graph.api) }
    val pushState = remember(permissionTick) { devicePushState(context) }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        PushPrefs.setPermissionRequested(context)
        permissionTick++
        if (granted) scope.launch { registrar.register(companyId) }
    }

    // #143 self-heal: any time this device is allowed to push and the user
    // wants push, re-upsert the token (server may have pruned a dead row).
    LaunchedEffect(pushState, pushEnabled, companyId) {
        if (pushState == DevicePushState.On && pushEnabled) {
            registrar.register(companyId)
        }
    }

    when (pushState) {
        DevicePushState.On -> StatusRow(
            body = "This device gets a notification when a customer texts or calls.",
            action = "System settings",
            solidAction = false,
            onAction = { openNotificationSettings(context) },
        )

        DevicePushState.Off -> StatusRow(
            body = "Get a notification on this device when a customer texts or calls, " +
                "even with Loonext closed.",
            action = "Turn on",
            solidAction = true,
            onAction = {
                if (Build.VERSION.SDK_INT >= 33) {
                    permissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                } else {
                    // Pre-13 there is no runtime prompt — only the system switch.
                    openNotificationSettings(context)
                }
            },
        )

        DevicePushState.Blocked -> StatusRow(
            body = "Notifications are turned off for Loonext in system settings. " +
                "Turn them on there to get pinged.",
            action = "Open settings",
            solidAction = false,
            onAction = { openNotificationSettings(context) },
        )
    }
}

@Composable
private fun StatusRow(
    body: String,
    action: String,
    solidAction: Boolean,
    onAction: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            body,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.width(12.dp))
        if (solidAction) {
            Button(onClick = onAction) { Text(action) }
        } else {
            TextButton(onClick = onAction) { Text(action) }
        }
    }
}

private fun devicePushState(context: Context): DevicePushState {
    if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
        return DevicePushState.On
    }
    if (Build.VERSION.SDK_INT < 33) {
        // Pre-13: off means someone flipped the system switch — settings only.
        return DevicePushState.Blocked
    }
    val activity = context.findActivity()
    val canPromptAgain = activity?.let {
        ActivityCompat.shouldShowRequestPermissionRationale(
            it,
            android.Manifest.permission.POST_NOTIFICATIONS,
        )
    } ?: false
    // Never asked (or the system says a prompt would still show) = Off with a
    // real 'Turn on'; asked and permanently denied = Blocked with recovery.
    return if (!PushPrefs.permissionRequested(context) || canPromptAgain) {
        DevicePushState.Off
    } else {
        DevicePushState.Blocked
    }
}

private fun openNotificationSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
