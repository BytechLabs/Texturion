package com.loonext.android.features.calls

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.net.ApiException
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch

private val KEYPAD_ROWS = listOf(
    listOf("1", "2", "3"),
    listOf("4", "5", "6"),
    listOf("7", "8", "9"),
    listOf("*", "0", "#"),
)

/**
 * The dialer — call ANY US/CA number. From-number chips appear only when the
 * company owns several active numbers (a single-number company lets the
 * server imply it). The mic permission is preflighted BEFORE authorizing, so
 * a denial never reserves the line or bills a minute.
 */
@Composable
fun DialerSheet(
    manager: SoftphoneManager,
    numbers: List<PhoneNumberSummary>,
    onDismiss: () -> Unit,
) {
    var digits by remember { mutableStateOf("") }
    var fromId by remember { mutableStateOf(numbers.firstOrNull()?.id) }
    var calling by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val dialable = dialableE164(digits)

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

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                if (digits.isEmpty()) "Enter a number" else formatAsYouDial(digits),
                style = MaterialTheme.typography.headlineSmall,
                color = if (digits.isEmpty()) {
                    MaterialTheme.colorScheme.onSurfaceVariant
                } else {
                    MaterialTheme.colorScheme.onSurface
                },
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 12.dp),
            )

            if (numbers.size > 1) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(bottom = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                ) {
                    numbers.forEach { number ->
                        FilterChip(
                            selected = fromId == number.id,
                            onClick = { fromId = number.id },
                            label = { Text("From ${formatPhone(number.number_e164)}") },
                        )
                    }
                }
            }

            KEYPAD_ROWS.forEach { row ->
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    row.forEach { key ->
                        TextButton(
                            onClick = { if (digits.length < 15) digits += key },
                            modifier = Modifier
                                .weight(1f)
                                .height(60.dp),
                        ) {
                            Text(key, style = MaterialTheme.typography.headlineSmall)
                        }
                    }
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp, bottom = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.weight(1f)) {}
                FilledIconButton(
                    onClick = {
                        if (manager.hasMicPermission()) {
                            placeCall()
                        } else {
                            micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                        }
                    },
                    enabled = dialable != null && !calling,
                    modifier = Modifier.size(64.dp),
                ) {
                    if (calling) {
                        LoadingIndicator(Modifier.size(24.dp))
                    } else {
                        Icon(Icons.Filled.Call, contentDescription = "Call")
                    }
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    IconButton(
                        onClick = { digits = digits.dropLast(1) },
                        enabled = digits.isNotEmpty(),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Backspace,
                            contentDescription = "Delete last digit",
                        )
                    }
                }
            }

            error?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(bottom = 16.dp),
                )
            }
        }
    }
}
