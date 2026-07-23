package com.loonext.android.features.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.core.net.toUri
import androidx.compose.ui.unit.dp
import com.loonext.android.ui.theme.BrandColor

/**
 * Shared settings primitives: hairline-bordered cards (never shadows), calm
 * status pills, confirm dialogs, and the external-browser opener the billing
 * surfaces require (store rules: hosted Stripe pages open in the REAL browser
 * via ACTION_VIEW, never a webview or custom tab).
 */

/** #178: every fair-use mention (Usage, Billing) links to the same policy. */
internal const val FAIR_USE_URL = "https://loonext.com/legal/fair-use"

@Composable
fun SettingsCard(
    title: String,
    description: String? = null,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp)
            .border(
                width = 1.dp,
                color = MaterialTheme.colorScheme.outlineVariant,
                shape = RoundedCornerShape(12.dp),
            )
            .padding(16.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium)
        if (description != null) {
            Text(
                description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(Modifier.height(12.dp))
        content()
    }
}

/** Honest read-only line for members ("Only owners and admins can…"). */
@Composable
fun ReadOnlyLine(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier,
    )
}

/** Calm one-sentence inline error under a form control. */
@Composable
fun InlineError(message: String?, modifier: Modifier = Modifier) {
    if (message != null) {
        Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier.padding(top = 6.dp),
        )
    }
}

@Composable
fun LabeledSwitchRow(
    label: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    enabled: Boolean = true,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            if (supporting != null) {
                Text(
                    supporting,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.width(12.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
}

enum class PillTone { Positive, Warn, Bad, Neutral }

/** Flat status pill: tinted background, no elevation (hairline system). */
@Composable
fun StatusPill(label: String, tone: PillTone, modifier: Modifier = Modifier) {
    val (bg, fg) = when (tone) {
        PillTone.Positive ->
            MaterialTheme.colorScheme.primaryContainer to
                MaterialTheme.colorScheme.onPrimaryContainer

        PillTone.Warn ->
            if (isSystemInDarkTheme()) {
                BrandColor.DarkAmberBg to BrandColor.DarkAmber
            } else {
                BrandColor.AmberBg to BrandColor.Amber
            }

        PillTone.Bad ->
            MaterialTheme.colorScheme.error.copy(alpha = 0.1f) to
                MaterialTheme.colorScheme.error

        PillTone.Neutral ->
            MaterialTheme.colorScheme.surfaceContainerHigh to
                MaterialTheme.colorScheme.onSurfaceVariant
    }
    Text(
        label,
        style = MaterialTheme.typography.labelSmall,
        color = fg,
        modifier = modifier
            .background(bg, RoundedCornerShape(percent = 50))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

/**
 * Shared confirmation dialog: calm body copy, optional destructive confirm,
 * inline error, and a pending state that disables both buttons.
 */
@Composable
fun ConfirmDialog(
    title: String,
    body: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = false,
    pending: Boolean = false,
    error: String? = null,
    dismissLabel: String = "Cancel",
    confirmEnabled: Boolean = true,
    extraContent: (@Composable ColumnScope.() -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = { if (!pending) onDismiss() },
        title = { Text(title) },
        text = {
            Column {
                Text(body, style = MaterialTheme.typography.bodyMedium)
                extraContent?.invoke(this)
                InlineError(error)
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = confirmEnabled && !pending,
                colors = if (destructive) {
                    ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    )
                } else {
                    ButtonDefaults.buttonColors()
                },
            ) { Text(if (pending) "Working…" else confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !pending) { Text(dismissLabel) }
        },
    )
}

fun copyToClipboard(context: Context, label: String, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
}

/**
 * Hosted Stripe pages and the fair-use policy open in the user's REAL
 * browser (ACTION_VIEW): store rules treat an embedded webview around an
 * external payment page as a violation, and a custom tab is not sufficient.
 */
fun openExternal(context: Context, url: String) {
    context.startActivity(
        Intent(Intent.ACTION_VIEW, url.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
    )
}
