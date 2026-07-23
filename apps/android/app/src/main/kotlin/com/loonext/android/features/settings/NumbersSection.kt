package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Member
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.NumberStatus
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.ResyncOnResume
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import java.util.UUID

/** Everything the numbers screen shows, loaded together. */
private data class NumbersData(
    val numbers: List<PhoneNumberSummary>,
    val ports: List<PortRequest>,
    val textEnablements: List<TextEnablementOrder>,
    val registration: RegistrationDetailPair,
)

/**
 * Numbers (#157): per-number cards with honest status states, the #106 access
 * dialog, owner-only typed-confirmation release, the add-a-number picker,
 * port-in tracker cards, text-enablement cards, and the 10DLC registration
 * stepper. Realtime `number.updated` / `registration.updated` / `port.updated`
 * events refetch (payloads are ID-only by design).
 */
@Composable
fun NumbersSection(
    scope: SettingsScope,
    company: CompanyView,
    onRefreshCompany: () -> Unit,
) {
    var refreshKey by remember { mutableIntStateOf(0) }
    // #176 cache-first: the whole numbers surface paints instantly from
    // StoreCache after the first in-process fetch; realtime and mutation
    // refreshKey bumps revalidate silently.
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = CacheKeys.numbers(scope.companyId),
        refreshKey = refreshKey,
    ) {
        NumbersData(
            numbers = scope.repo.numbers(scope.companyId).data,
            ports = scope.repo.ports(scope.companyId).data,
            textEnablements = scope.repo.textEnablements(scope.companyId).data,
            registration = scope.repo.registration(scope.companyId),
        )
    }
    LaunchedEffect(scope.companyId) {
        scope.graph.realtime.events.collect { event ->
            if (event.event == "number.updated" ||
                event.event == "registration.updated" ||
                event.event == "port.updated"
            ) {
                refreshKey++
            }
        }
    }
    // #215: this section had no reconnect subscriber — an in-foreground socket
    // re-JOIN must also refetch (a provisioning/10DLC frame may have been
    // skipped while the channel was down).
    LaunchedEffect(scope.companyId) {
        scope.graph.realtime.reconnected.collect { refreshKey++ }
    }
    // ...and a frame missed while backgrounded/blurred heals on return to the
    // foreground.
    ResyncOnResume(scope.companyId) { refreshKey++ }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 3)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 48.dp),
        )

        is LoadState.Ready -> {
            val data = current.value
            val refresh: () -> Unit = {
                refreshKey++
                onRefreshCompany()
            }
            // Ported/hosted rows in flight render ONLY through their tracker
            // cards below — never as a fake "under a minute" number card.
            val cards = data.numbers.filter { number ->
                number.source == "provisioned" || number.status == NumberStatus.ACTIVE
            }
            if (cards.isEmpty() && company.plan == null) {
                SettingsCard(title = "Your number") {
                    Text(
                        "No number yet. It's created automatically when your " +
                            "subscription starts.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            cards.forEach { number ->
                NumberCard(scope, company, number, onChanged = refresh)
            }
            AddNumberCard(scope, company, data.numbers, onChanged = refresh)
            PortsBlock(scope, company, data.ports, onChanged = refresh)
            TextEnableBlock(scope, company, data.textEnablements, onChanged = refresh)
            RegistrationBlock(scope, company, data.registration, onChanged = refresh)
        }
    }
}

// ---------------------------------------------------------------------------
// Per-number card
// ---------------------------------------------------------------------------

@Composable
private fun NumberCard(
    scope: SettingsScope,
    company: CompanyView,
    number: PhoneNumberSummary,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val canManage = SettingsRoleGate.canManageNumbers(scope.role)
    val canRelease = SettingsRoleGate.canReleaseNumber(scope.role)
    val released = number.status == NumberStatus.RELEASED
    var releasing by remember { mutableStateOf(false) }
    var managingAccess by remember { mutableStateOf(false) }
    var choosing by remember { mutableStateOf(false) }

    val display = number.number_e164?.let(::formatPhone)
        ?: number.requested_area_code?.let { "Area code $it" }
        ?: "Your number"

    SettingsCard(title = display) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            NumberStatusPill(number)
            Spacer(Modifier.width(8.dp))
            number.source?.let { source ->
                Text(
                    when (source) {
                        "ported" -> "Transferred in"
                        "hosted" -> "Text-enabled landline"
                        else -> "Loonext number"
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.weight(1f))
            val e164 = number.number_e164
            if (e164 != null && !released) {
                IconButton(onClick = {
                    haptics.tap()
                    copyToClipboard(context, "Phone number", e164)
                    scope.showMessage("Number copied.")
                }) {
                    Icon(
                        Icons.Filled.ContentCopy,
                        contentDescription = "Copy number",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }

        when {
            released -> {
                Text(
                    number.number_e164?.let(::formatPhone).orEmpty(),
                    style = MaterialTheme.typography.bodyMedium.copy(
                        textDecoration = TextDecoration.LineThrough,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                number.released_at?.let { at ->
                    Text(
                        "Released ${relativeTime(at)} ago.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            number.status == NumberStatus.SUSPENDED -> Text(
                "This number is suspended. Update your payment method under " +
                    "Settings › Billing to bring it back.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            number.status == NumberStatus.PROVISIONING -> Text(
                "We're setting up your number. This usually takes under a minute.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            number.status == NumberStatus.PROVISION_FAILED -> {
                Text(
                    failedNumberCopy(number),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (canManage && needsNumberChoice(number)) {
                    OutlinedButton(
                        onClick = { choosing = true },
                        modifier = Modifier.padding(top = 8.dp),
                    ) { Text("Choose a number") }
                }
            }
        }

        if (!released && number.status == NumberStatus.ACTIVE) {
            Row(modifier = Modifier.padding(top = 6.dp)) {
                if (canManage) {
                    TextButton(onClick = { managingAccess = true }) {
                        Text("Who can use this number")
                    }
                }
                if (canRelease && number.number_e164 != null) {
                    TextButton(onClick = { releasing = true }) {
                        Text(
                            "Release",
                            color = MaterialTheme.colorScheme.error,
                        )
                    }
                }
            }
            if (!canManage) {
                ReadOnlyLine("Only owners and admins can manage numbers.")
            }
        }
    }

    if (releasing && number.number_e164 != null) {
        ReleaseNumberDialog(
            scope = scope,
            number = number,
            onDismiss = { releasing = false },
            onReleased = {
                releasing = false
                onChanged()
            },
        )
    }
    if (managingAccess) {
        NumberAccessDialog(
            scope = scope,
            number = number,
            onDismiss = { managingAccess = false },
        )
    }
    if (choosing) {
        RemediateNumberFlow(
            scope = scope,
            company = company,
            number = number,
            onDismiss = { choosing = false },
            onDone = {
                choosing = false
                onChanged()
            },
        )
    }
}

@Composable
private fun NumberStatusPill(number: PhoneNumberSummary) {
    when (number.status) {
        NumberStatus.ACTIVE -> StatusPill("Active", PillTone.Positive)
        NumberStatus.PROVISIONING -> StatusPill("Setting up", PillTone.Warn)
        NumberStatus.SUSPENDED -> StatusPill("Suspended", PillTone.Warn)
        NumberStatus.RELEASED -> StatusPill("Released", PillTone.Neutral)
        NumberStatus.PROVISION_FAILED ->
            if (!needsNumberChoice(number)) {
                StatusPill("Setting up", PillTone.Warn)
            } else if (number.failure_reason == "timeout") {
                StatusPill("Action needed", PillTone.Warn)
            } else {
                StatusPill("Couldn't set up", PillTone.Bad)
            }

        else -> StatusPill(number.status, PillTone.Neutral)
    }
}

// ---------------------------------------------------------------------------
// Release (owner-only, type-the-number confirmation)
// ---------------------------------------------------------------------------

@Composable
private fun ReleaseNumberDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
    onReleased: () -> Unit,
) {
    val display = formatPhone(number.number_e164)
    var typed by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val expectedDigits = number.number_e164.orEmpty().filter(Char::isDigit)
    val typedDigits = typed.filter(Char::isDigit)
    val matches = expectedDigits.isNotEmpty() &&
        (typedDigits == expectedDigits || "1$typedDigits" == expectedDigits)

    ConfirmDialog(
        title = "Release $display?",
        body = "This gives the number up for good. Customers who text it won't reach " +
            "you, and you can't get the same number back. It doesn't change your plan " +
            "or what you pay. A number is included, so you can set up a new one here " +
            "afterward. Type the number to confirm.",
        confirmLabel = "Release number",
        destructive = true,
        pending = pending,
        error = error,
        confirmEnabled = matches,
        dismissLabel = "Keep the number",
        onDismiss = onDismiss,
        onConfirm = {
            haptics.reject()
            pending = true
            error = null
            coroutines.launch {
                try {
                    scope.repo.releaseNumber(scope.companyId, number.id)
                    scope.showMessage("$display released.")
                    onReleased()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
        extraContent = {
            OutlinedTextField(
                value = typed,
                onValueChange = { typed = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp),
                singleLine = true,
                enabled = !pending,
                label = { Text("Type $display to confirm") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            )
        },
    )
}

// ---------------------------------------------------------------------------
// #106 access dialog
// ---------------------------------------------------------------------------

private enum class AccessMode { Everyone, MembersView, Admins, Users }

@Composable
private fun NumberAccessDialog(
    scope: SettingsScope,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
) {
    var loaded by remember { mutableStateOf<LoadState<Pair<NumberAccess, List<Member>>>>(LoadState.Loading) }
    var retryKey by remember { mutableIntStateOf(0) }
    var mode by remember { mutableStateOf(AccessMode.Everyone) }
    var level by remember { mutableStateOf(NumberAccessLevel.TEXT) }
    var pickedUserIds by remember { mutableStateOf(setOf<String>()) }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    LaunchedEffect(number.id, retryKey) {
        loaded = LoadState.Loading
        loaded = try {
            val access = scope.repo.numberAccess(scope.companyId, number.id)
            val members = scope.repo.members(scope.companyId)
                .data.filter { it.deactivated_at == null && it.role == MemberRole.MEMBER }
            mode = when {
                access.access == NumberAccessKind.EVERYONE -> AccessMode.Everyone
                access.access == NumberAccessKind.ROLE && access.role == MemberRole.ADMIN ->
                    AccessMode.Admins

                access.access == NumberAccessKind.ROLE -> AccessMode.MembersView
                else -> AccessMode.Users
            }
            level = access.level ?: NumberAccessLevel.TEXT
            pickedUserIds = access.user_ids.toSet()
            LoadState.Ready(access to members)
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    val display = number.number_e164?.let(::formatPhone) ?: "this number"

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text("Who can use $display?") },
        text = {
            // #180: option rows stay reachable at any viewport height; the
            // member list keeps its own bounded scroll inside.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text(
                    "Owners and admins can always use every number.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(8.dp))
                when (val current = loaded) {
                    is LoadState.Loading -> LoadingIndicator()
                    is LoadState.Failed -> Column {
                        Text(
                            current.message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = { retryKey++ },
                            modifier = Modifier.padding(top = 8.dp),
                        ) { Text("Try again") }
                    }

                    is LoadState.Ready -> {
                        val members = current.value.second
                        AccessModeOptions(
                            mode = mode,
                            onMode = { mode = it },
                            enabled = !pending,
                        )
                        if (mode == AccessMode.Users) {
                            Spacer(Modifier.height(8.dp))
                            if (members.isEmpty()) {
                                Text(
                                    "No active members to pick. Everyone else on the " +
                                        "team is an owner or admin.",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            } else {
                                LazyColumn(Modifier.heightIn(max = 180.dp)) {
                                    items(members, key = { it.id }) { member ->
                                        val checked = member.user_id in pickedUserIds
                                        Row(
                                            Modifier
                                                .fillMaxWidth()
                                                .toggleable(
                                                    value = checked,
                                                    enabled = !pending,
                                                    onValueChange = { on ->
                                                        pickedUserIds =
                                                            if (on) pickedUserIds + member.user_id
                                                            else pickedUserIds - member.user_id
                                                    },
                                                )
                                                .padding(vertical = 4.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                        ) {
                                            Checkbox(checked = checked, onCheckedChange = null)
                                            Spacer(Modifier.width(8.dp))
                                            Text(
                                                member.display_name.ifBlank { "Teammate" },
                                                style = MaterialTheme.typography.bodyMedium,
                                            )
                                        }
                                    }
                                }
                                Spacer(Modifier.height(6.dp))
                                listOf(
                                    NumberAccessLevel.TEXT to "Can text",
                                    NumberAccessLevel.NOTE to "View & notes only",
                                ).forEach { (value, label) ->
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            .selectable(
                                                selected = level == value,
                                                enabled = !pending,
                                                onClick = { level = value },
                                            )
                                            .padding(vertical = 2.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        RadioButton(selected = level == value, onClick = null)
                                        Spacer(Modifier.width(6.dp))
                                        Text(label, style = MaterialTheme.typography.bodyMedium)
                                    }
                                }
                            }
                        }
                    }
                }
                InlineError(error)
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val ready = loaded as? LoadState.Ready ?: return@Button
                    val activeMemberIds =
                        ready.value.second.map { it.user_id }.toSet()
                    // Stale/deactivated selections are silently dropped (web parity).
                    val picked = pickedUserIds.intersect(activeMemberIds).toList()
                    if (mode == AccessMode.Users && picked.isEmpty()) {
                        error = "Pick at least one person, or choose Everyone."
                        return@Button
                    }
                    pending = true
                    error = null
                    coroutines.launch {
                        try {
                            scope.repo.setNumberAccess(
                                scope.companyId,
                                number.id,
                                buildAccessBody(mode, level, picked),
                            )
                            haptics.confirm()
                            scope.showMessage("Access to $display updated.")
                            onDismiss()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            pending = false
                        }
                    }
                },
                enabled = loaded is LoadState.Ready && !pending,
            ) { Text(if (pending) "Saving…" else "Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !pending) { Text("Cancel") }
        },
    )
}

private fun buildAccessBody(
    mode: AccessMode,
    level: String,
    pickedUserIds: List<String>,
): kotlinx.serialization.json.JsonObject = kotlinx.serialization.json.buildJsonObject {
    when (mode) {
        AccessMode.Everyone -> put(
            "access",
            kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.EVERYONE),
        )

        AccessMode.MembersView -> {
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.ROLE))
            put("role", kotlinx.serialization.json.JsonPrimitive(MemberRole.MEMBER))
            put("level", kotlinx.serialization.json.JsonPrimitive(NumberAccessLevel.NOTE))
        }

        AccessMode.Admins -> {
            // Admins always have full access; the level is moot — send 'text'.
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.ROLE))
            put("role", kotlinx.serialization.json.JsonPrimitive(MemberRole.ADMIN))
            put("level", kotlinx.serialization.json.JsonPrimitive(NumberAccessLevel.TEXT))
        }

        AccessMode.Users -> {
            put("access", kotlinx.serialization.json.JsonPrimitive(NumberAccessKind.USERS))
            put(
                "user_ids",
                kotlinx.serialization.json.JsonArray(
                    pickedUserIds.map { kotlinx.serialization.json.JsonPrimitive(it) },
                ),
            )
            put("level", kotlinx.serialization.json.JsonPrimitive(level))
        }
    }
}

@Composable
private fun AccessModeOptions(
    mode: AccessMode,
    onMode: (AccessMode) -> Unit,
    enabled: Boolean,
) {
    listOf(
        Triple(AccessMode.Everyone, "Everyone", "The whole team can text, like today."),
        Triple(
            AccessMode.MembersView,
            "Members: view & notes only",
            "Members can read and add notes, but not text. Admins still text.",
        ),
        Triple(AccessMode.Admins, "Admins only", "Members can't see this number at all."),
        Triple(
            AccessMode.Users,
            "Specific people",
            "Only the people you pick. Admins still text.",
        ),
    ).forEach { (value, label, detail) ->
        Row(
            Modifier
                .fillMaxWidth()
                .selectable(
                    selected = mode == value,
                    enabled = enabled,
                    onClick = { onMode(value) },
                )
                .padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RadioButton(selected = mode == value, onClick = null, enabled = enabled)
            Spacer(Modifier.width(8.dp))
            Column {
                Text(label, style = MaterialTheme.typography.bodyMedium)
                Text(
                    detail,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Add a number (buy) + remediation
// ---------------------------------------------------------------------------

@Composable
private fun AddNumberCard(
    scope: SettingsScope,
    company: CompanyView,
    numbers: List<PhoneNumberSummary>,
    onChanged: () -> Unit,
) {
    if (!SettingsRoleGate.canManageNumbers(scope.role) || !company.subscriptionActive) return
    val facts = planFacts(company.plan) ?: return

    val liveCount = numbers.count { it.status != NumberStatus.RELEASED }
    val starterAtCap = company.plan == "starter" && liveCount >= 2
    if (starterAtCap) return
    val nextIsExtra = liveCount >= facts.numbers
    val extraPrice = if (company.plan == "pro") "$4/mo" else "$5/mo"

    var picking by remember { mutableStateOf(false) }
    var idempotencyKey by remember { mutableStateOf("") }
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    SettingsCard(
        title = "Add a number",
        description = if (nextIsExtra) {
            "An extra number is $extraPrice, billed today. Your message allowance is " +
                "shared, so an extra number doesn't add messages."
        } else {
            "Choose the number your customers will text. It's included in your plan " +
                "at no extra cost."
        },
    ) {
        OutlinedButton(onClick = {
            // One key per attempt-intent: reused across retries of THIS
            // dialog, regenerated the next time it opens.
            idempotencyKey = UUID.randomUUID().toString()
            error = null
            picking = true
        }) { Text("Choose a number") }
    }

    if (picking) {
        NumberPickerDialog(
            scope = scope,
            country = company.country,
            initialAreaCode = company.requested_area_code.takeIf { it.isNotBlank() },
            title = "Choose a number",
            pending = pending,
            error = error,
            onDismiss = { if (!pending) picking = false },
            onPick = { choice ->
                pending = true
                error = null
                coroutines.launch {
                    try {
                        when (choice) {
                            is NumberChoice.Exact -> scope.repo.provisionNumber(
                                scope.companyId,
                                idempotencyKey,
                                chosenNumberE164 = choice.e164,
                            )

                            is NumberChoice.AreaCode -> scope.repo.provisionNumber(
                                scope.companyId,
                                idempotencyKey,
                                requestedAreaCode = choice.code,
                            )
                        }
                        picking = false
                        haptics.confirm()
                        scope.showMessage("Your number is being set up.")
                        onChanged()
                    } catch (cause: Exception) {
                        error = cause.userMessage()
                    } finally {
                        pending = false
                    }
                }
            },
        )
    }
}

@Composable
private fun RemediateNumberFlow(
    scope: SettingsScope,
    company: CompanyView,
    number: PhoneNumberSummary,
    onDismiss: () -> Unit,
    onDone: () -> Unit,
) {
    var pending by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    NumberPickerDialog(
        scope = scope,
        country = number.country,
        initialAreaCode = number.requested_area_code,
        title = "Choose a number to finish setup",
        pending = pending,
        error = error,
        onDismiss = { if (!pending) onDismiss() },
        onPick = { choice ->
            pending = true
            error = null
            coroutines.launch {
                try {
                    when (choice) {
                        is NumberChoice.Exact -> scope.repo.remediateNumber(
                            scope.companyId,
                            number.id,
                            chosenNumberE164 = choice.e164,
                        )

                        is NumberChoice.AreaCode -> scope.repo.remediateNumber(
                            scope.companyId,
                            number.id,
                            requestedAreaCode = choice.code,
                        )
                    }
                    haptics.confirm()
                    scope.showMessage("Setup restarted. You won't be charged again.")
                    onDone()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    pending = false
                }
            }
        },
    )
}
