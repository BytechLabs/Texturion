package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.draw.clip
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Backspace
import androidx.compose.material.icons.automirrored.outlined.Message
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.People
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.TextButton
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.contacts.device.DialerMatch
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.PreviewHarness
import com.loonext.android.ui.common.ResponsivePreviews
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import kotlinx.coroutines.launch

/** Digit → phone letters, straight from the spec keypad (03). */
private val KEYPAD_ROWS = listOf(
    listOf("1" to "", "2" to "ABC", "3" to "DEF"),
    listOf("4" to "GHI", "5" to "JKL", "6" to "MNO"),
    listOf("7" to "PQRS", "8" to "TUV", "9" to "WXYZ"),
    listOf("*" to "", "0" to "+", "#" to ""),
)

/**
 * Height the full-size dialer layout needs (#180). Viewports at or above it
 * render the spec exactly; shorter ones scale keys, spacing, the readout, and
 * the call disc down proportionally so everything stays reachable.
 */
private val DIALER_DESIGN_HEIGHT = 620.dp

/** Floor for the proportional scale; below it the backstop scroll takes over. */
private const val MIN_DIALER_SCALE = 0.55f

/**
 * The dialer (spec 03) — call ANY US/CA number: Bricolage number readout,
 * borderless paper key circles, lime call disc. From-number pills appear only
 * when the company owns several active numbers (a single-number company lets
 * the server imply it). The mic permission is preflighted BEFORE authorizing,
 * so a denial never reserves the line or bills a minute.
 */
@Composable
fun DialerSheet(
    manager: SoftphoneManager,
    numbers: List<PhoneNumberSummary>,
    onDismiss: () -> Unit,
    initialDigits: String = "",
    /**
     * #459: who the typed digits could be, best first. The caller merges the
     * crew's own contacts (server, name-searched via `t9=1`) with the device
     * address book and ranks both through one matcher, so this returns a list
     * rather than a name — "dial by name" IS this list.
     */
    lookupMatches: (suspend (digits: String) -> List<DialerMatch>)? = null,
    /** Offer "Add contact" for an unmatched dialable number. */
    onAddContact: ((e164: String) -> Unit)? = null,
    /** #459: text this number instead of calling it. */
    onMessage: ((number: String) -> Unit)? = null,
    /** #459: open a contact we already have on file. */
    onOpenContact: ((contactId: String) -> Unit)? = null,
    /** #459: leave the keypad for the contacts list. */
    onOpenContacts: (() -> Unit)? = null,
    /**
     * #183 part 2: whether device-contact correlation is live (READ_CONTACTS
     * granted). When false and [onDeviceContactsGranted] is set, the dialer
     * requests the permission on open with a clear rationale row — never at app
     * launch — and degrades to app-only correlation if the user declines.
     */
    deviceContactsGranted: Boolean = false,
    onDeviceContactsGranted: (() -> Unit)? = null,
) {
    val haptics = rememberHaptics()
    var digits by remember { mutableStateOf(initialDigits.take(15)) }
    var matches by remember { mutableStateOf<List<DialerMatch>>(emptyList()) }
    // Whoever was tapped in the list. Kept separate from the digits so editing
    // the number after picking somebody drops the pick: a call that went to the
    // person you tapped rather than the number on screen would be a call
    // nobody could explain.
    var picked by remember { mutableStateOf<DialerMatch?>(null) }
    if (lookupMatches != null) {
        // Re-key on the grant flag too: granting device access mid-session
        // re-correlates the already-typed number without waiting for a keystroke.
        LaunchedEffect(digits, deviceContactsGranted) {
            // TWO digits, not four: two keys is a normal way to reach for a
            // name ("Bo…"), and the matcher itself keeps the four-digit floor
            // for matching a NUMBER.
            if (digits.length < 2) {
                matches = emptyList()
                return@LaunchedEffect
            }
            kotlinx.coroutines.delay(250) // debounce keypad taps
            matches = runCatching { lookupMatches(digits) }.getOrDefault(emptyList())
        }
    }
    val target = picked ?: matches.firstOrNull()
    val matchedName = target?.name
    var fromId by remember { mutableStateOf(numbers.firstOrNull()?.id) }
    var calling by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val dialable = dialableE164(digits)

    // #183 part 2: contacts access is requested HERE, at the point of use, not
    // at launch. READ (dialer name matching) + WRITE (the app's own
    // Connected-Apps rows) are asked together — one system prompt, same
    // permission group. The grant callback lights up device correlation and
    // stands up the "Call/Text with Loonext" rows.
    val contactsPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        if (result[Manifest.permission.READ_CONTACTS] == true) {
            onDeviceContactsGranted?.invoke()
        }
    }
    fun requestContacts() = contactsPermissionLauncher.launch(
        arrayOf(Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS),
    )
    // Ask once when the dialer opens (Android suppresses the dialog silently
    // after a permanent denial, so this never nags). The rationale row below
    // lets the user opt in later on tap.
    var contactsAsked by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        if (onDeviceContactsGranted != null && !deviceContactsGranted && !contactsAsked) {
            contactsAsked = true
            requestContacts()
        }
    }

    fun placeCall() {
        val to = dialable ?: return
        error = null
        calling = true
        scope.launch {
            try {
                manager.placeCall(
                    displayName = formatPhone(to),
                    to = to,
                    // Pin a caller-ID number only when the company owns
                    // several; otherwise the server implies the one number.
                    phoneNumberId = if (numbers.size > 1) fromId else null,
                )
                onDismiss()
            } catch (cause: ApiException) {
                // Gate refusals arrive coded (usage_cap_reached,
                // subscription_inactive, conflict "line on another call",
                // validation_failed) with honest server copy — show it.
                error = cause.userMessage()
            } catch (cause: Exception) {
                error = cause.userMessage()
            } finally {
                calling = false
            }
        }
    }

    // #228: the permission-result callback is not composition, so the
    // sentence it may set is resolved from a locale read here.
    val locale = LocalAppLocale.current
    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            placeCall()
        } else {
            error = AppStrings.translate(locale, "contactsTasks.micNeeded")
        }
    }

    AppSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            // #180: the keypad derives from available space. At or above the
            // design height scale == 1f and the sheet is pixel-identical to
            // today; on short/square viewports keys, spacing, the readout, and
            // the call disc shrink together. The scroll is a backstop for
            // viewports shorter than the scale floor allows.
            val scale = (maxHeight / DIALER_DESIGN_HEIGHT).coerceIn(MIN_DIALER_SCALE, 1f)
            val keySpacing = 26.dp * scale
            val keySize = (72.dp * scale)
                .coerceAtMost((maxWidth - 52.dp - keySpacing * 2) / 3)
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 26.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (numbers.size > 1) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(
                            8.dp,
                            Alignment.CenterHorizontally,
                        ),
                    ) {
                        numbers.forEach { number ->
                            FromNumberPill(
                                label = t(
                                    "contactsTasks.fromNumber",
                                    "number" to formatPhone(number.number_e164),
                                ),
                                selected = fromId == number.id,
                                onClick = {
                                    haptics.tap()
                                    fromId = number.id
                                },
                            )
                        }
                    }
                } else {
                    numbers.firstOrNull()?.let { number ->
                        LineStatusRow(
                            text = t(
                                "contactsTasks.lineReady",
                                "number" to formatPhone(number.number_e164),
                            ),
                            dot = BrandColor.LimeBright,
                            textColor = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.padding(bottom = 6.dp),
                        )
                    }
                }

                Text(
                    if (digits.isEmpty()) {
                        t("contactsTasks.enterANumber")
                    } else {
                        formatAsYouDial(digits)
                    },
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontSize = 31.sp * scale,
                        letterSpacing = 0.01.em,
                    ),
                    color = if (digits.isEmpty()) {
                        MaterialTheme.colorScheme.outline
                    } else {
                        MaterialTheme.colorScheme.onBackground
                    },
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp * scale, bottom = 4.dp),
                )

                // Live contact correlation: the matched name while dialing, or an
                // Add-contact affordance once the number is dialable and unknown.
                val addTarget = if (matchedName == null && onAddContact != null) dialable else null
                Box(Modifier.height(26.dp), contentAlignment = Alignment.Center) {
                    when {
                        matchedName != null -> Text(
                            matchedName!!,
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.secondary,
                            maxLines = 1,
                        )

                        // #183 part 2: the clear rationale + opt-in when device
                        // correlation is off. Tapping re-requests READ_CONTACTS.
                        onDeviceContactsGranted != null && !deviceContactsGranted -> Text(
                            t("contactsTasks.matchNamesFromContacts"),
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.outline,
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable {
                                    haptics.tap()
                                    requestContacts()
                                }
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )
                    }
                }

                // #459: who this could be, best first — the list that makes the
                // keypad a name search. Between the readout and the keys, where
                // every system dialer has put it for fifteen years. Capped at
                // four by the matcher; the height cap keeps the keys reachable
                // when all four land.
                if (matches.isNotEmpty()) {
                    LazyColumn(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(max = 132.dp)
                            .padding(bottom = 8.dp),
                    ) {
                        items(matches, key = { it.number }) { match ->
                            DialerMatchRow(
                                match = match,
                                selected = picked?.number == match.number,
                                onClick = {
                                    haptics.tap()
                                    picked = match
                                    digits = match.number.filter(Char::isDigit).take(15)
                                },
                            )
                        }
                    }
                }

                KEYPAD_ROWS.forEach { row ->
                    Row(
                        Modifier.padding(bottom = 12.dp * scale),
                        horizontalArrangement = Arrangement.spacedBy(keySpacing),
                    ) {
                        row.forEach { (key, letters) ->
                            KeypadKey(
                                digit = key,
                                letters = letters,
                                onClick = {
                                    if (digits.length < 15) {
                                        haptics.tap()
                                        picked = null
                                        digits += key
                                    }
                                },
                                size = keySize,
                                textScale = scale,
                            )
                        }
                    }
                }

                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp * scale, bottom = 16.dp * scale),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // #459: the other verb, mirroring backspace on the right so
                    // the call disc stays centred. A trades crew texts more than
                    // it calls; this is secondary only because the screen is the
                    // dialer, not because texting matters less.
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        if (onMessage != null) {
                            IconButton(
                                onClick = {
                                    haptics.tap()
                                    val to = picked?.number ?: dialable
                                    if (to != null) {
                                        onDismiss()
                                        onMessage(to)
                                    }
                                },
                                enabled = dialable != null || picked != null,
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Outlined.Message,
                                    contentDescription = t("contactsTasks.sendMessageInstead"),
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    // The lime call disc (spec 03) — disabled until dialable.
                    val callInteraction = remember { MutableInteractionSource() }
                    Surface(
                        onClick = {
                            haptics.confirm()
                            if (manager.hasMicPermission()) {
                                placeCall()
                            } else {
                                micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                            }
                        },
                        enabled = dialable != null && !calling,
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.tertiary,
                        contentColor = MaterialTheme.colorScheme.onTertiary,
                        interactionSource = callInteraction,
                        modifier = Modifier
                            .size(68.dp * scale)
                            .pressScale(callInteraction)
                            .alpha(if (dialable != null && !calling) 1f else 0.45f),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            if (calling) {
                                LoadingIndicator(Modifier.size(24.dp * scale))
                            } else {
                                Icon(
                                    Icons.Outlined.Call,
                                    contentDescription = t("contactsTasks.call"),
                                    modifier = Modifier.size(26.dp * scale),
                                )
                            }
                        }
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        IconButton(
                            onClick = {
                                haptics.tap()
                                picked = null
                                digits = digits.dropLast(1)
                            },
                            enabled = digits.isNotEmpty(),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Backspace,
                                contentDescription = t("contactsTasks.deleteLastDigit"),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                // #459: the two ways out of the keypad. "Add contact" appears
                // only for a dialable number we do NOT have, because offering to
                // save somebody already on file is an offer that does nothing.
                if (onOpenContacts != null || onAddContact != null) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .padding(bottom = 8.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (onOpenContacts != null) {
                            TextButton(onClick = {
                                haptics.tap()
                                onDismiss()
                                onOpenContacts()
                            }) {
                                Icon(
                                    Icons.Outlined.People,
                                    contentDescription = null,
                                    modifier = Modifier.size(17.dp),
                                )
                                Text(
                                    t("contactsTasks.contactsTitle"),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                            }
                        } else {
                            Box {}
                        }

                        val openId = target?.contactId
                        when {
                            openId != null && onOpenContact != null -> TextButton(onClick = {
                                haptics.tap()
                                onDismiss()
                                onOpenContact(openId)
                            }) {
                                Text(
                                    t("contactsTasks.openContact"),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                )
                            }

                            addTarget != null && onAddContact != null -> TextButton(
                                onClick = {
                                    haptics.tap()
                                    onAddContact(addTarget)
                                },
                            ) {
                                Icon(
                                    Icons.Outlined.PersonAdd,
                                    contentDescription = null,
                                    modifier = Modifier.size(17.dp),
                                )
                                Text(
                                    t("contactsTasks.addContact"),
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    modifier = Modifier.padding(start = 6.dp),
                                )
                            }

                            else -> Box {}
                        }
                    }
                }

                error?.let {
                    Text(
                        it,
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(bottom = 16.dp),
                    )
                }
            }
        }
    }
}

/**
 * #180 responsive proof: the dialer body laid out at every ratio, driven by the
 * SAME proportional scale + backstop scroll as the live sheet (real [KeypadKey]
 * atoms). On a short/square viewport the keys shrink; below the scale floor the
 * scroll keeps the call disc reachable.
 */
@ResponsivePreviews
@Composable
private fun DialerBodyPreview() {
    PreviewHarness {
        val digits = "4155550134"
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val scale = (maxHeight / DIALER_DESIGN_HEIGHT).coerceIn(MIN_DIALER_SCALE, 1f)
            val keySpacing = 26.dp * scale
            val keySize = (72.dp * scale)
                .coerceAtMost((maxWidth - 52.dp - keySpacing * 2) / 3)
            Column(
                Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 26.dp, vertical = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                LineStatusRow(
                    text = t(
                        "contactsTasks.lineReady",
                        "number" to "(415) 555-0134",
                    ),
                    dot = BrandColor.LimeBright,
                    textColor = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(bottom = 6.dp),
                )
                Text(
                    formatAsYouDial(digits),
                    style = MaterialTheme.typography.headlineMedium.copy(
                        fontSize = 31.sp * scale,
                        letterSpacing = 0.01.em,
                    ),
                    color = MaterialTheme.colorScheme.onBackground,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp * scale, bottom = 4.dp),
                )
                Box(Modifier.height(26.dp))
                KEYPAD_ROWS.forEach { row ->
                    Row(
                        Modifier.padding(bottom = 12.dp * scale),
                        horizontalArrangement = Arrangement.spacedBy(keySpacing),
                    ) {
                        row.forEach { (key, letters) ->
                            KeypadKey(
                                digit = key,
                                letters = letters,
                                onClick = {},
                                size = keySize,
                                textScale = scale,
                            )
                        }
                    }
                }
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 6.dp * scale, bottom = 16.dp * scale),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.weight(1f)) {}
                    Surface(
                        onClick = {},
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.tertiary,
                        contentColor = MaterialTheme.colorScheme.onTertiary,
                        modifier = Modifier.size(68.dp * scale),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Outlined.Call,
                                contentDescription = t("contactsTasks.call"),
                                modifier = Modifier.size(26.dp * scale),
                            )
                        }
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        IconButton(onClick = {}) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Backspace,
                                contentDescription = t("contactsTasks.deleteLastDigit"),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * One row of the #459 match list: who this could be, and the number it dials.
 *
 * The number is shown beside the name rather than hidden behind it. A crew has
 * the same customer twice under two numbers often enough that a name alone is
 * not an answer, and the whole promise of the row is that tapping it dials the
 * right one.
 */
@Composable
private fun DialerMatchRow(
    match: DialerMatch,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        color = if (selected) {
            MaterialTheme.colorScheme.surfaceContainer
        } else {
            MaterialTheme.colorScheme.background
        },
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                match.name,
                style = MaterialTheme.typography.bodyMedium.copy(
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                modifier = Modifier.weight(1f, fill = false),
            )
            Box(Modifier.weight(1f)) {}
            Text(
                formatPhone(match.number),
                fontSize = 12.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}

/** Caller-ID picker pill: ink when selected, inset otherwise. */
@Composable
private fun FromNumberPill(label: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        shape = CircleShape,
        color = if (selected) {
            MaterialTheme.colorScheme.primary
        } else {
            MaterialTheme.colorScheme.surfaceContainer
        },
        contentColor = if (selected) {
            MaterialTheme.colorScheme.onPrimary
        } else {
            MaterialTheme.colorScheme.onSurfaceVariant
        },
    ) {
        Text(
            label,
            fontSize = 11.5.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 15.dp, vertical = 8.dp),
        )
    }
}
