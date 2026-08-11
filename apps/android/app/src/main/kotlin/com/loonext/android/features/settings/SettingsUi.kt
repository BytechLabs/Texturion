package com.loonext.android.features.settings

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.assertAboveIme
import com.loonext.android.ui.theme.BrandColor

/**
 * Shared settings primitives: paper cards (never shadows, never a hairline
 * outline — MOBILE-DESIGN.md "Grammar": paper, radius 22), calm status pills,
 * confirm dialogs, and the external-browser opener the billing surfaces
 * require (store rules: hosted Stripe pages open in the REAL browser via
 * ACTION_VIEW, never a webview or custom tab).
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
            // #462: "In light mode, some sections are very hard to determine,
            // like in dark mode the borders are legible, not in light mode."
            //
            // This card was TRANSPARENT with a 1dp `outlineVariant` border at
            // radius 12, and that is three departures from MOBILE-DESIGN.md,
            // which says cards are "paper, radius 22 … rows inside with 1px
            // #F0F0E8 dividers (outlineVariant)". `outlineVariant` is the
            // token for dividers INSIDE a card, not for its edge.
            //
            // The measurements say the rest: that border was ΔL* 1.1 against
            // the light canvas (#F0F0E8 on #F3F3EE) and ΔL* 7.6 against the
            // dark one. One bug, visible in exactly one theme — which is why
            // it read as a light-mode problem. The paper fill is the
            // separation, in both themes, and it is what iOS has always drawn.
            .background(
                color = MaterialTheme.colorScheme.surface,
                shape = MaterialTheme.shapes.large,
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
    /**
     * Null hides the dismiss button AND the back/outside gesture, for the one
     * dialog that must not be closeable by accident: #314 shows recovery
     * codes exactly once, and a person who backs out of that screen has armed
     * a lock and thrown away the spare key. Everywhere else, leave it.
     */
    dismissLabel: String? = t("common.cancel"),
    confirmEnabled: Boolean = true,
    extraContent: (@Composable ColumnScope.() -> Unit)? = null,
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
            ) { Text(if (pending) t("settingsMore.working") else confirmLabel) }
        },
        dismissButton = dismissLabel?.let { label ->
            { LinkButton(onClick = onDismiss, enabled = !pending) { Text(label) } }
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

/**
 * How loudly a [ReachNote] speaks.
 *
 * [Neutral] is the default because most notes explain a limit the owner has
 * already accepted. [Warn] is for the notes that report a CONTRADICTION the
 * owner has not seen — where the setting and the copy disagree — and it exists
 * because a muted grey line reads as an optional tip, which is the one thing
 * such a note must never read as.
 */
enum class NoteTone { Neutral, Warn }

/**
 * A quiet line under a switch, for a feature that is ON but cannot reach every
 * customer yet. Says which destinations it will not reach and why, so a switch
 * never reads as working when it is not.
 *
 * #453: [NoteTone.Warn] carries the amber of [PillTone.Warn] — the same colour
 * this app already uses for "needs attention" — and announces itself, because
 * the warning it carries is that an away message is promising an emergency
 * path that is switched off. Web styles that state as a warning with
 * `role="alert"`; matching it here is what keeps the three clients honest.
 */
@Composable
fun ReachNote(
    text: String,
    modifier: Modifier = Modifier,
    tone: NoteTone = NoteTone.Neutral,
) {
    val (bg, fg) = when (tone) {
        NoteTone.Neutral ->
            MaterialTheme.colorScheme.surfaceContainerHigh to
                MaterialTheme.colorScheme.onSurfaceVariant

        NoteTone.Warn ->
            if (isSystemInDarkTheme()) {
                BrandColor.DarkAmberBg to BrandColor.DarkAmber
            } else {
                BrandColor.AmberBg to BrandColor.Amber
            }
    }
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = fg,
        modifier = modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .background(bg, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .then(
                // Polite, not Assertive: it should be read when TalkBack
                // reaches a natural break, not cut off the label the owner
                // just toggled.
                if (tone == NoteTone.Warn) {
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite }
                } else {
                    Modifier
                },
            ),
    )
}
