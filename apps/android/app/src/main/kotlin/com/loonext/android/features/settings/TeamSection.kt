package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import com.loonext.android.core.roles.SelfDowngrade
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Invite
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberAccessExplanation
import com.loonext.android.core.model.numberAccessIsRestricted
import com.loonext.android.core.model.numberAccessLevelLabel
import com.loonext.android.core.model.numberAccessReason
import com.loonext.android.core.model.sortedForOwner
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
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
    /** #332: who owns it, and any handover in flight. Everyone sees this. */
    val ownership: Ownership,
)

private val EXPIRY_FORMAT = DateTimeFormatter.ofPattern("MMM d, yyyy")

private fun expiryDate(iso: String): String =
    runCatching { Instant.parse(iso) }.getOrNull()
        ?.atZone(ZoneId.systemDefault())?.format(EXPIRY_FORMAT) ?: iso

private fun isExpired(invite: Invite, now: Instant = Instant.now()): Boolean =
    runCatching { Instant.parse(invite.expires_at) }.getOrNull()?.isBefore(now) != false

/**
 * #315: every role names itself. The `else -> "Member"` this replaced was a
 * catch-all, so a view-only teammate rendered as "Member" — the app telling
 * the owner the opposite of what they had set. An unknown role from a newer
 * server now reads as itself rather than as a role it is not.
 */
private fun roleLabelKey(role: String): String? = when (role) {
    MemberRole.OWNER -> "settingsMore.roleOwner"
    MemberRole.ADMIN -> "settingsMore.roleAdmin"
    MemberRole.MEMBER -> "settingsMore.roleMember"
    MemberRole.READ_ONLY -> "settingsMore.roleReadOnly"
    MemberRole.BOOKKEEPER -> "settingsMore.roleBookkeeper"
    else -> null
}

/**
 * One role, in one language. Written as a function of the locale rather than
 * only as a composable, because the confirmation a role change writes ("Sam is
 * now admin.") is composed inside a coroutine, where there is no composition to
 * read from — and the two must never be able to name the role differently.
 *
 * A role this build has never heard of reads as ITSELF, the server's own word.
 * Never a catch-all "Member": that is the app telling an owner the opposite of
 * what they set.
 */
private fun roleLabelIn(locale: String?, role: String): String =
    roleLabelKey(role)?.let { AppStrings.translate(locale, it) }
        ?: role.replace('_', ' ').replaceFirstChar { it.uppercase() }

@Composable
private fun roleLabel(role: String): String = roleLabelIn(LocalAppLocale.current, role)

/** What each assignable role is FOR, in the words an owner picking one uses. */
@Composable
private fun roleBlurb(role: String): String = when (role) {
    MemberRole.ADMIN -> t("settingsMore.roleAdminBlurb")
    MemberRole.READ_ONLY -> t("settingsMore.roleReadOnlyBlurb")
    MemberRole.BOOKKEEPER -> t("settingsMore.roleBookkeeperBlurb")
    else -> t("settingsMore.roleMemberBlurb")
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
            ownership = scope.repo.ownership(scope.companyId),
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
            // #332: everybody sees this, including a plain member — a handover
            // in flight is exactly the thing a colleague is best placed to
            // notice is wrong.
            OwnershipCard(scope, data.ownership, data.members, onChanged = { refreshKey++ })
            if (canManage && data.invites != null) {
                InvitesCard(
                    scope = scope,
                    company = company,
                    members = data.members,
                    invites = data.invites,
                    onChanged = { refreshKey++ },
                )
            } else {
                SettingsCard(title = t("settingsMore.invites")) {
                    ReadOnlyLine(t("settingsMore.onlyAdminsInvite"))
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
        title = t("settingsMore.members"),
        description = t("settingsMore.membersDesc"),
    ) {
        active.forEachIndexed { index, member ->
            if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            MemberRow(scope, member, onChanged)
        }
        if (deactivated.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Text(
                t("settingsMore.deactivatedHeading"),
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
    // #538: the role this person has asked to give themselves, held until they
    // confirm. Null the rest of the time, which is almost always.
    var givingUp by remember { mutableStateOf<String?>(null) }

    val name = member.display_name.ifBlank { t("settingsMore.teammate") }
    val canChangeRole = SettingsRoleGate.canChangeRoleOf(scope.role, member)
    val canDeactivate = SettingsRoleGate.canDeactivate(scope.role, member, scope.me.user_id)
    var roleMenuOpen by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var confirmingDeactivate by remember { mutableStateOf(false) }
    // #348: what this person actually reaches, on demand.
    var showingAccess by remember { mutableStateOf(false) }
    if (showingAccess) {
        MemberAccessDialog(scope, member, name) { showingAccess = false }
    }
    var actionError by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    /**
     * #538: one path for both the menu and the confirmation, so the acknowledged
     * change cannot drift from the ordinary one.
     */
    fun changeRole(role: String, acknowledged: Boolean = false) {
        busy = true
        actionError = null
        coroutines.launch {
            try {
                scope.repo.setMemberRole(
                    scope.companyId, member.id, role,
                    confirmLosingAccess = acknowledged,
                )
                haptics.confirm()
                scope.showMessage(
                    AppStrings.translate(
                        locale,
                        "settingsMore.roleChanged",
                        mapOf(
                            "name" to name,
                            "role" to roleLabelIn(locale, role).lowercase(),
                        ),
                    ),
                )
                onChanged()
            } catch (cause: Exception) {
                scope.showMessage(cause.userMessage(locale))
            } finally {
                busy = false
            }
        }
    }

    // #538: before you take powers off yourself.
    //
    // Ethical friction, and only here: this is the one role change the person
    // making it cannot reverse. Not a typed confirmation — nothing is destroyed
    // and an owner restores a role in a tap, so making somebody type their
    // workspace name would be theatre, and theatre is what teaches people to
    // dismiss the dialogs that matter.
    givingUp?.let { role ->
        AlertDialog(
            onDismissRequest = { givingUp = null },
            title = { Text(t("settingsMore.giveUpAccessTitle")) },
            // The sentence comes from the shared rule, so the phone, the laptop
            // and the server agree about what a role costs.
            text = { Text(SelfDowngrade.warning(member.role, role) ?: "") },
            confirmButton = {
                // Says what happens rather than "OK", so somebody skimming the
                // buttons still reads the decision.
                TextButton(onClick = {
                    givingUp = null
                    changeRole(role, acknowledged = true)
                }) {
                    Text(
                        t(
                            "settingsMore.makeMeRole",
                            "role" to roleLabel(role).lowercase(),
                        ),
                    )
                }
            },
            dismissButton = {
                TextButton(onClick = { givingUp = null }) {
                    Text(t("settingsMore.keepMyAccess"))
                }
            },
        )
    }

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
                if (isSelf) t("settingsMore.nameYou", "name" to name) else name,
                style = MaterialTheme.typography.bodyLarge,
            )
            val deactivatedAt = member.deactivated_at
            Text(
                if (deactivatedAt != null) {
                    t("settingsMore.deactivatedAgo", "ago" to relativeTime(deactivatedAt))
                } else {
                    t("settingsMore.joinedAgo", "ago" to relativeTime(member.created_at))
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(8.dp))
        // #348: the access model was complete and entirely invisible. Quiet and
        // text-only, because it answers a question rather than being an action.
        if (member.deactivated_at == null) {
            LinkButton(onClick = { showingAccess = true }) {
                Text(t("settingsMore.numbersLink"))
            }
        }
        when {
            member.role == MemberRole.OWNER ->
                StatusPill(t("settingsMore.roleOwner"), PillTone.Positive)

            canChangeRole -> Column {
                LinkButton(onClick = { roleMenuOpen = true }, enabled = !busy) {
                    Text(if (busy) t("common.saving") else roleLabel(member.role))
                }
                DropdownMenu(
                    expanded = roleMenuOpen,
                    onDismissRequest = { roleMenuOpen = false },
                ) {
                    listOf(
                        MemberRole.ADMIN,
                        MemberRole.MEMBER,
                        MemberRole.READ_ONLY,
                        MemberRole.BOOKKEEPER,
                    )
                        .forEach { role ->
                        DropdownMenuItem(
                            text = { Text(roleLabel(role)) },
                            onClick = {
                                roleMenuOpen = false
                                if (role == member.role) return@DropdownMenuItem
                                // #538: TAKING POWERS OFF YOURSELF STOPS AND ASKS.
                                //
                                // Picking a lesser role for your own row loses the
                                // ability to change roles in the same tap — the
                                // ability that would let you change it back. The
                                // menu gave no sign of that, so an afternoon of
                                // chasing the owner started with two taps.
                                //
                                // Only for this person's own row, and only when it
                                // takes something away: a confirmation that fires
                                // on everything is one people learn to dismiss.
                                if (isSelf && SelfDowngrade.isDowngrade(member.role, role)) {
                                    givingUp = role
                                    return@DropdownMenuItem
                                }
                                changeRole(role)
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
            LinkButton(onClick = { confirmingDeactivate = true }, enabled = !busy) {
                Text(
                    t("settingsMore.deactivate"),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }

    if (confirmingDeactivate) {
        ConfirmDialog(
            title = t("settingsMore.deactivateTitle", "name" to name),
            body = t("settingsMore.deactivateBody"),
            confirmLabel = t("settingsMore.deactivate"),
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
                        scope.showMessage(
                            AppStrings.translate(
                                locale,
                                "settingsMore.deactivated",
                                mapOf("name" to name),
                            ),
                        )
                        onChanged()
                    } catch (cause: Exception) {
                        actionError = cause.userMessage(locale)
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
    val locale = LocalAppLocale.current
    val inviteClipLabel = t("settingsMore.inviteLinkClipLabel")
    val seat = seatUsage(
        activeMembers = countActiveMembers(members),
        pendingInvites = pendingInviteCount(invites),
        plan = company.plan,
        // #392: the server's number wins. A client copy higher than the API's
        // tells an owner they have room and then the invite is refused.
        servedLimit = company.seat_limit,
    )
    var email by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var role by remember { mutableStateOf(MemberRole.MEMBER) }
    var roleMenuOpen by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var formError by remember { mutableStateOf<String?>(null) }

    val pending = invites.filter { it.accepted_at == null && it.revoked_at == null }

    SettingsCard(title = t("settingsMore.inviteTeammate"), description = seat.line) {
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            enabled = !seat.full && !sending,
            label = { Text(t("settingsMore.email")) },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
        )
        Spacer(Modifier.height(8.dp))
        // #521: an owner knows why they are adding THIS person. The joining
        // orientation a new member already gets can only explain the product;
        // what their own crew expects of them is the part they would otherwise
        // have to ask a colleague about on day one.
        //
        // Optional in the strict sense: nothing below validates it, nothing
        // gates the Invite button on it, and an owner who never touches it
        // sends exactly the invite they sent yesterday.
        OutlinedTextField(
            value = note,
            // The column's CHECK, mirrored, by KEEPING the first 500 characters
            // rather than refusing the value that carries them. Refusing the
            // whole value leaves a pasted paragraph as an empty field with
            // nothing said about why, and makes a held key feel broken.
            onValueChange = { note = it.take(INVITE_NOTE_MAX) },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2,
            enabled = !seat.full && !sending,
            label = { Text(t("settingsMore.inviteNoteLabel")) },
            placeholder = { Text(t("settingsMore.inviteNotePlaceholder")) },
            supportingText = {
                // When they read it, and that it is one shot. An owner writing
                // here deserves to know both before they write something they
                // would not want read aloud: the words are gone the moment the
                // invite is sent, and no screen in this app can call them back.
                Text(t("settingsMore.inviteNoteOneShot"))
            },
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
                    // #315: a named preset that does not say what it is for is
                    // just a word. An owner picking a role for their accountant
                    // should not have to infer it from "member".
                    listOf(
                        MemberRole.MEMBER,
                        MemberRole.ADMIN,
                        MemberRole.READ_ONLY,
                        MemberRole.BOOKKEEPER,
                    )
                        .forEach { option ->
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(roleLabel(option))
                                        Text(
                                            roleBlurb(option),
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                },
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
                        formError =
                            AppStrings.translate(locale, "settingsMore.enterTeammateEmail")
                        return@Button
                    }
                    sending = true
                    formError = null
                    coroutines.launch {
                        try {
                            val invite = scope.repo.createInvite(
                                scope.companyId, trimmed, role, inviteNoteOrNull(note),
                            )
                            email = ""
                            // Cleared with the email: the next invite is for a
                            // different person, and re-sending one owner's words
                            // to a second teammate by accident is worse than
                            // retyping them.
                            note = ""
                            haptics.confirm()
                            if (invite.email_sent == false) {
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.inviteEmailFailed",
                                    ),
                                )
                            } else {
                                scope.showMessage(
                                    AppStrings.translate(
                                        locale,
                                        "settingsMore.inviteSentTo",
                                        mapOf("email" to trimmed),
                                    ),
                                )
                            }
                            onChanged()
                        } catch (cause: Exception) {
                            formError = cause.userMessage(locale)
                        } finally {
                            sending = false
                        }
                    }
                },
                enabled = !seat.full && !sending && email.isNotBlank(),
            ) {
                Text(
                    if (sending) t("settingsMore.inviting") else t("settingsMore.invite"),
                )
            }
        }
        InlineError(formError)
        if (seat.full) {
            Spacer(Modifier.height(6.dp))
            ReadOnlyLine(t("settingsMore.seatsFull"))
        }

        if (pending.isNotEmpty()) {
            Spacer(Modifier.height(14.dp))
            Text(
                t("settingsMore.pendingInvites"),
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
                            t(
                                "settingsMore.invitePending",
                                "role" to roleLabel(invite.role),
                                "when" to if (expired) {
                                    t("settingsMore.inviteExpired")
                                } else {
                                    t(
                                        "settingsMore.inviteExpires",
                                        "date" to expiryDate(invite.expires_at),
                                    )
                                },
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        // #521: what was said when this went out. Shown, never
                        // editable: the words are already in somebody's inbox,
                        // and a row that let an owner rewrite them would be
                        // rewriting a letter that has been read.
                        //
                        // Routed through the same emptiness rule the field
                        // writes with, so a row cannot draw a pair of quotation
                        // marks around nothing if a blank one ever reaches it.
                        val said = inviteNoteOrNull(invite.note)
                        if (said != null) {
                            Text(
                                "“$said”",
                                style = MaterialTheme.typography.bodySmall,
                                // `outline` is for hairlines and control edges.
                                // Against these two canvases it measures about
                                // 2:1, under the 4.5:1 that 12sp text has to
                                // clear. This is somebody's sentence, so it
                                // gets the secondary TEXT role instead.
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                    if (!expired) {
                        LinkButton(onClick = {
                            haptics.tap()
                            copyToClipboard(
                                context,
                                inviteClipLabel,
                                inviteLink(invite.id),
                            )
                            scope.showMessage(
                                AppStrings.translate(
                                    locale,
                                    "settingsMore.inviteLinkCopied",
                                ),
                            )
                        }) { Text(t("settingsMore.copyLink")) }
                    }
                    LinkButton(
                        onClick = {
                            haptics.reject()
                            revoking = true
                            coroutines.launch {
                                try {
                                    scope.repo.revokeInvite(scope.companyId, invite.id)
                                    scope.showMessage(
                                        AppStrings.translate(
                                            locale,
                                            "settingsMore.inviteRevoked",
                                        ),
                                    )
                                    onChanged()
                                } catch (cause: Exception) {
                                    scope.showMessage(cause.userMessage(locale))
                                } finally {
                                    revoking = false
                                }
                            }
                        },
                        enabled = !revoking,
                    ) {
                        Text(
                            if (revoking) {
                                t("settingsMore.revoking")
                            } else {
                                t("settingsMore.revoke")
                            },
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
    }
}


/**
 * #348 — what this person reaches on every number, and why.
 *
 * A DIALOG, not a section on the team list. Most workspaces have one to three
 * numbers and several people; inlining this would put a paragraph under every
 * row to answer a question an owner asks about one person, occasionally.
 *
 * RESTRICTED ROWS FIRST. Somebody opening this is checking a suspicion, not
 * reading a report, and a list that opens with unrestricted rows buries the one
 * that answers them.
 *
 * The reason line is the feature rather than decoration: PORTAL-UX section 3.1
 * asks a card to name the signal that placed it, and here the signal is the
 * whole screen. It also has to tell apart two states that read alike and are
 * not — nobody has restricted this number, versus somebody did and left this
 * person out.
 */
@Composable
private fun MemberAccessDialog(
    scope: SettingsScope,
    member: Member,
    name: String,
    onDismiss: () -> Unit,
) {
    var rows by remember { mutableStateOf<List<NumberAccessExplanation>?>(null) }
    var failed by remember { mutableStateOf(false) }
    // #228: the level pill and the reason clause are built by plain functions in
    // core/model, which default to English when nobody names a language. This
    // dialog is composition, so the reader's own is to hand.
    val locale = LocalAppLocale.current

    LaunchedEffect(member.user_id) {
        runCatching { scope.repo.memberNumberAccess(scope.companyId, member.user_id) }
            .onSuccess { rows = it.numbers.sortedForOwner() }
            .onFailure { failed = true }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { LinkButton(onClick = onDismiss) { Text(t("settingsMore.done")) } },
        title = { Text(t("settingsMore.memberNumbersTitle", "name" to name)) },
        text = {
            Column {
                Text(
                    t("settingsMore.memberNumbersDesc"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                val current = rows
                when {
                    failed -> Text(
                        t("settingsMore.memberAccessFailed"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    current == null -> Text(
                        t("settingsMore.checking"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    current.isEmpty() -> Text(
                        t("settingsMore.noNumbersInWorkspace"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    else -> current.forEachIndexed { index, row ->
                        if (index > 0) RowDivider()
                        Row(
                            Modifier.fillMaxWidth().padding(vertical = 9.dp),
                            verticalAlignment = Alignment.Top,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    row.number_e164 ?: t("settingsMore.aNumber"),
                                    style = MaterialTheme.typography.bodyMedium,
                                )
                                Text(
                                    numberAccessReason(
                                        row.decided_by,
                                        row.principal,
                                        locale = locale,
                                    ),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Spacer(Modifier.width(10.dp))
                            // Muted rather than red for a restriction: this is a
                            // settings readout, not an alarm, and most
                            // restrictions are somebody's deliberate choice.
                            StatusPill(
                                numberAccessLevelLabel(row.level, locale),
                                if (numberAccessIsRestricted(row.level)) {
                                    PillTone.Neutral
                                } else {
                                    PillTone.Positive
                                },
                            )
                        }
                    }
                }
            }
        },
    )
}
