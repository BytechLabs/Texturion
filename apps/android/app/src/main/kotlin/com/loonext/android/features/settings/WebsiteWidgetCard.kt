package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.push.APP_ORIGIN
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #232 — the "Text us" button an owner puts on their own website.
 *
 * Hand-port of `apps/web/src/components/settings/website-widget-card.tsx`, and
 * the port is not a copy: the two surfaces answer the same question from
 * different places.
 *
 * # A phone is where you DECIDE, not where you install
 *
 * Nobody edits their WordPress theme from a phone. What somebody does do from a
 * phone is send the line to whoever looks after the site — so Copy is here and
 * carries its weight, and the three-step instruction stays, because the person
 * receiving that message needs to be told where it goes.
 *
 * The routing question is the part that genuinely belongs on a phone. "Which
 * number do website messages land on" is a decision an owner makes while
 * standing in a van, and there is no reason it should require a laptop.
 *
 * # Same rules as web
 *
 * - The key is fetched only when the card is opened. It is the credential in
 *   the markup, not a fact about the workspace, and every member would
 *   otherwise carry it from startup.
 * - The picker appears only when there is more than one active line. A menu
 *   with one item is a decision that does not exist dressed up as one.
 *   *Applying: Zen of Clarity.*
 * - Replacing the key is behind a confirm and says what it costs, because every
 *   embed carrying the old one stops working the moment it lands.
 *   *Applying: Ethical Friction and Loss Aversion.*
 */
@Composable
fun WebsiteWidgetCard(
    scope: SettingsScope,
    company: CompanyView,
    numbers: List<PhoneNumberSummary>,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val coroutines = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current
    val haptics = rememberHaptics()
    // #228: every failure on this card is written from a coroutine, outside
    // composition — including the one [saveLine] reports, which is why that
    // helper takes the locale rather than reading one it cannot see.
    val locale = LocalAppLocale.current

    var open by remember { mutableStateOf(false) }
    var key by remember { mutableStateOf<String?>(null) }
    var loadFailed by remember { mutableStateOf(false) }
    var confirming by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var lineMenuOpen by remember { mutableStateOf(false) }

    // Resolved in composition because an onClick lambda runs long after it, when
    // the reader's locale is no longer in scope — the same rule ClosedDatesCard
    // follows for its own toasts.
    val copiedMessage = t("settings.widgetCopied")
    val rotatedMessage = t("settings.widgetRotated")
    val lineSavedMessage = t("settings.widgetLineSaved")

    LaunchedEffect(open) {
        if (!open || key != null) return@LaunchedEffect
        try {
            key = scope.repo.widgetKey(scope.companyId).widget_key
            loadFailed = false
        } catch (cause: Exception) {
            // Named rather than silent: a card that opens to nothing reads as a
            // broken app, and the person is one tap from trying again.
            loadFailed = true
            error = cause.userMessage(locale)
        }
    }

    // Only the lines that can actually receive. Offering a suspended or released
    // number would be an offer to point the website at something that cannot
    // answer — and the server falls back past it anyway, so the menu would be
    // showing a choice that silently does not hold.
    val routable = numbers.filter { it.status == "active" && !it.number_e164.isNullOrBlank() }
    val chosen = routable.firstOrNull { it.id == company.widget_number_id }

    SettingsCard(
        title = t("settings.widgetTitle"),
        description = t("settings.widgetBlurb"),
    ) {
        if (!open) {
            OutlinedButton(onClick = {
                haptics.tap()
                open = true
            }) {
                Text(t("settings.widgetShow"))
            }
            return@SettingsCard
        }

        val snippet = key
        if (snippet == null) {
            Text(
                if (loadFailed) t("settings.widgetLoadFailed") else t("settings.widgetLoading"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            return@SettingsCard
        }

        Text(t("settings.widgetStepCopy"), style = MaterialTheme.typography.bodySmall)
        Text(t("settings.widgetStepPaste"), style = MaterialTheme.typography.bodySmall)
        Text(t("settings.widgetStepSave"), style = MaterialTheme.typography.bodySmall)

        Spacer(Modifier.height(10.dp))
        // Selectable is not the point here — a phone's answer to "I could not
        // copy it" is to try Copy again, not to transcribe a script tag by hand.
        Text(
            widgetSnippet(snippet),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth()) {
            Button(onClick = {
                haptics.tap()
                clipboard.setText(AnnotatedString(widgetSnippet(snippet)))
                scope.showMessage(copiedMessage)
            }) {
                Text(t("settings.widgetCopy"))
            }
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = {
                haptics.tap()
                confirming = true
            }) {
                Text(t("settings.widgetRotate"))
            }
        }

        if (confirming) {
            Spacer(Modifier.height(8.dp))
            // What they stand to LOSE, stated plainly: the widget on every site
            // carrying the old snippet. *Applying: Loss Aversion.*
            Text(t("settings.widgetRotateWarning"), style = MaterialTheme.typography.bodySmall)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.fillMaxWidth()) {
                Button(
                    enabled = !busy,
                    onClick = {
                        haptics.tap()
                        busy = true
                        error = null
                        coroutines.launch {
                            try {
                                key = scope.repo.rotateWidgetKey(scope.companyId).widget_key
                                confirming = false
                                scope.showMessage(rotatedMessage)
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                busy = false
                            }
                        }
                    },
                ) {
                    Text(t("settings.widgetRotateConfirm"))
                }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { confirming = false }) {
                    Text(t("common.cancel"))
                }
            }
        }

        // #232 phase 3: LAST, under the actions. The card exists to get one line
        // of markup somewhere, and a routing question in front of that is a
        // decision demanded before the thing it decides about even works. It
        // must also not sit between the snippet and Copy — web put it there
        // first and the screenshot showed a Copy that looked like it belonged to
        // the picker. *Applying: Prioritise Intent, and Relationship Strength.*
        if (routable.size > 1) {
            Spacer(Modifier.height(14.dp))
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            Text(t("settings.widgetLineLabel"), style = MaterialTheme.typography.bodyMedium)
            Text(
                t("settings.widgetLineHelp"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(6.dp))
            Column {
                OutlinedButton(
                    enabled = !busy,
                    onClick = {
                        haptics.tap()
                        lineMenuOpen = true
                    },
                ) {
                    // Named, not blank. "Your first number" is what the server
                    // actually does with an unset choice, and a default that does
                    // not say what it resolves to is a setting somebody has to
                    // test to understand. *Applying: Smart Defaults.*
                    Text(
                        chosen?.number_e164?.let { formatPhone(it) }
                            ?: t("settings.widgetLineDefault"),
                    )
                }
                DropdownMenu(
                    expanded = lineMenuOpen,
                    onDismissRequest = { lineMenuOpen = false },
                ) {
                    DropdownMenuItem(
                        text = { Text(t("settings.widgetLineDefault")) },
                        onClick = {
                            lineMenuOpen = false
                            saveLine(
                                scope, coroutines, null, lineSavedMessage, locale,
                                onCompanyUpdated, { busy = it }, { error = it },
                            )
                        },
                    )
                    routable.forEach { number ->
                        DropdownMenuItem(
                            text = { Text(formatPhone(number.number_e164)) },
                            onClick = {
                                lineMenuOpen = false
                                saveLine(
                                    scope, coroutines, number.id, lineSavedMessage, locale,
                                    onCompanyUpdated, { busy = it }, { error = it },
                                )
                            },
                        )
                    }
                }
            }
        }

        error?.let {
            Spacer(Modifier.height(8.dp))
            Text(
                it,
                modifier = Modifier.padding(top = 2.dp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

/**
 * Write the choice, or clear it.
 *
 * `JsonNull` rather than omitting the key: null is a real value here — it means
 * "back to the oldest active number" — and a body that simply left the field out
 * would be a request to change nothing.
 */
private fun saveLine(
    scope: SettingsScope,
    coroutines: kotlinx.coroutines.CoroutineScope,
    numberId: String?,
    savedMessage: String,
    /**
     * #228: threaded rather than read, for the reason rule 3 gives — this is a
     * plain function with no composition to read a reader out of. It sits beside
     * [savedMessage] because they are the same decision twice: the sentence that
     * lands on success is composed by the caller, and the one that lands on
     * failure has to come from the same reader.
     */
    locale: String,
    onCompanyUpdated: (CompanyView) -> Unit,
    setBusy: (Boolean) -> Unit,
    setError: (String?) -> Unit,
) {
    setBusy(true)
    setError(null)
    coroutines.launch {
        try {
            val body = buildJsonObject {
                if (numberId == null) put("widget_number_id", JsonNull)
                else put("widget_number_id", numberId)
            }
            onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
            scope.showMessage(savedMessage)
        } catch (cause: Exception) {
            setError(cause.userMessage(locale))
        } finally {
            setBusy(false)
        }
    }
}

/**
 * The one line an owner pastes into their own website.
 *
 * Hand-port of `apps/web/src/lib/marketing/widget-snippet.ts`, INCLUDING the
 * part that looks like superstition: the closing tag is assembled from the tag
 * name rather than written out. Kotlin has no bundler that would embed this
 * source into a page, so the parser hazard that forced it on web cannot bite
 * here — but the two builders have to produce byte-identical markup, and the
 * cheapest way to keep them identical is to keep them the same shape. A future
 * edit lands on both or neither.
 *
 * The origin is the constant the push deep links already use: whatever host
 * this build talks to is the host serving widget.js.
 */
internal fun widgetSnippet(key: String): String {
    val tag = "script"
    return "<$tag src=\"$APP_ORIGIN/widget.js\" data-key=\"$key\" defer></$tag>"
}
