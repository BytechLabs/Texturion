package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Box
import com.loonext.android.ui.common.InlineError
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject

/**
 * #689: "Automatic texts", how the texts we send on the crew's behalf behave.
 *
 * - *Smart Defaults, stated.* Every control shows its current value and names
 *   its own default, so nobody has to guess what "unchanged" means.
 * - *Chunking and Relationship Strength.* Three cards of three or four rows:
 *   rows inside a card sit close, the cards sit apart.
 * - *No free-text numbers.* Integers come from a fixed list that always holds
 *   the current value.
 *
 * Each change is one PATCH of the one field that moved, and the reply replaces
 * the company (it carries every field). Controls lock while a save is in
 * flight, and a failure shows the usual inline error and changes nothing.
 */
@Composable
fun AutomaticTextsSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()
    val locale = LocalAppLocale.current
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun save(body: JsonObject) {
        if (!canEdit || saving) return
        saving = true
        error = null
        coroutines.launch {
            try {
                onCompanyUpdated(scope.repo.updateCompany(scope.companyId, body))
            } catch (cause: Exception) {
                error = cause.userMessage(locale)
            } finally {
                saving = false
            }
        }
    }

    val enabled = canEdit && !saving

    Text(
        t("domain.autoTextsIntro"),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
    )

    SettingsCard(
        anchor = "auto-text-reply",
        title = t("domain.autoTextsHoldTitle"),
        description = t("domain.autoTextsHoldIntro"),
    ) {
        AutoTexts.holdGroup.forEach { field ->
            val checked = field.read(company)
            LabeledSwitchRow(
                label = t(field.labelKey),
                supporting = AutoTexts.switchCaption(field, checked, locale),
                checked = checked,
                onCheckedChange = { save(AutoTexts.patch(field, it)) },
                enabled = enabled,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
    }

    SettingsCard(title = t("domain.autoTextsRatingTitle"), anchor = "auto-text-rating") {
        val on = AutoTexts.ratingEnabled.read(company)
        LabeledSwitchRow(
            label = t(AutoTexts.ratingEnabled.labelKey),
            supporting = AutoTexts.switchCaption(AutoTexts.ratingEnabled, on, locale),
            checked = on,
            onCheckedChange = { save(AutoTexts.patch(AutoTexts.ratingEnabled, it)) },
            enabled = enabled,
            modifier = Modifier.padding(vertical = 4.dp),
        )
        AutoTexts.ratingGroup.forEach { field ->
            AutoTextsPickerRow(field, company, locale, enabled && on) {
                save(AutoTexts.patch(field, it))
            }
        }
    }

    SettingsCard(title = t("domain.autoTextsWaitTitle"), anchor = "auto-text-wait") {
        AutoTexts.waitGroup.forEach { field ->
            AutoTextsPickerRow(field, company, locale, enabled) {
                save(AutoTexts.patch(field, it))
            }
        }
    }

    InlineError(error, Modifier.padding(horizontal = 16.dp))
    if (!canEdit) {
        ReadOnlyLine(t("settings.hoursReadOnly"), Modifier.padding(horizontal = 16.dp))
    }

    Text(
        t("domain.autoTextsFixedRules"),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
    )
}

/** A label, its stated default, and a menu of the fixed choices. */
@Composable
private fun AutoTextsPickerRow(
    field: AutoTexts.IntField,
    company: CompanyView,
    locale: String?,
    enabled: Boolean,
    onPick: (Int) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val current = field.read(company)
    val label = t(field.labelKey)
    val currentLabel = AutoTexts.valueLabel(field, current, locale)
    val caption = AutoTexts.defaultCaption(field, locale)

    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(
            caption,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Box(Modifier.padding(top = 6.dp)) {
            OutlinedButton(
                onClick = { open = true },
                enabled = enabled,
                modifier = Modifier
                    .heightIn(min = 48.dp)
                    .semantics { contentDescription = "$label: $currentLabel. $caption" },
            ) { Text(currentLabel) }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                AutoTexts.choicesWithCurrent(field, current).forEach { choice ->
                    DropdownMenuItem(
                        text = { Text(AutoTexts.valueLabel(field, choice, locale)) },
                        modifier = Modifier.heightIn(min = 48.dp),
                        onClick = {
                            open = false
                            if (choice != current) onPick(choice)
                        },
                    )
                }
            }
        }
    }
}
