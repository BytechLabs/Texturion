package com.loonext.android.features.settings

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Capability
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.SettingChoice
import com.loonext.android.core.model.SettingChoices
import com.loonext.android.core.time.TimestampFormat
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive

/** True when two wire values are the same setting value; 3 and 3.0 are equal. */
fun sameSettingValue(a: JsonElement?, b: JsonElement?): Boolean {
    if (a is JsonPrimitive && b is JsonPrimitive && a !is JsonNull && b !is JsonNull) {
        val x = a.content.toDoubleOrNull()
        val y = b.content.toDoubleOrNull()
        if (x != null && y != null) return x == y
        return a.content == b.content
    }
    return a == b
}

/**
 * #749: the line under a setting that has left its default, or null.
 *
 * Silent when the setting is at its default, and when the list was fetched
 * before the control changed (its value no longer matches [current]), so a
 * save never shows the previous person's name beside the new value.
 */
fun settingChoiceText(
    choice: SettingChoice?,
    current: JsonElement,
    defaultLabel: String,
    locale: String?,
): String? {
    if (choice == null) return null
    if (sameSettingValue(current, choice.default_value)) return null
    if (!sameSettingValue(current, choice.value)) return null
    val date = TimestampFormat.calendarDate(choice.chosen_at, locale)
    val name = choice.chosen_by
    return if (name != null && date.isNotEmpty()) {
        AppStrings.translate(
            locale,
            "settingsMore.choiceChosenBy",
            mapOf("name" to name, "date" to date, "default" to defaultLabel),
        )
    } else {
        AppStrings.translate(
            locale,
            "settingsMore.choiceChangedFromDefault",
            mapOf("default" to defaultLabel),
        )
    }
}

/** "on" or "off" in the reader's language, for a switch's default. */
@Composable
fun onOffLabel(on: Boolean): String = t(if (on) "settingsMore.choiceOn" else "settingsMore.choiceOff")

/**
 * #749: who chose this setting and when, once it is off its default. Owners and
 * admins only (the server refuses the list to anyone else). One fetch serves
 * every note through the store cache and is repeated when [current] changes,
 * which is how a save refreshes it.
 */
@Composable
fun SettingChoiceNote(
    scope: SettingsScope,
    settingKey: String,
    current: JsonElement,
    defaultLabel: String,
    modifier: Modifier = Modifier,
) {
    val allowed = MemberRole.has(scope.role, Capability.SETTINGS_MANAGE)
    val key = CacheKeys.settingChoices(scope.companyId)
    val choices by remember(key) {
        scope.graph.storeCache.flowOf<SettingChoices>(key)
    }.collectAsStateWithLifecycle()
    val row = choices?.data?.firstOrNull { it.key == settingKey }
    // Fetch once for the screen, and again whenever this control's saved value
    // changes: a save is what moves a setting on or off its default.
    var lastSeen by remember { mutableStateOf<JsonElement?>(null) }
    LaunchedEffect(key, allowed, current) {
        val changed = lastSeen != null && lastSeen != current
        lastSeen = current
        if (allowed && (choices == null || changed)) {
            runCatching { scope.repo.settingChoices(scope.companyId) }
                .onSuccess { scope.graph.storeCache.put(key, it) }
        }
    }
    if (!allowed) return
    val text = settingChoiceText(row, current, defaultLabel, LocalAppLocale.current) ?: return
    Text(
        text,
        modifier = modifier.padding(top = 4.dp),
        fontSize = 13.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}
