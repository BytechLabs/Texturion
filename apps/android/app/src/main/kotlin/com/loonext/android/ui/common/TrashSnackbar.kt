package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Row
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Snackbar
import androidx.compose.material3.SnackbarData
import androidx.compose.material3.SnackbarDefaults
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarVisuals
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/**
 * #710/#735: where "View Trash" goes. The route host provides the action that
 * pushes the native Trash screen; a screen shown outside the host (a preview,
 * a test) has nothing to open, so the default does nothing.
 */
val LocalOpenTrash = staticCompositionLocalOf<() -> Unit> { {} }

/**
 * A delete notice: the Undo, plus a second "View Trash" action. Material's
 * snackbar carries one action, so [TrashSnackbarHost] draws both side by side
 * whenever the visuals are this type.
 */
class TrashSnackbarVisuals(
    override val message: String,
    override val actionLabel: String,
    val trashLabel: String,
) : SnackbarVisuals {
    override val withDismissAction: Boolean = false
    override val duration: SnackbarDuration = SnackbarDuration.Indefinite
}

/** The labels of the actions a snackbar shows, in order. Pure, for tests. */
fun snackbarActionLabels(visuals: SnackbarVisuals): List<String> = listOfNotNull(
    visuals.actionLabel,
    (visuals as? TrashSnackbarVisuals)?.trashLabel,
)

/** A [SnackbarHost] that also draws the "View Trash" action of a delete notice. */
@Composable
fun TrashSnackbarHost(state: SnackbarHostState, modifier: Modifier = Modifier) {
    val openTrash = LocalOpenTrash.current
    SnackbarHost(state, modifier) { data: SnackbarData ->
        val visuals = data.visuals
        if (visuals is TrashSnackbarVisuals) {
            Snackbar(
                actionOnNewLine = true,
                action = {
                    Row {
                        TextButton(
                            onClick = { data.performAction() },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = SnackbarDefaults.actionColor,
                            ),
                        ) { Text(visuals.actionLabel) }
                        TextButton(
                            onClick = {
                                data.dismiss()
                                openTrash()
                            },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = SnackbarDefaults.actionColor,
                            ),
                        ) { Text(visuals.trashLabel) }
                    }
                },
            ) { Text(visuals.message) }
        } else {
            Snackbar(data)
        }
    }
}
