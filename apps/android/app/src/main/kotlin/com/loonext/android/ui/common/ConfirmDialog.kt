package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t

/**
 * #733: the one confirm dialog. Calm body copy, an outline Cancel and a filled
 * confirm that turns error-red when [destructive], an inline error, and a
 * pending state that disables both buttons. The web twin is
 * `apps/web/src/components/ui/confirm-dialog.tsx`; [extraContent] is its
 * `children` (a typed-word field or a small extra body).
 *
 * `ConfirmDialogGuardTest` fails on a hand-built cancel + confirm
 * `AlertDialog` anywhere else. A dialog that is a form, a picker or a wizard
 * keeps its own `AlertDialog`, each named with its reason in that test.
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
    /**
     * Null hides the dismiss button AND the back/outside gesture, for the one
     * dialog that must not be closeable by accident: #314 shows recovery
     * codes exactly once, and a person who backs out of that screen has armed
     * a lock and thrown away the spare key. Everywhere else, leave it.
     */
    dismissLabel: String? = t("common.cancel"),
    confirmEnabled: Boolean = true,
    extraContent: (@Composable ColumnScope.() -> Unit)? = null,
    /** A body with a compact time in it: what a screen reader says in place of [body]. */
    bodySpoken: String? = null,
) {
    AlertDialog(
        onDismissRequest = { if (!pending && dismissLabel != null) onDismiss() },
        title = { Text(title) },
        text = {
            // #199 host type 4: the PLATFORM window keeps a floating dialog
            // above the keyboard (default DialogProperties). The debug guard
            // watches extraContent text fields (release-confirm, start-order)
            // in case that ever stops being true.
            Column(Modifier.assertAboveIme("dialog")) {
                Text(
                    body,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = if (bodySpoken == null) Modifier else Modifier.semantics { contentDescription = bodySpoken },
                )
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
            ) { Text(if (pending) t("settingsMore.working") else confirmLabel) }
        },
        dismissButton = dismissLabel?.let { label ->
            { OutlinedButton(onClick = onDismiss, enabled = !pending) { Text(label) } }
        },
    )
}

/**
 * A text button that LOOKS like one.
 *
 * #462: "Some buttons dont look like they are clickable in the settings even
 * though they are." Material's `TextButton` draws its label in
 * `colorScheme.primary`, and this theme maps primary to Ink — the same colour
 * as body text (`onSurface`). So every text button in settings rendered as a
 * line of ordinary prose: same colour, no fill, no border, nothing to say it
 * could be tapped. True in both themes; 17.05:1 on paper either way, which is
 * exactly the contrast of the paragraph next to it.
 *
 * Olive is what MOBILE-DESIGN.md reserves for "counts, LINKS, emphasis", and
 * it is what iOS has always tinted these with (`.tint(BrandColor.olive)`).
 * 4.41:1 light, 9.33:1 dark — legible on its own, and unmistakably not prose.
 */
@Composable
fun LinkButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    content: @Composable RowScope.() -> Unit,
) {
    TextButton(
        onClick = onClick,
        modifier = modifier,
        enabled = enabled,
        colors = ButtonDefaults.textButtonColors(
            contentColor = MaterialTheme.colorScheme.secondary,
        ),
        content = content,
    )
}

/** Calm one-sentence inline error under a form control. */
@Composable
fun InlineError(message: String?, modifier: Modifier = Modifier) {
    if (message != null) {
        androidx.compose.material3.Text(
            message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error,
            modifier = modifier.padding(top = 6.dp),
        )
    }
}
