package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.CompanyAiSettings
import com.loonext.android.core.model.MemberRole
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedTextField
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.style.TextAlign
import com.loonext.android.core.model.BUSINESS_DESCRIPTION_MAX

/**
 * #214 Settings → AI. Per-enrichment opt-in: when a teammate makes a task from
 * a message, optionally infer a structured job address and/or a due date/time
 * from the text. Every inference is a SUGGESTION the person reviews before
 * saving — nothing is auto-applied. Default OFF (it costs money and the model
 * sees message text). Owners/admins set it for the company; members see the
 * state read-only. Mirrors apps/web/src/app/(app)/settings/ai/page.tsx.
 */
@Composable
fun AiSection(scope: SettingsScope) {
    val canEdit = MemberRole.atLeast(scope.role, MemberRole.ADMIN)
    val coroutineScope = rememberCoroutineScope()
    var refreshKey by remember { mutableIntStateOf(0) }
    // The in-flight PATCH; a newer tap cancels it so writes can't land out of
    // order (rapid toggling would otherwise let a stale PATCH win last).
    val pendingSave = remember { mutableStateOf<Job?>(null) }

    // #176 cache-first: the toggles paint instantly from StoreCache after the
    // first in-process fetch. Optimistic flips write straight into this key so
    // the switch never lags the tap; a failed PATCH reverts + surfaces the error.
    val cacheKey = CacheKeys.aiSettings(scope.companyId)
    val state = rememberCacheFirst(
        cache = scope.graph.storeCache,
        key = cacheKey,
        refreshKey = refreshKey,
    ) { scope.graph.aiRepo.getAiSettings(scope.companyId) }

    fun toggle(current: CompanyAiSettings, next: CompanyAiSettings) {
        if (!canEdit) return
        // Optimistic: reflect the flip immediately, then persist. Cancel any
        // prior in-flight PATCH first so only the latest tap's write lands (no
        // out-of-order reordering leaving the persisted value stale).
        scope.graph.storeCache.put(cacheKey, next)
        pendingSave.value?.cancel()
        pendingSave.value = coroutineScope.launch {
            try {
                scope.graph.storeCache.put(
                    cacheKey,
                    scope.graph.aiRepo.updateAiSettings(scope.companyId, next),
                )
            } catch (e: CancellationException) {
                throw e // superseded by a newer tap — its optimistic put stands
            } catch (cause: Exception) {
                scope.graph.storeCache.put(cacheKey, current) // revert
                scope.showMessage(cause.userMessage())
            }
        }
    }

    Column {
        Text(
            "Let the app pre-fill task details from a message. Every suggestion is " +
                "yours to review and edit before you save — nothing is sent or applied " +
                "on its own.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
        )

        when (val current = state) {
            is LoadState.Loading -> SettingsSectionSkeleton(cards = 1)
            is LoadState.Failed -> CenteredError(
                current.message,
                onRetry = { refreshKey++ },
                modifier = Modifier.padding(vertical = 48.dp),
            )

            is LoadState.Ready -> {
                val settings = current.value
                SettingsCard(title = "When you make a task from a message") {
                    LabeledSwitchRow(
                        label = "Suggest an address",
                        supporting = "Read a job location out of the message (or fall back " +
                            "to the contact's address) and pre-fill the task's address. It " +
                            "shows where each part came from; you can edit or clear it " +
                            "before saving.",
                        checked = settings.enrich_task_address,
                        enabled = canEdit,
                        onCheckedChange = { checked ->
                            toggle(settings, settings.copy(enrich_task_address = checked))
                        },
                    )
                    Spacer(Modifier.height(12.dp))
                    LabeledSwitchRow(
                        label = "Suggest a due date & time",
                        supporting = "Turn phrases like \"tomorrow at 2pm\" or \"next " +
                            "Tuesday\" into a due date in your workspace's timezone. " +
                            "Always editable before you save.",
                        checked = settings.enrich_task_due,
                        enabled = canEdit,
                        onCheckedChange = { checked ->
                            toggle(settings, settings.copy(enrich_task_due = checked))
                        },
                    )
                }
                Spacer(Modifier.height(12.dp))
                SettingsCard(title = "What Lou knows about your business") {
                    // Held locally while typing and saved when focus leaves, so
                    // a settings screen does not write per keystroke and a
                    // half-typed sentence never reaches a draft.
                    var description by remember(settings.business_description) {
                        mutableStateOf(settings.business_description.orEmpty())
                    }
                    Text(
                        "One sentence, in your words. Without it Lou will not say " +
                            "what your business does, because anything it said would " +
                            "be guesswork. With it, drafts can answer \"do you do X?\" " +
                            "honestly.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = description,
                        onValueChange = {
                            if (it.length <= BUSINESS_DESCRIPTION_MAX) description = it
                        },
                        placeholder = {
                            Text("We paint houses and do small renovations in Calgary.")
                        },
                        enabled = canEdit,
                        minLines = 2,
                        modifier = Modifier
                            .fillMaxWidth()
                            .onFocusChanged { focus ->
                                if (!focus.isFocused &&
                                    description.trim() != settings.business_description.orEmpty().trim()
                                ) {
                                    toggle(
                                        settings,
                                        settings.copy(business_description = description.trim()),
                                    )
                                }
                            },
                    )
                    Text(
                        "${description.length} / $BUSINESS_DESCRIPTION_MAX",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth(),
                        textAlign = TextAlign.End,
                    )
                }
                Spacer(Modifier.height(12.dp))
                SettingsCard(title = "When you reply to a customer") {
                    LabeledSwitchRow(
                        label = "Let Lou draft replies",
                        supporting = "Offer a few short replies you can edit before " +
                            "sending, drawn from the conversation so far. Start typing " +
                            "and they finish what you started instead.",
                        checked = settings.suggest_replies,
                        enabled = canEdit,
                        onCheckedChange = { checked ->
                            toggle(settings, settings.copy(suggest_replies = checked))
                        },
                    )
                }
                Spacer(Modifier.height(12.dp))
                SettingsCard(title = "When someone leaves a voicemail") {
                    LabeledSwitchRow(
                        label = "Let Lou write voicemails down",
                        supporting = "Show what a voicemail says next to the recording, " +
                            "so you can read it when playing it isn't an option. The " +
                            "recording is always kept either way.",
                        checked = settings.transcribe_voicemail,
                        enabled = canEdit,
                        onCheckedChange = { checked ->
                            toggle(settings, settings.copy(transcribe_voicemail = checked))
                        },
                    )
                    // #367/D89. Grouped with transcription rather than given a
                    // card of its own — same moment, and one is the other's
                    // input. Divided, because this is the switch that changes
                    // what a STRANGER hears and the copy has to be read first.
                    RowDivider()
                    LabeledSwitchRow(
                        label = "Ask callers what the job is",
                        supporting = "Your greeting adds one line asking for the problem " +
                            "and the address, and says a machine writes the answer down. " +
                            "Lou then shows what they said above the recording. Nothing " +
                            "books anything and nobody is put through a menu — it is " +
                            "still a voicemail, with a better question in front of it.",
                        checked = settings.voicemail_intake,
                        enabled = canEdit,
                        onCheckedChange = { checked ->
                            toggle(settings, settings.copy(voicemail_intake = checked))
                        },
                    )
                }
                if (!canEdit) {
                    ReadOnlyLine(
                        "Only owners and admins can change these.",
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 10.dp),
                    )
                }
            }
        }
    }
}
