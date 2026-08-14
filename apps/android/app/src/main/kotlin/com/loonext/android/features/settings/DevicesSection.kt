package com.loonext.android.features.settings

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.features.attachments.MeteredMedia
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.DeviceUnknown
import androidx.compose.material.icons.outlined.PhoneAndroid
import androidx.compose.material.icons.outlined.PhoneIphone
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.loonext.android.core.security.AppLock
import com.loonext.android.features.security.deviceCanLock
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Member
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

/**
 * Signed-in devices (#236) — the Android half of the web's /settings/devices.
 *
 * A phone is the primary device for this product, and phones get lost, stolen,
 * sold, and handed to the next person when a tech quits. This is where somebody
 * answers "what is signed in right now, and how do I kill it".
 *
 * Two lists, in the order the two questions get asked: your own devices first
 * (everybody wonders), then the crew's (only an owner or admin can act on
 * that, so only they are shown it).
 */

/** Both lists, loaded together so the screen paints once. */
private data class DevicesData(
    val mine: List<DeviceSession>,
    /** null for a plain member — the crew list is admin+. */
    val crew: List<WorkspaceSession>?,
    val members: List<Member>,
)

private fun clientIcon(client: String): ImageVector = when (client) {
    SessionClient.WEB -> Icons.Outlined.Computer
    SessionClient.ANDROID -> Icons.Outlined.PhoneAndroid
    SessionClient.IOS -> Icons.Outlined.PhoneIphone
    else -> Icons.Outlined.DeviceUnknown
}

@Composable
fun DevicesSection(scope: SettingsScope) {
    val canManage = SettingsRoleGate.canManageTeam(scope.role)
    var refreshKey by remember { mutableIntStateOf(0) }

    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.devices(scope.companyId),
        refreshKey = refreshKey,
    ) {
        DevicesData(
            mine = scope.repo.mySessions().data,
            crew = if (canManage) scope.repo.workspaceSessions(scope.companyId).data else null,
            members = scope.repo.members(scope.companyId).data,
        )
    }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 2)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val data = current.value
            // #289: this phone's own data plan, above the device list. It is
            // the only setting on this screen that changes what the app DOES
            // rather than what is signed in, so it goes first — a reader who
            // came here for it should not have to scroll past a list of
            // sessions to find it.
            AppLockCard(scope)
        DataUseCard(scope)
            MyDevicesCard(scope, data.mine, onChanged = { refreshKey++ })
            if (data.crew != null) {
                CrewDevicesCard(
                    scope = scope,
                    sessions = data.crew,
                    members = data.members,
                    onChanged = { refreshKey++ },
                )
            }
        }
    }
}

@Composable
private fun MyDevicesCard(
    scope: SettingsScope,
    sessions: List<DeviceSession>,
    onChanged: () -> Unit,
) {
    // "This device" first, always: it is the row the reader has to identify
    // and dismiss before any of the others mean anything.
    val ordered = orderMyDevices(sessions)
    val others = sessions.count { !it.current }
    var busy by remember { mutableStateOf(false) }
    var confirmingAll by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    // Every sentence below is reported from a coroutine a press started, so the
    // locale is captured while composition still has it.
    val locale = LocalAppLocale.current
    val signedOutOne = t("settings.devicesSignedOutThatOne")
    val noOtherDevices = t("settings.devicesNothingElseSignedIn")
    val unknownLocation = t("settings.devicesLocationUnknown")

    SettingsCard(
        title = t("settings.devicesMineTitle"),
        description = t("settings.devicesMineIntro"),
    ) {
        if (ordered.isEmpty()) {
            ReadOnlyLine(t("settings.devicesNoneSignedIn"))
        }
        ordered.forEachIndexed { index, session ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DeviceRow(
                client = session.client,
                secondary = session.location ?: unknownLocation,
                signedInAt = session.signed_in_at,
                lastActiveAt = session.last_active_at,
                userAgent = session.user_agent,
                current = session.current,
                action = {
                    // No confirm on a single device of your own: it is small
                    // and reversible (they sign back in). The pause is spent
                    // on the two actions that are not.
                    if (!session.current) {
                        LinkButton(
                            onClick = {
                                busy = true
                                coroutines.launch {
                                    try {
                                        scope.repo.revokeMySession(session.id)
                                        haptics.confirm()
                                        scope.showMessage(signedOutOne)
                                        onChanged()
                                    } catch (cause: Exception) {
                                        scope.showMessage(cause.userMessage())
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                            enabled = !busy,
                        ) {
                            Text(
                                t("settings.devicesSignOut"),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
            )
        }

        if (others > 0) {
            Spacer(Modifier.padding(top = 4.dp))
            OutlinedButton(
                onClick = { confirmingAll = true },
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("settings.devicesSignOutEverywhere"))
            }
        }
    }

    if (confirmingAll) {
        ConfirmDialog(
            title = t("settings.devicesSignOutEverywhereTitle"),
            // A whole sentence per count rather than a count phrase dropped into
            // a stem: French agrees the verb and the noun with the number, so a
            // shared tail cannot be made to read in both.
            body = if (others == 1) {
                t("settings.devicesSignOutEverywhereBodyOne")
            } else {
                t("settings.devicesSignOutEverywhereBody", "count" to others.toString())
            },
            confirmLabel = t("settings.devicesSignThemOut"),
            destructive = true,
            pending = busy,
            error = actionError,
            onDismiss = { confirmingAll = false },
            onConfirm = {
                haptics.reject()
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        val result = scope.repo.revokeMyOtherSessions()
                        confirmingAll = false
                        scope.showMessage(
                            when (result.sessions) {
                                0 -> noOtherDevices
                                1 -> AppStrings.translate(
                                    locale,
                                    "settings.devicesSignedOutOne",
                                )

                                else -> AppStrings.translate(
                                    locale,
                                    "settings.devicesSignedOutMany",
                                    mapOf("count" to result.sessions.toString()),
                                )
                            },
                        )
                        onChanged()
                    } catch (cause: Exception) {
                        actionError = cause.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

@Composable
private fun CrewDevicesCard(
    scope: SettingsScope,
    sessions: List<WorkspaceSession>,
    members: List<Member>,
    onChanged: () -> Unit,
) {
    val locale = LocalAppLocale.current
    val someoneOnTheCrew = t("settings.devicesCrewMemberFallback")
    val nothingSignedIn = t("settings.devicesTheyHadNothing")
    val nameByMember = members.associate { it.id to it.display_name.ifBlank { someoneOnTheCrew } }
    var target by remember { mutableStateOf<Pair<String, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    SettingsCard(
        title = t("settings.devicesCrewTitle"),
        description = t("settings.devicesCrewIntro"),
    ) {
        if (sessions.isEmpty()) {
            ReadOnlyLine(t("settings.devicesCrewNoneSignedIn"))
        }
        sessions.forEachIndexed { index, session ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val name = session.member_id?.let { nameByMember[it] } ?: someoneOnTheCrew
            DeviceRow(
                client = session.client,
                // The person comes first here: an owner is looking for WHOSE
                // phone, then where it is.
                secondary = session.location?.let { "$name · $it" } ?: name,
                signedInAt = session.signed_in_at,
                lastActiveAt = session.last_active_at,
                userAgent = null,
                current = false,
                action = {
                    val memberId = session.member_id
                    if (memberId != null) {
                        LinkButton(
                            onClick = { target = memberId to name },
                            enabled = !busy,
                        ) {
                            Text(
                                t("settings.devicesSignOut"),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
            )
        }
    }

    val current = target
    if (current != null) {
        val (memberId, name) = current
        val count = sessions.count { it.member_id == memberId }
        ConfirmDialog(
            title = t("settings.devicesSignMemberOutTitle", "name" to name),
            body = if (count == 1) {
                t("settings.devicesSignMemberOutBodyOne")
            } else {
                t("settings.devicesSignMemberOutBody", "count" to count.toString())
            },
            confirmLabel = t("settings.devicesSignThemOut"),
            destructive = true,
            pending = busy,
            error = actionError,
            onDismiss = { target = null },
            onConfirm = {
                haptics.reject()
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        val result = scope.repo.revokeMemberSessions(scope.companyId, memberId)
                        target = null
                        scope.showMessage(
                            when (result.sessions) {
                                0 -> nothingSignedIn
                                1 -> AppStrings.translate(
                                    locale,
                                    "settings.devicesSignedMemberOutOne",
                                    mapOf("name" to name),
                                )

                                else -> AppStrings.translate(
                                    locale,
                                    "settings.devicesSignedMemberOutMany",
                                    mapOf(
                                        "name" to name,
                                        "count" to result.sessions.toString(),
                                    ),
                                )
                            },
                        )
                        onChanged()
                    } catch (cause: Exception) {
                        actionError = cause.userMessage()
                    } finally {
                        busy = false
                    }
                }
            },
        )
    }
}

/**
 * One device row, built for RECOGNITION: the reader is scanning for the one
 * that is not theirs, so which app and roughly where are the headline. The
 * user agent is kept but last — it settles an argument, it does not start one.
 */
@Composable
private fun DeviceRow(
    client: String,
    secondary: String,
    signedInAt: String,
    lastActiveAt: String,
    userAgent: String?,
    current: Boolean,
    action: @Composable () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(
            clientIcon(client),
            contentDescription = null,
            tint = if (current) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            // #540: padding first, then size — the other instance of the same
            // slip. `.size(20.dp).padding(top = 2.dp)` leaves the device glyph
            // 18dp of height inside a 20dp box, so it draws squashed and one
            // pixel high of where the text expects it.
            modifier = Modifier.padding(top = 2.dp).size(20.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(deviceClientLabel(client), style = MaterialTheme.typography.bodyLarge)
                if (current) {
                    Spacer(Modifier.width(8.dp))
                    // Said before anything else about this row: the one device
                    // nobody should worry about.
                    StatusPill(t("settings.devicesThisDevice"), PillTone.Positive)
                }
            }
            Text(
                secondary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                t(
                    "settings.devicesLastActive",
                    "lastActive" to relativeTime(lastActiveAt),
                    "signedIn" to relativeTime(signedInAt),
                ),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
            )
            if (userAgent != null) {
                Text(
                    userAgent,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Spacer(Modifier.width(4.dp))
        action()
    }
}

/**
 * #289 — "download photos on Wi-Fi only, at minimum".
 *
 * One switch, and deliberately narrow. #240 made a thread and a gallery fetch a
 * bounded preview, so the expensive fetch left is the full-size original behind
 * a tap — which means this can wait for Wi-Fi without ever making the app look
 * broken on a job site. The supporting line says so, because a setting whose
 * blast radius is unclear is one nobody dares turn on.
 *
 * *Applying: Zen of Clarity — one control, and the sentence that makes it safe
 * to touch.*
 */
/**
 * #330 — the lock on this phone, beside the other setting that is about THIS
 * phone rather than the workspace.
 *
 * The device this app runs on is the tech's own: bought by them, carried
 * off-shift, and a spare one lives in the truck and gets handed to whoever is
 * covering the weekend. Nothing sat between "signed in" and "signed out".
 *
 * OFF BY DEFAULT, and the switch refuses where the phone cannot enforce it. A
 * toggle that flips on a device with no fingerprint and no screen lock would
 * leave somebody believing the phone in their glovebox was protected, which is
 * worse than not offering it — so the row says what to do instead.
 *
 * *Applying: Ethical Friction, in the one place friction belongs — a deliberate
 * pause in front of somebody else's customers.*
 */
@Composable
private fun AppLockCard(scope: SettingsScope) {
    val coroutines = rememberCoroutineScope()
    val context = LocalContext.current
    val enabled by scope.graph.prefs.appLockEnabled
        .collectAsStateWithLifecycle(initialValue = false)
    // Read once per composition: a person who goes to Settings and adds a screen
    // lock comes back to a screen that has recomposed.
    val canLock = remember(context) { deviceCanLock(context) }

    SettingsCard(
        title = t("settings.devicesAppLockTitle"),
        description = t("settings.devicesThisPhoneOnly"),
    ) {
        LabeledSwitchRow(
            label = t("settings.devicesAppLockLabel"),
            supporting = if (canLock) {
                t("settings.devicesAppLockHelp")
            } else {
                AppLock.CANNOT_ENABLE_NOTE
            },
            checked = enabled && canLock,
            enabled = canLock,
            onCheckedChange = { next ->
                coroutines.launch { scope.graph.prefs.setAppLockEnabled(next) }
            },
        )
    }
}

@Composable
private fun DataUseCard(scope: SettingsScope) {
    val coroutines = rememberCoroutineScope()
    val wifiOnly by scope.graph.prefs.wifiOnlyOriginals
        .collectAsStateWithLifecycle(initialValue = false)

    SettingsCard(
        title = t("settings.devicesMobileDataTitle"),
        description = t("settings.devicesThisPhoneOnly"),
    ) {
        LabeledSwitchRow(
            label = MeteredMedia.SETTING_LABEL,
            supporting = MeteredMedia.SETTING_DESCRIPTION,
            checked = wifiOnly,
            onCheckedChange = { next ->
                coroutines.launch { scope.graph.prefs.setWifiOnlyOriginals(next) }
            },
        )
    }
}
