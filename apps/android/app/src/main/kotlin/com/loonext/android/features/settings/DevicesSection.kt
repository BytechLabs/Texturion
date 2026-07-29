package com.loonext.android.features.settings

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
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
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

    SettingsCard(
        title = "Your devices",
        description = "Anything signed in as you, in any workspace. " +
            "Signing one out takes effect on its next tap.",
    ) {
        if (ordered.isEmpty()) {
            ReadOnlyLine(
                "Nothing is signed in — which cannot be true, since you are reading " +
                    "this. Pull to refresh and check again.",
            )
        }
        ordered.forEachIndexed { index, session ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            DeviceRow(
                client = session.client,
                secondary = session.location ?: "Location not available",
                signedInAt = session.signed_in_at,
                lastActiveAt = session.last_active_at,
                userAgent = session.user_agent,
                current = session.current,
                action = {
                    // No confirm on a single device of your own: it is small
                    // and reversible (they sign back in). The pause is spent
                    // on the two actions that are not.
                    if (!session.current) {
                        TextButton(
                            onClick = {
                                busy = true
                                coroutines.launch {
                                    try {
                                        scope.repo.revokeMySession(session.id)
                                        haptics.confirm()
                                        scope.showMessage("Signed that device out.")
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
                            Text("Sign out", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                Text("Sign out everywhere else")
            }
        }
    }

    if (confirmingAll) {
        ConfirmDialog(
            title = "Sign out everywhere else?",
            body = "${deviceCountLabel(others)} will stop working on the next tap, and " +
                "stop receiving your customers' messages. You stay signed in here. " +
                "Anyone who should still have access can sign back in.",
            confirmLabel = "Sign them out",
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
                            if (result.sessions == 0) {
                                "Nothing else was signed in."
                            } else {
                                "Signed out ${deviceCountLabel(result.sessions)}."
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
    val nameByMember = members.associate { it.id to it.display_name.ifBlank { "A crew member" } }
    var target by remember { mutableStateOf<Pair<String, String>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    SettingsCard(
        title = "The crew's devices",
        description = "Everything signed in to this workspace. Removing someone already " +
            "ends their access — this is for a phone that went missing while they are " +
            "still on the team.",
    ) {
        if (sessions.isEmpty()) {
            ReadOnlyLine("Nobody on the crew has anything signed in right now.")
        }
        sessions.forEachIndexed { index, session ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val name = session.member_id?.let { nameByMember[it] } ?: "A crew member"
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
                        TextButton(
                            onClick = { target = memberId to name },
                            enabled = !busy,
                        ) {
                            Text("Sign out", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            title = "Sign $name out?",
            body = "Every device they are signed in on — ${deviceCountLabel(count)} right " +
                "now — stops working on its next tap and stops receiving this workspace's " +
                "messages. They keep their seat and can sign back in; a call they are on " +
                "right now is not cut off.",
            confirmLabel = "Sign them out",
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
                            if (result.sessions == 0) {
                                "They had nothing signed in."
                            } else {
                                "Signed $name out of ${deviceCountLabel(result.sessions)}."
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
            modifier = Modifier.size(20.dp).padding(top = 2.dp),
        )
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(deviceClientLabel(client), style = MaterialTheme.typography.bodyLarge)
                if (current) {
                    Spacer(Modifier.width(8.dp))
                    // Said before anything else about this row: the one device
                    // nobody should worry about.
                    StatusPill("This device", PillTone.Positive)
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
                "Last active ${relativeTime(lastActiveAt)} · signed in " +
                    relativeTime(signedInAt),
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
