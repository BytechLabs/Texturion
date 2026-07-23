package com.loonext.android.features.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.userMessage

/** What the picker hands back: a US exact number, or a CA/masked area code. */
sealed interface NumberChoice {
    data class Exact(val e164: String) : NumberChoice
    data class AreaCode(val code: String) : NumberChoice
}

private fun isValidAreaCode(code: String): Boolean = Regex("^[2-9]\\d{2}$").matches(code)

/**
 * The choose-your-number picker (#157) over GET /v1/available-numbers: live
 * Telnyx inventory with an area-code filter, a client-side digit filter,
 * the masked-CA path (the pick becomes an area code assigned at order time),
 * and the honest "show nearby numbers" widen prompt when a code is exhausted.
 *
 * The caller performs the actual order (provision or remediate) — [pending]
 * and [error] surface that request's state inside the dialog.
 */
@Composable
fun NumberPickerDialog(
    scope: SettingsScope,
    country: String,
    initialAreaCode: String?,
    title: String,
    pending: Boolean,
    error: String?,
    onDismiss: () -> Unit,
    onPick: (NumberChoice) -> Unit,
) {
    var areaCode by remember { mutableStateOf(initialAreaCode.orEmpty()) }
    var digitFilter by remember { mutableStateOf("") }
    var bestEffort by remember { mutableStateOf(false) }
    var state by remember {
        mutableStateOf<LoadState<AvailableNumbersResult>>(LoadState.Loading)
    }
    var fetchKey by remember { mutableIntStateOf(0) }

    // Only a well-formed NANP code goes on the wire; partial input just types.
    val effectiveAreaCode = areaCode.takeIf { isValidAreaCode(it) }

    LaunchedEffect(effectiveAreaCode, bestEffort, fetchKey) {
        state = LoadState.Loading
        state = try {
            LoadState.Ready(
                scope.repo.availableNumbers(
                    country = country,
                    areaCode = effectiveAreaCode,
                    bestEffort = bestEffort,
                ),
            )
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(title) },
        text = {
            // #180: the dialog text scrolls so the refresh button below the
            // bounded results list is never squeezed out on short viewports.
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = areaCode,
                        onValueChange = { next ->
                            if (next.length <= 3 && next.all(Char::isDigit)) {
                                areaCode = next
                                bestEffort = false
                            }
                        },
                        modifier = Modifier.width(110.dp),
                        singleLine = true,
                        enabled = !pending,
                        label = { Text("Area code") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                    Spacer(Modifier.width(8.dp))
                    OutlinedTextField(
                        value = digitFilter,
                        onValueChange = { next ->
                            if (next.length <= 10 && next.all(Char::isDigit)) digitFilter = next
                        },
                        modifier = Modifier.weight(1f),
                        singleLine = true,
                        enabled = !pending,
                        label = { Text("Contains digits") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    )
                }
                Spacer(Modifier.height(10.dp))

                when (val current = state) {
                    is LoadState.Loading -> Box(
                        Modifier
                            .fillMaxWidth()
                            .padding(vertical = 28.dp),
                        contentAlignment = Alignment.Center,
                    ) { LoadingIndicator() }

                    is LoadState.Failed -> Column {
                        Text(
                            current.message,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        OutlinedButton(
                            onClick = { fetchKey++ },
                            modifier = Modifier.padding(top = 8.dp),
                        ) { Text("Try again") }
                    }

                    is LoadState.Ready -> PickerResults(
                        result = current.value,
                        country = country,
                        effectiveAreaCode = effectiveAreaCode,
                        digitFilter = digitFilter,
                        bestEffort = bestEffort,
                        pending = pending,
                        onWiden = { bestEffort = true },
                        onRefresh = { fetchKey++ },
                        onPick = onPick,
                    )
                }
                InlineError(error)
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !pending) { Text("Cancel") }
        },
    )
}

@Composable
private fun PickerResults(
    result: AvailableNumbersResult,
    country: String,
    effectiveAreaCode: String?,
    digitFilter: String,
    bestEffort: Boolean,
    pending: Boolean,
    onWiden: () -> Unit,
    onRefresh: () -> Unit,
    onPick: (NumberChoice) -> Unit,
) {
    // CA (masked) inventory: no exact numbers to list — the pick is the code.
    if (result.masked) {
        Column {
            Text(
                "Canadian numbers are assigned when the order goes through, so your " +
                    "pick here is the area code. There are numbers available" +
                    (if (effectiveAreaCode != null) " in $effectiveAreaCode" else "") + ".",
                style = MaterialTheme.typography.bodyMedium,
            )
            if (effectiveAreaCode == null) {
                Spacer(Modifier.height(6.dp))
                Text(
                    "Enter the 3-digit area code you want above.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Button(
                    onClick = { onPick(NumberChoice.AreaCode(effectiveAreaCode)) },
                    enabled = !pending,
                    modifier = Modifier.padding(top = 10.dp),
                ) { Text(if (pending) "Ordering…" else "Use area code $effectiveAreaCode") }
            }
        }
        return
    }

    if (result.best_effort_exhausted && !bestEffort) {
        Column {
            Text(
                "No numbers in " +
                    (effectiveAreaCode ?: "that area code") +
                    " right now. Nearby area codes usually have plenty.",
                style = MaterialTheme.typography.bodyMedium,
            )
            OutlinedButton(
                onClick = onWiden,
                enabled = !pending,
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("Show nearby numbers") }
        }
        return
    }

    val filtered = result.data.filter { matchesDigitFilter(it.phone_number, digitFilter) }
    if (filtered.isEmpty()) {
        Column {
            Text(
                if (digitFilter.isNotEmpty()) {
                    "No available number contains \"$digitFilter\". Loosen the filter " +
                        "or refresh for a new batch."
                } else {
                    "No numbers came back. Refresh for a new batch, or try another " +
                        "area code."
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(
                onClick = onRefresh,
                enabled = !pending,
                modifier = Modifier.padding(top = 8.dp),
            ) { Text("Refresh") }
        }
        return
    }

    Column {
        if (bestEffort) {
            Text(
                "Showing nearby numbers. The exact area code is out of stock.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 6.dp),
            )
        }
        LazyColumn(Modifier.heightIn(max = 320.dp)) {
            items(filtered, key = { it.phone_number }) { number ->
                Column(Modifier.animateItem()) {
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clickable(enabled = !pending) {
                                onPick(NumberChoice.Exact(number.phone_number))
                            }
                            .padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            formatPhone(number.phone_number),
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f),
                        )
                        number.region?.let { region ->
                            Text(
                                region,
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                }
            }
        }
        TextButton(onClick = onRefresh, enabled = !pending) { Text("Refresh the list") }
    }
}
