package com.loonext.android.ui.common

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.onFocusedBoundsChanged
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.findRootCoordinates
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.loonext.android.BuildConfig
import com.loonext.android.core.diag.CallFlowLog
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest

/**
 * #199 - THE keyboard contract. A new screen must not be ABLE to ship with an
 * input under the keyboard, so IME handling is owned by HOSTS, never by
 * screens. Every text field in the app reaches the user through exactly one
 * of four host types, and each host applies the policy ONCE, here or via the
 * helpers here:
 *
 *  1. The shell route host (MainActivity's routed-overlay Surface, #187) and
 *     the pre-shell host (auth / external-step states) call [imeHost]:
 *     imePadding at the host + the debug guard. Inset consumption makes any
 *     leftover local imePadding inside a hosted screen a no-op, and
 *     ImeContractLintTest forbids the leftover outright.
 *  2. The shell tab pager (Shell.kt, #172) keeps its union-of-insets math
 *     (max(nav-bar + pill, ime) - NOT plain imePadding, so the pill clearance
 *     never stacks on the keyboard) and attaches [assertAboveIme] directly.
 *  3. Every ModalBottomSheet renders through [AppSheet], which PINS
 *     contentWindowInsets to safeDrawing top+bottom (safeDrawing INCLUDES the
 *     ime) instead of trusting the material3 default - a library upgrade
 *     cannot silently drop sheet keyboard avoidance - and attaches the guard.
 *     ImeContractLintTest forbids raw ModalBottomSheet calls outside this
 *     file.
 *  4. Floating dialog windows (AlertDialog / DatePickerDialog) keep the
 *     platform contract: default DialogProperties mean the WINDOW pans or
 *     resizes above the keyboard (SOFT_INPUT_ADJUST_UNSPECIFIED). App-authored
 *     dialog content with text fields attaches [assertAboveIme] as evidence;
 *     with decorFitsSystemWindows=true the dialog's compose tree may see zero
 *     ime insets, in which case the guard is inert - the platform already
 *     moved the window.
 *
 * Scroll-into-view: no bringIntoViewRequester anywhere. Compose foundation's
 * built-in focused-text-field relocation inside verticalScroll/LazyColumn is
 * the mechanism (verified in the #199 audit across settings SectionContainer,
 * sheet roots per #180, and the auth column); the debug guard below is what
 * keeps that implicit contract honest - if relocation ever fails to bring a
 * focused field above the keyboard, debug builds crash instead of shipping it.
 */

/** Minimum height of a focused field that must stay visible above the ime. */
private val MIN_VISIBLE_FIELD = 24.dp

/**
 * Settle-and-grace window: each ime-height change restarts the wait
 * (collectLatest), so the check runs only once the open animation has been
 * quiet this long - which also gives foundation's focus-scroll relocation
 * time to finish.
 */
private const val IME_SETTLE_GRACE_MS = 350L

/**
 * The pure #199 decision, unit-tested in ImeCoverageTest: with the keyboard
 * up, is the focused field effectively hidden? True when the field's visible
 * portion (its intersection with the viewport above the ime) is smaller than
 * both the field itself and [minVisiblePx] - so a tall multiline field whose
 * top half is visible passes, while a field fully (or all but a sliver)
 * under the keyboard fails.
 *
 * @param visibleBottomPx viewport bottom with the keyboard up: root height
 *   minus the ime inset, in px.
 */
fun imeCoverageViolation(
    fieldTopPx: Float,
    fieldBottomPx: Float,
    visibleBottomPx: Float,
    minVisiblePx: Float,
): Boolean {
    val height = fieldBottomPx - fieldTopPx
    if (height <= 0f) return false
    val visible = minOf(fieldBottomPx, visibleBottomPx) - maxOf(fieldTopPx, 0f)
    return visible < minOf(height, minVisiblePx)
}

/**
 * The host-side keyboard policy in one call: pad the ime AND (debug builds
 * only) verify the pad actually kept the focused field visible. Hosts that
 * cannot use plain imePadding (the shell pager's union math) attach
 * [assertAboveIme] alone.
 */
fun Modifier.imeHost(host: String): Modifier = imePadding().assertAboveIme(host)

/**
 * #199's debug guard: after the keyboard finishes animating in, the focused
 * text field's bounds must sit inside the viewport that remains above the
 * ime. On violation it logs loudly via [CallFlowLog] AND crashes - debug
 * builds only, release builds get `this` back untouched. Attached at the
 * host level (route host, pre-shell host, shell pager, AppSheet, dialog
 * content), so every screen a host renders is guarded for free.
 *
 * Mechanics: [onFocusedBoundsChanged] tracks the innermost focused child's
 * coordinates; a snapshotFlow of the (state-backed, animated) ime height
 * restarts the settle wait on every frame of the open animation
 * (collectLatest), so the check runs once, [IME_SETTLE_GRACE_MS] after the
 * keyboard stops moving, on bounds-in-root vs root-height-minus-ime.
 */
fun Modifier.assertAboveIme(host: String): Modifier =
    if (!BuildConfig.DEBUG) {
        this
    } else {
        composed {
            val density = LocalDensity.current
            val ime = WindowInsets.ime
            var focused by remember { mutableStateOf<LayoutCoordinates?>(null) }
            LaunchedEffect(ime, density) {
                snapshotFlow { ime.getBottom(density) }.collectLatest { imeBottom ->
                    // Keyboard closed (or ime insets never dispatched to this
                    // window, e.g. a platform-managed dialog): nothing to
                    // assert. A dispatched-but-animating height lands here
                    // again next frame and cancels this pass.
                    if (imeBottom <= 0) return@collectLatest
                    delay(IME_SETTLE_GRACE_MS)
                    val target = focused?.takeIf { it.isAttached } ?: return@collectLatest
                    val bounds = target.boundsInRoot()
                    val rootHeightPx = target.findRootCoordinates().size.height.toFloat()
                    val minVisiblePx = with(density) { MIN_VISIBLE_FIELD.toPx() }
                    if (imeCoverageViolation(
                            fieldTopPx = bounds.top,
                            fieldBottomPx = bounds.bottom,
                            visibleBottomPx = rootHeightPx - imeBottom,
                            minVisiblePx = minVisiblePx,
                        )
                    ) {
                        val message = "IME-COVERED INPUT on host '$host': focused " +
                            "field top=${bounds.top} bottom=${bounds.bottom} vs " +
                            "visible viewport bottom=${rootHeightPx - imeBottom} " +
                            "(root=$rootHeightPx ime=$imeBottom). The host contract " +
                            "(#199, ui/common/ImeContract.kt) is broken - fix the " +
                            "host, never the screen."
                        CallFlowLog.log("IME", message)
                        error(message)
                    }
                }
            }
            Modifier.onFocusedBoundsChanged { focused = it }
        }
    }

/**
 * THE modal bottom sheet (#199 host type 3). Identical to material3's
 * ModalBottomSheet except that keyboard behavior is pinned rather than
 * inherited: contentWindowInsets is EXPLICITLY safeDrawing top+bottom (what
 * 1.5.0-alpha24 defaults to today - safeDrawing includes the ime, so sheet
 * content pads above the keyboard), and the #199 debug guard rides the sheet
 * surface. Sheet roots keep the #180 contract (verticalScroll so every row
 * stays reachable at any viewport height); foundation's focus relocation
 * scrolls a focused field into view inside that scroll.
 *
 * ImeContractLintTest pins every feature sheet onto this wrapper - a raw
 * ModalBottomSheet outside this file fails the build.
 */
@Composable
fun AppSheet(
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
    sheetState: SheetState = rememberModalBottomSheetState(),
    shape: Shape = BottomSheetDefaults.ExpandedShape,
    containerColor: Color = BottomSheetDefaults.ContainerColor,
    content: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismissRequest,
        modifier = modifier.assertAboveIme("sheet"),
        sheetState = sheetState,
        shape = shape,
        containerColor = containerColor,
        contentWindowInsets = {
            WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Bottom)
        },
        content = content,
    )
}
