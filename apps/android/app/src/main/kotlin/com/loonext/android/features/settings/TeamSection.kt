package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Everything the team screen shows, loaded together. */
private data class TeamData(
    val members: List<Member>,
    /** null when the caller is a plain member (the invites list is admin+). */
    val invites: List<Invite>?,
)

private val EXPIRY_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy")

private fun expiryDate(iso: String): String =
    runCatching { Instant.parse(iso) }.getOrNull()
        ?.atZone(ZoneId.systemDefault())?.format(EXPIRY_FORMAT) ?: iso

private fun isExpired(invite: Invite, now: Instant = Instant.now()): Boolean =
    runCatching { Instant.parse(invite.expires_at) }.getOrNull()?.isBefore(now) != false

private fun roleLabel(role: String): String = when (role) {
    MemberRole.OWNER -> "Owner"
    MemberRole.ADMIN -> "Admin"
    else -> "Member"
}

/**
 * Team (#157): who can see and answer your customers' texts. Members list with
 * inline role change + deactivation (admin+), the invite form gated by the
 * seat formula, and the pending-invite list with the Copy-link fallback.
 */
@Composable
fun TeamSection(scope: SettingsScope, company: CompanyView) {
    val canManage = SettingsRoleGate.canManageTeam(scope.role)
    var refreshKey by remember { mutableIntStateOf(0) }
    // #176 cache-first: members + invites paint instantly from StoreCache
    // after the first in-process fetch; mutation-driven refreshKey bumps
    // revalidate silently.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.team(scope.companyId),
        refreshKey = refreshKey,
    ) {
        TeamData(
            members = scope.repo.members(scope.companyId).data,
            invites = if (canManage) scope.repo.invites(scope.companyId).data else null,
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
            MembersCard(scope, data.members, onChanged = { refreshKey++ })
            if (canManage && data.invites != null) {
                InvitesCard(
                    scope = scope,
                    company = company,
                    members = data.members,
                    invites = data.invites,
                    onChanged = { refreshKey++ },
                )
            } else {
                SettingsCard(title = "Invites") {
                    ReadOnlyLine("Only owners and admins can invite or deactivate teammates.")
                }
            }
        }
    }
}

@Composable
private fun MembersCard(scope: SettingsScope, members: List<Member>, onChanged: () -> Unit) {
    val active = members.filter { it.deactivated_at == null }
    val deactivated = members.filter { it.deactivated_at != null }

    SettingsCard(
        title = "Members",
        description = "Who can see and answer your customers' texts.",
    ) {
        active.forEachIndexed { index, member ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            MemberRow(scope, member, onChanged)
        }
        if (deactivated.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Text(
                "Deactivated",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(Modifier.alpha(0.6f)) {
                deactivated.forEach { member ->
                    MemberRow(scope, member, onChanged)
                }
            }
        }
    }
}

@Composable
private fun MemberRow(scope: SettingsScope, member: Member, onChanged: () -> Unit) {
    val isSelf = member.user_id == scope.me.user_id
    val name = member.display_name.ifBlank { "Teammate" }
    val canChangeRole = SettingsRoleGate.canChangeRoleOf(scope.role, member)
    val canDeactivate = SettingsRoleGate.canDeactivate(scope.role, member, scope.me.user_id)
    var roleMenuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirmingDeactivate by remember { mutableStateOf(false) }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name, size = 36.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(
                if (isSelf) "$name (you)" else name,
                style = MaterialTheme.typography.bodyLarge,
            )
            val deactivatedAt = member.deactivated_at
            Text(
                if (deactivatedAt != null) {
                    "Deactivated ${relativeTime(deactivatedAt)} ago"
                } else {
                    "Joined ${relativeTime(member.created_at)} ago"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(8.dp))
        when {
            member.role == MemberRole.OWNER ->
                StatusPill("Owner", PillTone.Positive)

            canChangeRole -> Column {
                TextButton(onClick = { roleMenuOpen = true }, enabled = !busy) {
                    Text(if (busy) "Saving…" else roleLabel(member.role))
                }
                DropdownMenu(
                    expanded = roleMenuOpen,
                    onDismissRequest = { roleMenuOpen = false },
                ) {
                    listOf(MemberRole.ADMIN, MemberRole.MEMBER).forEach { role ->
                        DropdownMenuItem(
                            text = { Text(roleLabel(role)) },
                            onClick = {
                                roleMenuOpen = false
                                if (role == member.role) return@DropdownMenuItem
                                busy = true
                                actionError = null
                                coroutines.launch {
                                    try {
                                        scope.repo.setMemberRole(
                                            scope.companyId, member.id, role,
                                        )
                                        haptics.confirm()
                                        scope.showMessage(
                                            "$name is now ${roleLabel(role).lowercase()}.",
                                        )
                                        onChanged()
                                    } catch (cause: Exception) {
                                        scope.showMessage(cause.userMessage())
                                    } finally {
                                        busy = false
                                    }
                                }
                            },
                        )
                    }
                }
            }

            else -> Text(
                roleLabel(member.role),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (canDeactivate) {
            Spacer(Modifier.width(4.dp))
            TextButton(onClick = { confirmingDeactivate = true }, enabled = !busy) {
                Text("Deactivate", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (confirmingDeactivate) {
        ConfirmDialog(
            title = "Deactivate $name?",
            body = "They lose access right away and their seat frees up. " +
                "Conversations and messages they worked on stay put.",
            confirmLabel = "Deactivate",
            destructive = true,
            pending = busy,
            error = actionError,
            onDismiss = { confirmingDeactivate = false },
            onConfirm = {
                haptics.reject()
                busy = true
                actionError = null
                coroutines.launch {
                    try {
                        scope.repo.deactivateMember(scope.companyId, member.id)
                        confirmingDeactivate = false
                        scope.showMessage("$name deactivated. Their seat is free.")
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
private fun InvitesCard(
    scope: SettingsScope,
    company: CompanyView,
    members: List<Member>,
    invites: List<Invite>,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val seat = seatUsage(
        activeMembers = countActiveMembers(members),
        pendingInvites = pendingInviteCount(invites),
        plan = company.plan,
    )
    var email by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(MemberRole.MEMBER) }
    var roleMenuOpen by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }

    val pending = invites.filter { it.accepted_at == null && it.revoked_at == null }

    SettingsCard(title = "Invite a teammate", description = seat.line) {
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !seat.full && !sending,
            label = { Text("Email") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column {
                OutlinedButton(
                    onClick = { roleMenuOpen = true },
                    enabled = !seat.full && !sending,
                ) { Text(roleLabel(role)) }
                DropdownMenu(
                    expanded = roleMenuOpen,
                    onDismissRequest = { roleMenuOpen = false },
                ) {
                    listOf(MemberRole.MEMBER, MemberRole.ADMIN).forEach { option ->
                        DropdownMenuItem(
                            text = { Text(roleLabel(option)) },
                            onClick = {
                                role = option
                                roleMenuOpen = false
                            },
                        )
                    }
                }
            }
            Spacer(Modifier.width(12.dp))
            Button(
                onClick = {
                    val trimmed = email.trim()
                    if (!trimmed.contains('@') || trimmed.length < 3) {
                        formError = "Enter the teammate's email address."
                        return@Button
                    }
                    sending = true
                    formError = null
                    coroutines.launch {
                        try {
                            val invite = scope.repo.createInvite(scope.companyId, trimmed, role)
                            email = ""
                            haptics.confirm()
                            if (invite.email_sent == false) {
                                scope.showMessage(
                                    "The invite email couldn't be sent. " +
                                        "Use Copy link below and share it yourself.",
                                )
                            } else {
                                scope.showMessage("Invite sent to $trimmed.")
                            }
                            onChanged()
                        } catch (cause: Exception) {
                            formError = cause.userMessage()
                        } finally {
                            sending = false
                        }
                    }
                },
                enabled = !seat.full && !sending && email.isNotBlank(),
            ) { Text(if (sending) "Inviting…" else "Invite") }
        }
        InlineError(formError)
        if (seat.full) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(
                "All seats are taken. Deactivate a teammate or revoke a pending invite first.",
            )
        }

        if (pending.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Text(
                "Pending invites",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            pending.forEach { invite ->
                val expired = isExpired(invite)
                var revoking by remember(invite.id) { mutableStateOf(false) }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(invite.email, style = MaterialTheme.typography.bodyMedium)
                        Text(
                            "${roleLabel(invite.role)} · " +
                                if (expired) "Expired, doesn't hold a seat"
                                else "Expires ${expiryDate(invite.expires_at)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (!expired) {
                        TextButton(onClick = {
                            haptics.tap()
                            copyToClipboard(context, "Invite link", inviteLink(invite.id))
                            scope.showMessage("Invite link copied.")
                        }) { Text("Copy link") }
                    }
                    TextButton(
                        onClick = {
                            haptics.reject()
                            revoking = true
                            coroutines.launch {
                                try {
                                    scope.repo.revokeInvite(scope.companyId, invite.id)
                                    scope.showMessage("Invite revoked.")
                                    onChanged()
                                } catch (cause: Exception) {
                                    scope.showMessage(cause.userMessage())
                                } finally {
                                    revoking = false
                                }
                            }
                        },
                        enabled = !revoking,
                    ) {
                        Text(
                            if (revoking) "Revoking…" else "Revoke",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}
