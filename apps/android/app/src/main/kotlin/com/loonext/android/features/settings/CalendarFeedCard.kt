package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * #245 — your scheduled work, in the calendar you already use. The Android half
 * of the web's card on Settings → Profile & account.
 *
 * ## What it has to do
 *
 * One decision ("do I want this?") and one irreversible moment ("here is the
 * URL, it will not be shown again"). Somebody arriving here either has no feed
 * and wants one, or has one and wants it gone; nothing else is offered, and the
 * explanation is two sentences rather than a paragraph about calendar standards.
 * *Applying: Prioritize Intent.*
 *
 * ## The three decisions carried over from web, and how each lands on a phone
 *
 * **The URL is shown once, then gone.** Keeping a live credential on a settings
 * screen is a hazard with no upside, and the server could not show it again
 * anyway — only a hash is stored. It lives in a `remember` inside this
 * composable, so backing out of Settings forgets it exactly as pressing Done
 * does. It is a CARD THAT STAYS ON SCREEN and not a snackbar, for the reason the
 * API-keys screen next door records: the thing exists once in the product's
 * whole life, and a snackbar is gone in four seconds — usually while the person
 * is switching to the calendar app they meant to paste it into. *Applying: Zen
 * of Clarity.*
 *
 * **Turning it off takes a second press, and the second press says what breaks.**
 * A dialog rather than web's inline label swap: this is the same confirmation
 * shape every other switch-off in this app uses, and on a phone the control that
 * arms and the control that fires must not be the same pixels — a mis-tap with
 * gloves on a job site would otherwise end a subscription silently. Silently is
 * the whole problem: from the member's side nothing announces it, their calendar
 * simply stops updating. So the confirm button carries the consequence
 * ("Turn it off — my calendar stops updating") rather than asking "are you
 * sure", and the body repeats what is relying on it. *Applying: Ethical
 * Friction.*
 *
 * **"Your calendar last checked 6m" is the headline of the active state.** A
 * feed nothing has polled looks identical to a working one without it, and the
 * commonest failure is copying the URL and never finishing in the calendar app.
 * It is the same question the neighbouring screen answers with "last used", and
 * the same answer. *Applying: Meaningful Highlights.*
 *
 * ## The one thing web does not do
 *
 * The card is withheld from a role that cannot hold a feed. Every route in
 * `routes/calendar.ts` asks for `conversations.read`, and the bookkeeper (#315)
 * is the one role that holds `workspace.access` without it — Profile is a screen
 * they very much reach. Rendering this to them would be a card that 403s on
 * sight, offering to put a schedule they cannot see into their calendar.
 * Visibility, not authorization: the server's gate is what protects anything.
 */
@Composable
fun CalendarFeedCard(scope: SettingsScope) {
    // Withheld, not disabled — and BEFORE the read, so an incapable role never
    // puts a request on the wire either.
    if (!MemberRole.has(scope.role, Capability.CONVERSATIONS_READ)) return

    val locale = LocalAppLocale.current
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<CalendarFeedStatus>>(LoadState.Loading) }

    // Read fresh on every visit rather than through `rememberCacheFirst` like
    // the two-factor card beside it: the one fact this card exists to show is a
    // timestamp that moves every few minutes, and a cached "last checked" is the
    // reassurance being given, stale. The read is one small row.
    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(scope.repo.calendarFeed(scope.companyId))
        } catch (cause: CancellationException) {
            throw cause
        } catch (cause: Exception) {
            // A failed REFRESH keeps the card on screen and says so; a failed
            // first read has nothing to keep.
            if (state is LoadState.Ready) scope.showMessage(cause.userMessage(locale))
            else state = LoadState.Failed(cause.userMessage(locale))
        }
    }

    when (val current = state) {
        is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
        is LoadState.Failed -> CenteredError(
            current.message,
            onRetry = { refreshKey++ },
            modifier = Modifier.padding(vertical = 32.dp),
        )

        is LoadState.Ready -> CalendarFeedBody(scope, current.value) { refreshKey++ }
    }
}

@Composable
private fun CalendarFeedBody(
    scope: SettingsScope,
    status: CalendarFeedStatus,
    onChanged: () -> Unit,
) {
    val context = LocalContext.current
    val locale = LocalAppLocale.current
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    /** Shown once, then gone — the server keeps only a hash. */
    var url by remember { mutableStateOf<String?>(null) }
    var copied by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmingOff by remember { mutableStateOf(false) }

    // Composed OUTSIDE the coroutines below: `t` is a composable read and cannot
    // run inside one, so a sentence decided in a callback has to be hoisted or
    // it renders its own key.
    val failed = AppStrings.translate(locale, "calendarFeed.failed")
    // The label Android 13's clipboard preview shows beside what was copied. The
    // card's own title rather than a new string — this is not a place to invent
    // wording the other two clients have never said.
    val clipLabel = t("calendarFeed.title")

    /**
     * The fact that answers "did this work?", and the one a person needs before
     * switching it off. Written once because it is shown in both places — the
     * active card, and the body of the confirmation.
     */
    val readState = status.last_read_at
        ?.let { t("calendarFeed.lastRead", "when" to relativeTime(it)) }
        ?: t("calendarFeed.neverRead")

    /** Mint or rotate — one call, and the same irreversible moment either way. */
    fun mint() {
        busy = true
        error = null
        coroutines.launch {
            try {
                url = scope.repo.createCalendarFeed(scope.companyId).url
                copied = false
                haptics.confirm()
                // The status row behind the panel is stale the moment this
                // returns: rotating resets "last checked" to never.
                onChanged()
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                // #555: the SERVER'S own sentence, verbatim, the same way the
                // status read three functions up already does it. A mint
                // refused for a specific reason — a role that changed under
                // them, a subscription state, a rate limit — must say that
                // reason rather than "that didn't go through", which sends
                // somebody to look for a fault that is not theirs.
                // `userMessage` falls back to the generic line on its own.
                error = cause.userMessage(locale)
            } finally {
                busy = false
            }
        }
    }

    /** Stop the current URL working, without issuing another. */
    fun revoke() {
        busy = true
        error = null
        coroutines.launch {
            try {
                scope.repo.revokeCalendarFeed(scope.companyId)
                confirmingOff = false
                // The app's haptic vocabulary: `reject` is "something refused
                // or destructive", and every other switch-off in Settings
                // fires it — signing devices out, releasing a number,
                // deactivating a member, deleting a template. Without it the
                // recoverable action buzzed and the irreversible one did not,
                // which is the pair backwards.
                haptics.reject()
                // Nothing to announce. The card visibly changes back to the
                // offer, which is the whole of what happened.
                onChanged()
            } catch (cause: CancellationException) {
                throw cause
            } catch (cause: Exception) {
                // #555, as above: what the server said.
                error = cause.userMessage(locale)
            } finally {
                busy = false
            }
        }
    }

    SettingsCard(
        title = t("calendarFeed.title"),
        description = t("calendarFeed.description"),
    ) {
        val minted = url
        when {
            /*
             * The one irreversible moment. Amber rather than red: nothing has
             * gone wrong, but this is the only time the URL exists, and leaving
             * without copying it means rotating — which breaks the calendar
             * somebody may already have set up.
             */
            minted != null -> {
                Text(
                    t("calendarFeed.shownOnceTitle"),
                    style = MaterialTheme.typography.titleSmall,
                )
                Spacer(Modifier.height(6.dp))
                ReachNote(t("calendarFeed.shownOnceDetail"), tone = NoteTone.Warn)
                Spacer(Modifier.height(10.dp))
                Text(
                    minted,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace,
                    ),
                )
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = {
                        copyToClipboard(context, clipLabel, minted)
                        copied = true
                    }) {
                        Text(
                            if (copied) t("calendarFeed.copied") else t("calendarFeed.copy"),
                        )
                    }
                    LinkButton(onClick = {
                        url = null
                        copied = false
                    }) {
                        Text(t("calendarFeed.done"))
                    }
                }
            }

            status.active -> {
                Text(
                    readState,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = ::mint, enabled = !busy) {
                        Text(t("calendarFeed.rotate"))
                    }
                    // Quieter than rotating, and it opens a dialog rather than
                    // doing anything: the two live side by side and only one of
                    // them is recoverable.
                    // Cleared on the way in: without this a failed rotate leaves its
        // sentence sitting inside the revoke dialog, above the two buttons,
        // before the member has confirmed anything — attributing a failure to
        // an action nobody has taken yet, on the one card whose whole point is
        // that turning it off fails silently.
        LinkButton(onClick = { error = null; confirmingOff = true }, enabled = !busy) {
                        Text(
                            t("calendarFeed.revoke"),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            else -> Button(
                onClick = ::mint,
                enabled = !busy,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text(t("calendarFeed.create"))
            }
        }
        // Only while the panel is closed: a failure to mint is reported inside
        // the dialog when one is open, and the same sentence twice on one screen
        // reads as two problems.
        InlineError(error.takeIf { !confirmingOff })
    }

    if (confirmingOff) {
        ConfirmDialog(
            title = t("calendarFeed.revoke"),
            // What is relying on it, which is the ApiKeys rule: the answer to
            // "can I safely switch this off" belongs inside the confirmation and
            // not only on the card behind it.
            body = readState,
            // The second press says WHAT BREAKS rather than "are you sure".
            // Its FIT is asserted by CalendarFeedCardTest rather than assumed:
            // it is the longest confirm label in the app (39 chars in English,
            // 52 in French) and every other one is a short verb.
            confirmLabel = t("calendarFeed.revokeConfirm"),
            destructive = true,
            pending = busy,
            error = error,
            onDismiss = {
                confirmingOff = false
                error = null
            },
            onConfirm = ::revoke,
        )
    }
}
