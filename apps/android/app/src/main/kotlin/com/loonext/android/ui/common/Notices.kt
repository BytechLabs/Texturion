package com.loonext.android.ui.common

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import kotlinx.coroutines.withTimeoutOrNull

/**
 * #733: the two notices that carry an action. The web twins are
 * `optimistic-undo.tsx` (Undo) and `created-toast.ts` (Open); both last
 * [NOTICE_ACTION_WINDOW_MS]. That is twice web's 5 seconds on purpose: a phone
 * undo follows a gesture that can be made by accident (docs/UNDO-AUDIT.md §3),
 * and iOS holds the same 10 seconds (`Toast.undoSeconds`).
 *
 * Anything the product can put back says so through [showUndo]. Something made
 * elsewhere, which this screen cannot show, says so through [showOpen]. A delete
 * that cannot be put back asks first through `ConfirmDialog` and then reports
 * plainly with `showSnackbar(message)`. `NoticeGuardTest` fails on an action
 * label handed to `showSnackbar` anywhere else.
 */
const val NOTICE_ACTION_WINDOW_MS = 10_000L

/**
 * Shows [message] with one Undo for [NOTICE_ACTION_WINDOW_MS]; [onUndo] runs if
 * it is pressed. A non-null [trashLabel] adds the "View Trash" action beside it
 * (see [TrashSnackbarHost]).
 */
suspend fun SnackbarHostState.showUndo(
    message: String,
    undoLabel: String,
    trashLabel: String? = null,
    onUndo: suspend () -> Unit,
) {
    val visuals = if (trashLabel != null) {
        TrashSnackbarVisuals(message, undoLabel, trashLabel)
    } else {
        null
    }
    val result = withTimeoutOrNull(NOTICE_ACTION_WINDOW_MS) {
        if (visuals != null) {
            showSnackbar(visuals)
        } else {
            showSnackbar(message = message, actionLabel = undoLabel, duration = SnackbarDuration.Indefinite)
        }
    }
    if (result == SnackbarResult.ActionPerformed) onUndo()
}

/** Shows [message] with one Open for [NOTICE_ACTION_WINDOW_MS]; [onOpen] runs if it is pressed. */
suspend fun SnackbarHostState.showOpen(
    message: String,
    openLabel: String,
    onOpen: suspend () -> Unit,
) {
    val result = withTimeoutOrNull(NOTICE_ACTION_WINDOW_MS) {
        showSnackbar(message = message, actionLabel = openLabel, duration = SnackbarDuration.Indefinite)
    }
    if (result == SnackbarResult.ActionPerformed) onOpen()
}
