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
import com.loonext.android.core.oncall.OnCallSilence
import com.loonext.android.features.settings.SettingsRepository
import androidx.compose.material3.AlertDialog
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
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.oncall.OnCall
import java.util.TimeZone
import com.loonext.android.core.model.NotificationPrefs
import com.loonext.android.push.PushPrefs
import com.loonext.android.push.PushRegistrar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.flow.first
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
 *
 * [extraRows] lands with the Email/Push switches rather than after the
 * device-permission block, because it is for settings that answer the same
 * question those two do — when does this thing make a noise. #463's crew-wide
 * lead-chase switch is the caller. Nothing renders while prefs are loading or
 * failed: a switch floating under a spinner belongs to no card.
 */
@Composable
fun NotificationPrefsCard(
    graph: AppGraph,
    companyId: String,
    modifier: Modifier = Modifier,
    extraRows: @Composable () -> Unit = {},
) {
    val repo = remember(graph) { NotificationsFeedRepository(graph.api) }
    val scope = rememberCoroutineScope()

    var state by remember(companyId) {
        mutableStateOf<LoadState<NotificationPrefs>>(LoadState.Loading)
    }
    var saveError by remember(companyId) { mutableStateOf<String?>(null) }
    var retryKey by remember(companyId) { mutableIntStateOf(0) }
    // #538 (audit): am I the one holding the phone right now?
    //
    // A crew nominates somebody on call, and unclaimed leads page that person. If
    // they switch push off — reasonable on an ordinary evening — the pages still
    // fire and reach nothing, and nobody else is told.
    //
    // Best-effort: an on-call read that fails leaves this false, so the switch
    // behaves exactly as it did before. A settings screen that will not load
    // because a secondary read failed would be a worse bug than the one this
    // warning prevents.
    var onCall by remember(companyId) { mutableStateOf(false) }
    var silencing by remember(companyId) { mutableStateOf<String?>(null) }
    // #228: the load and the save below are both coroutines, and the sentences
    // they surface are read on this card.
    val locale = LocalAppLocale.current

    LaunchedEffect(companyId, retryKey) {
        if (state !is LoadState.Ready) state = LoadState.Loading
        state = try {
            LoadState.Ready(repo.prefs(companyId))
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage(locale))
        }
    }

    LaunchedEffect(companyId) {
        onCall = try {
            val settings = SettingsRepository(graph.api)
            val shifts = settings.onCallShifts(companyId).data
            OnCallSilence.isOnCallNow(
                shifts.map {
                    OnCallSilence.Shift(it.user_id, it.starts_at, it.ends_at)
                },
                // The signed-in member, from the store the whole app reads.
                graph.sessionStore.session.first()?.userId.orEmpty(),
                System.currentTimeMillis(),
            )
        } catch (_: Exception) {
            false
        }
    }

    fun save(next: NotificationPrefs, previous: NotificationPrefs) {
        state = LoadState.Ready(next)
        saveError = null
        scope.launch {
            try {
                state = LoadState.Ready(repo.updatePrefs(companyId, next))
            } catch (cause: Exception) {
                state = LoadState.Ready(previous)
                // #552/D80: the SERVER'S sentence, not ours. This card hardcoded
                // "That didn't save. Try again." — and the reason it would not save
                // was a 422 naming the exact field, which is the one thing that
                // would have told the founder what was wrong. D80:
                // "a client that overwrites a server's error copy is making a bet
                // that the server will never have anything more specific to say."
                // That bet was already lost here.
                saveError = cause.userMessage(locale)
            }
        }
    }

    Column(modifier.fillMaxWidth()) {
        Text(t("contactsTasks.notificationsHeading"), style = MaterialTheme.typography.titleMedium)

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
                }) { Text(t("common.retry")) }
            }

            is LoadState.Ready -> {
                val prefs = current.value
                PrefToggleRow(
                    title = t("contactsTasks.notifEmailTitle"),
                    supporting = t("contactsTasks.notifEmailSupporting"),
                    checked = prefs.email_enabled,
                    onCheckedChange = { checked ->
                        // #538 (audit): warn, do not refuse. Somebody who wants a
                        // quiet phone is entitled to one, and refusing produces
                        // people who turn the phone off entirely — worse, because
                        // then we cannot tell.
                        if (onCall && !checked) silencing = "email"
                        else save(prefs.copy(email_enabled = checked), prefs)
                    },
                )
                PrefToggleRow(
                    title = t("contactsTasks.notifPushTitle"),
                    supporting = t("contactsTasks.notifPushSupporting"),
                    checked = prefs.push_enabled,
                    onCheckedChange = { checked ->
                        if (onCall && !checked) silencing = "push"
                        else save(prefs.copy(push_enabled = checked), prefs)
                    },
                )

                silencing?.let { channel ->
                    AlertDialog(
                        onDismissRequest = { silencing = null },
                        title = { Text(t("contactsTasks.notifOnCallTitle")) },
                        text = {
                            Text(OnCallSilence.warning(true, true, channel, locale) ?: "")
                        },
                        confirmButton = {
                            TextButton(onClick = {
                                silencing = null
                                save(
                                    if (channel == "push") {
                                        prefs.copy(push_enabled = false)
                                    } else {
                                        prefs.copy(email_enabled = false)
                                    },
                                    prefs,
                                )
                            }) { Text(t(OnCallSilence.CONFIRM_KEY)) }
                        },
                        dismissButton = {
                            TextButton(onClick = { silencing = null }) {
                                Text(t(OnCallSilence.CANCEL_KEY))
                            }
                        },
                    )
                }
                // #244: with the other per-member switches, because it IS one.
                // The difference from turning Push off is that this one ends by
                // itself at 7am, and a page still comes through — which is the
                // sentence that decides whether anybody switches it on.
                val quietOn = prefs.quiet_from != null && prefs.quiet_to != null
                PrefToggleRow(
                    title = t(OnCall.QUIET_HEADING_KEY),
                    supporting = t(OnCall.QUIET_REASSURANCE_KEY),
                    checked = quietOn,
                    onCheckedChange = { checked ->
                        save(
                            if (checked) {
                                prefs.copy(
                                    quiet_from = OnCall.QUIET_DEFAULT_FROM,
                                    quiet_to = OnCall.QUIET_DEFAULT_TO,
                                    // This device's zone, captured now. Guessing
                                    // the workspace's would silence the wrong
                                    // hours for anybody who does not live there.
                                    quiet_timezone = TimeZone.getDefault().id,
                                )
                            } else {
                                prefs.copy(
                                    quiet_from = null,
                                    quiet_to = null,
                                    quiet_timezone = null,
                                )
                            },
                            prefs,
                        )
                    },
                )
                Text(
                    if (quietOn) {
                        OnCall.quietHoursLine(
                            prefs.quiet_from.orEmpty(),
                            prefs.quiet_to.orEmpty(),
                            locale,
                        ) + " · " + t(OnCall.QUIET_SCOPE_KEY)
                    } else {
                        t(OnCall.QUIET_OFF_KEY)
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )

                saveError?.let { message ->
                    Text(
                        message,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                }

                // #297: above the quiet-hours row and below the on/off
                // switches, because it is the middle question — how loud each
                // kind is, before when the phone is silent regardless.
                DeliveryModesCard(
                    prefs = prefs,
                    onSave = { next -> save(next, prefs) },
                )

                extraRows()

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
        t("contactsTasks.notifDeviceHeading"),
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 12.dp, bottom = 4.dp),
    )

    if (!firebaseAvailable) {
        Text(
            t("contactsTasks.notifPushUnavailable"),
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
            body = t("contactsTasks.notifDeviceOnBody"),
            action = t("contactsTasks.notifSystemSettings"),
            solidAction = false,
            onAction = { openNotificationSettings(context) },
        )

        DevicePushState.Off -> StatusRow(
            body = t("contactsTasks.notifDeviceOffBody"),
            action = t("contactsTasks.notifTurnOn"),
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
            body = t("contactsTasks.notifDeviceBlockedBody"),
            action = t("contactsTasks.notifOpenSettings"),
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
