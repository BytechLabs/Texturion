package com.loonext.android.features.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Call
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Page
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.features.calls.CallsRepository
import com.loonext.android.features.settings.AiSection
import com.loonext.android.features.settings.SettingsRepository
import com.loonext.android.features.settings.SettingsScope
import com.loonext.android.ui.common.LoadError
import com.loonext.android.ui.common.LoadErrorVariant
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SelectField
import com.loonext.android.ui.common.SelectOption
import com.loonext.android.ui.common.Segment
import com.loonext.android.ui.common.SegmentedControl
import com.loonext.android.ui.common.SegmentedSize
import com.loonext.android.ui.common.formatPhone

private enum class LouSection(val label: String) {
    Overview("shell.louOverview"),
    Activity("shell.louActivity"),
    Settings("shell.settings"),
}

internal fun availableLines(numbers: List<PhoneNumberSummary>): List<PhoneNumberSummary> =
    numbers.filter { it.status == "active" && !it.number_e164.isNullOrBlank() }

internal fun selectedPhoneLine(numbers: List<PhoneNumberSummary>, rememberedId: String?): PhoneNumberSummary? {
    val lines = availableLines(numbers)
    return lines.firstOrNull { it.id == rememberedId } ?: lines.firstOrNull()
}

@Composable
internal fun PhoneLineMenu(
    numbers: List<PhoneNumberSummary>,
    selected: PhoneNumberSummary?,
    allowAll: Boolean,
    onSelect: (String?) -> Unit,
    labelKey: String = "shell.phoneLine",
    allowCopy: Boolean = true,
    allNumbersKey: String = "shell.allPhoneLines",
) {
    val lines = availableLines(numbers)
    if (lines.isEmpty()) return
    val all = t(allNumbersKey)
    val options = buildList<SelectOption<String?>> {
        if (allowAll) add(SelectOption(null, all))
        lines.forEach { line ->
            val number = formatPhone(line.number_e164)
            val label = line.label?.trim()?.takeIf { it.isNotEmpty() }
            val title = label?.let { "$it · $number" } ?: number
            add(SelectOption(line.id, title, copyValue = line.number_e164.takeIf { allowCopy }))
        }
    }
    SelectField(options = options, selected = selected?.id, onSelect = onSelect, label = t(labelKey))
}

@Composable
internal fun ConversationsHeader(
    numbers: List<PhoneNumberSummary>,
    selected: PhoneNumberSummary?,
    onSelectLine: (String?) -> Unit,
    tab: ShellTab,
    onSelectTab: (ShellTab) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 4.dp)) {
        PhoneLineMenu(numbers, selected, allowAll = false, onSelect = onSelectLine)
        SegmentedControl(
            segments = listOf(Segment(ShellTab.Inbox, t("shell.navMessages")), Segment(ShellTab.Calls, t("shell.navCalls"))),
            selected = tab,
            onSelect = onSelectTab,
            size = SegmentedSize.Sm,
            fill = true,
        )
    }
}

@Composable
internal fun LouTab(graph: AppGraph, companyId: String, me: Me, modifier: Modifier, onOpenCall: (String) -> Unit) {
    var section by rememberSaveable { mutableStateOf(LouSection.Overview) }
    var activityLineId by rememberSaveable { mutableStateOf<String?>(null) }
    val numbers = me.company?.numbers.orEmpty()
    var notice by remember { mutableStateOf<String?>(null) }
    Column(modifier.padding(horizontal = 18.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        ScreenTitle(t("shell.navLou"))
        SegmentedControl(
            segments = LouSection.entries.map { Segment(it, t(it.label)) },
            selected = section,
            onSelect = { section = it },
            fill = true,
        )
        when (section) {
            LouSection.Overview -> Text(t("shell.louOverviewDescription"), color = MaterialTheme.colorScheme.onSurfaceVariant)
            LouSection.Activity -> {
                val selected = availableLines(numbers).firstOrNull { it.id == activityLineId }
                PhoneLineMenu(numbers, selected, allowAll = true, onSelect = { activityLineId = it })
                LouActivity(graph, companyId, selected?.id, onOpenCall)
            }
            LouSection.Settings -> {
                val repo = remember(graph) { SettingsRepository(graph.api) }
                val role = me.memberships.firstOrNull { it.company_id == companyId }?.role
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    notice?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    AiSection(SettingsScope(graph, repo, companyId, me, role) { notice = it })
                }
            }
        }
    }
}

@Composable
private fun LouActivity(graph: AppGraph, companyId: String, lineId: String?, onOpenCall: (String) -> Unit) {
    val repo = remember(graph) { CallsRepository(graph.api) }
    var page by remember(companyId, lineId) { mutableStateOf<Page<Call>?>(null) }
    var loadFailed by remember(companyId, lineId) { mutableStateOf(false) }
    var cursor by remember(companyId, lineId) { mutableStateOf<String?>(null) }
    var retry by remember(companyId, lineId) { mutableStateOf(0) }
    LaunchedEffect(companyId, lineId, cursor, retry) {
        loadFailed = false
        val next = readShellData { repo.calls(companyId, "voicemail", cursor, phoneLineId = lineId, louActivity = true) }
        if (next == null) {
            loadFailed = true
        } else {
            page = next.copy(data = (page?.data.orEmpty() + next.data).distinctBy { it.id })
        }
    }
    Column(Modifier.verticalScroll(rememberScrollState())) {
        val loaded = page
        when {
            loadFailed -> LoadError(onRetry = { retry++ }, variant = LoadErrorVariant.Inline)
            loaded == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
            loaded.data.isEmpty() -> Text(t("shell.louActivityEmpty"))
        }
        loaded?.data?.forEach { call ->
            TextButton(onClick = { onOpenCall(call.call_session_id) }) {
                Text(call.contact_name ?: call.caller_name ?: formatPhone(call.caller_e164))
            }
        }
        loaded?.next_cursor?.let { next ->
            if (next != cursor) {
                TextButton(onClick = { cursor = next }) { Text(t("contactsTasks.showMore")) }
            }
        }
    }
}
