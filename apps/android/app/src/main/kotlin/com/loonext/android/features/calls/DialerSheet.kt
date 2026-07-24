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
import androidx.compose.material.icons.outlined.Call
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
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.net.ApiException
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.AppSheet
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
    /** Resolve typed digits to a saved contact's name (null = no match). */
    lookupContact: (suspend (digits: String) -> String?)? = null,
    /** Offer "Add contact" for an unmatched dialable number. */
    onAddContact: ((e164: String) -> Unit)? = null,
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
    var matchedName by remember { mutableStateOf<String?>(null) }
    if (lookupContact != null) {
        // Re-key on the grant flag too: granting device access mid-session
        // re-correlates the already-typed number without waiting for a keystroke.
        LaunchedEffect(digits, deviceContactsGranted) {
            if (digits.length < 4) {
                matchedName = null
                return@LaunchedEffect
            }
            kotlinx.coroutines.delay(250) // debounce keypad taps
            matchedName = runCatching { lookupContact(digits) }.getOrNull()
        }
    }
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

    val micLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            placeCall()
        } else {
            error = "Loonext needs the microphone to place calls. " +
                "Allow it in Settings › Apps › Loonext › Permissions."
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
                                label = "From ${formatPhone(number.number_e164)}",
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
                            text = "Line ready · ${formatPhone(number.number_e164)}",
                            dot = BrandColor.LimeBright,
                            textColor = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.padding(bottom = 6.dp),
                        )
                    }
                }

                Text(
                    if (digits.isEmpty()) "Enter a number" else formatAsYouDial(digits),
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

                        addTarget != null -> Text(
                            "Add contact",
                            style = MaterialTheme.typography.labelLarge.copy(
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier
                                .clip(CircleShape)
                                .clickable {
                                    haptics.tap()
                                    onAddContact!!.invoke(addTarget)
                                }
                                .padding(horizontal = 10.dp, vertical = 4.dp),
                        )

                        // #183 part 2: the clear rationale + opt-in when device
                        // correlation is off. Tapping re-requests READ_CONTACTS.
                        onDeviceContactsGranted != null && !deviceContactsGranted -> Text(
                            "Match names from your contacts",
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
                    Box(Modifier.weight(1f)) {}
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
                                    contentDescription = "Call",
                                    modifier = Modifier.size(26.dp * scale),
                                )
                            }
                        }
                    }
                    Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                        IconButton(
                            onClick = {
                                haptics.tap()
                                digits = digits.dropLast(1)
                            },
                            enabled = digits.isNotEmpty(),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Outlined.Backspace,
                                contentDescription = "Delete last digit",
                                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
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
