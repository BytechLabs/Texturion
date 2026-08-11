package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.CompanyView
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #460 — the emergency words and reply, in the owner's hands.
 *
 * WHY THIS IS ITS OWN CARD rather than three more rows on the away card: that
 * one already carries three decisions (reply on/off, the message, and whether an
 * emergency word wakes the crew). Adding the word list and the reply makes five,
 * past what a reader holds at once, and the two halves answer different
 * questions — "what do we say when we're shut" versus "what counts as an
 * emergency and what goes back". Splitting them is what lets each stay short.
 *
 * It sits DIRECTLY beneath the away card and nowhere else, because the away
 * message is the sentence that tells a customer the word. Same copy as web and
 * iOS, deliberately: a rule worded three ways is three rules.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun EmergencyCard(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val canEdit = SettingsRoleGate.canEditWorkspace(scope.role)
    val coroutines = rememberCoroutineScope()

    val savedWords = company.effectiveEmergencyWords
    // Seeded from the EFFECTIVE list, never the raw column. An owner who has
    // never opened this screen has a null column, and an empty box would read as
    // "nothing is watched for" — the opposite of the truth, and the fastest way
    // to make somebody think the feature is broken.
    var words by remember(savedWords) { mutableStateOf(savedWords) }
    var draft by remember { mutableStateOf("") }
    var message by remember(company.emergency_message) {
        mutableStateOf(company.emergency_message.orEmpty())
    }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // #553: held locally so the switch moves on the tap rather than a round trip
    // later, re-seeded whenever the company row changes.
    var replyEnabled by remember(company.emergency_reply_enabled) {
        mutableStateOf(company.emergency_reply_enabled)
    }

    /**
     * #553: saved on the tap, not behind the card's Save button.
     *
     * The words and the message are a draft somebody composes and commits. This is
     * a switch, and a switch that needs a separate Save is a switch people believe
     * they have already thrown. On failure it goes back to what the server has, so
     * the control never shows a state the account is not in.
     */
    fun saveReplyEnabled(next: Boolean) {
        coroutines.launch {
            try {
                val updated = scope.repo.updateCompany(
                    scope.companyId,
                    buildJsonObject { put("emergency_reply_enabled", next) },
                )
                onCompanyUpdated(updated)
            } catch (cause: Exception) {
                replyEnabled = !next
                error = cause.userMessage()
            }
        }
    }
    val trimmedMessage = message.trim()
    val dirty = words != savedWords ||
        trimmedMessage != company.emergency_message.orEmpty().trim()

    // The composed preview: the owner's body (or the product default) followed
    // by the sentence no setting removes. The server's composed message is the
    // truth whenever nothing is unsaved, which is why it shows when empty.
    val previewBody = trimmedMessage.ifEmpty { company.emergency_effective_message }
    val preview =
        if (previewBody.contains(EMERGENCY_SAFETY_LINE)) previewBody
        else "$previewBody $EMERGENCY_SAFETY_LINE"

    // `addWord` and the chip's onClick both run outside composition, and one of
    // them has to name the offending word — so the locale is captured here and
    // the sentence is built where it is needed rather than being read from a
    // @Composable that is no longer running.
    val locale = LocalAppLocale.current
    val tooManyWords = t("settings.emergencyTooManyWords")
    val keepOneWord = t("settings.emergencyKeepOneWord")
    val savedMessage = t("settings.emergencySaved")

    fun addWord() {
        val raw = draft.trim()
        val problem = emergencyKeywordError(raw)
        if (problem != null) {
            error = problem
            return
        }
        val word = raw.uppercase()
        when {
            word in words -> error = AppStrings.translate(
                locale,
                "settings.emergencyDuplicateWord",
                mapOf("word" to word),
            )
            words.size >= 10 -> error = tooManyWords
            else -> {
                error = null
                words = words + word
                draft = ""
            }
        }
    }

    SettingsCard(
        title = t("settings.emergencyTitle"),
        description = t("settings.emergencyIntro"),
    ) {
        Text(
            t("settings.emergencyWordsHeading"),
            style = MaterialTheme.typography.labelLarge,
        )
        Text(
            t("settings.emergencyWordsHelp"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        FlowRow(
            Modifier.fillMaxWidth().padding(top = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            words.forEach { word ->
                AssistChip(
                    onClick = {
                        // Never down to zero. An empty list is not "no
                        // emergencies" — the switch on the away card says that,
                        // honestly and reversibly. Watching for nothing while
                        // the switch reads ON is the #414 defect.
                        if (!canEdit || saving) return@AssistChip
                        if (words.size == 1) {
                            error = keepOneWord
                        } else {
                            error = null
                            words = words - word
                        }
                    },
                    // The word IS the content, so it stays legible and the
                    // remove affordance rides beside it rather than replacing
                    // it. Text rather than an icon: at chip size a glyph next
                    // to a monospaced word reads as part of the word.
                    label = {
                        Text(
                            if (canEdit) {
                                t("settings.emergencyWordChip", "word" to word)
                            } else {
                                word
                            },
                            fontFamily = FontFamily.Monospace,
                        )
                    },
                )
            }
        }
        if (canEdit) {
            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= 15) draft = it },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    enabled = !saving,
                    label = { Text(t("settings.emergencyAddWordLabel")) },
                    placeholder = { Text(t("settings.emergencyAddWordPlaceholder")) },
                )
                Spacer(Modifier.width(8.dp))
                OutlinedButton(enabled = !saving, onClick = { addWord() }) {
                    Text(t("settings.emergencyAddWordAction"))
                }
            }
        }
        if (!company.emergency_keywords_are_custom) {
            Text(
                t("settings.emergencyDefaults"),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        Spacer(Modifier.height(16.dp))
        Text(t("settings.emergencyReplyHeading"), style = MaterialTheme.typography.labelLarge)
        // #553: the switch lives NEXT TO the thing it governs.
        //
        // It always existed, but under Hours — a screen away from the words and the
        // message it controls — so the founder reported the reply as "enforced". A
        // setting nobody can find is not a setting.
        //
        // And it is now a DIFFERENT switch. `emergency_keyword_enabled` used to
        // gate four things at once, so the only way to stop us texting on the
        // crew's behalf was to stop the product noticing emergencies. Turning this
        // one off keeps the crew escalation, the push and the inbox flag, and
        // withholds only the message.
        LabeledSwitchRow(
            label = t("settings.emergencyTextBack"),
            checked = replyEnabled,
            onCheckedChange = { next ->
                replyEnabled = next
                saveReplyEnabled(next)
            },
            supporting = t("settings.emergencyTextBackHelp"),
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            t("settings.emergencyReplyHelp"),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 2.dp),
        )
        OutlinedTextField(
            value = message,
            onValueChange = { if (it.length <= 1000) message = it },
            modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
            minLines = 3,
            enabled = canEdit && !saving,
            placeholder = { Text(company.emergency_effective_message) },
            supportingText = {
                Text(
                    if (company.emergency_message_is_custom) {
                        t("settings.emergencyCount", "count" to message.length.toString())
                    } else {
                        t(
                            "settings.emergencyCountDefault",
                            "count" to message.length.toString(),
                        )
                    },
                )
            },
        )

        // The honest part of this screen. An owner editing the body needs to see
        // that one sentence follows it whatever they write — otherwise they will
        // believe they removed it, and find out from a customer.
        Spacer(Modifier.height(12.dp))
        PreviewBubble(label = t("settings.emergencyPreviewLabel"), text = preview)
        Text(
            t("settings.emergencySafetyLineNote", "line" to EMERGENCY_SAFETY_LINE),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )

        InlineError(error)

        if (canEdit && dirty) {
            Button(
                enabled = !saving,
                modifier = Modifier.padding(top = 10.dp),
                onClick = {
                    error = null
                    saving = true
                    coroutines.launch {
                        try {
                            val body = buildJsonObject {
                                // Only send the list when it is genuinely the
                                // owner's. Echoing the product defaults back
                                // would FREEZE them on this workspace, so
                                // improving them later would never reach it.
                                if (words != savedWords || company.emergency_keywords_are_custom) {
                                    put(
                                        "emergency_keywords",
                                        buildJsonArray { words.forEach { add(it) } },
                                    )
                                }
                                if (trimmedMessage.isEmpty()) {
                                    put("emergency_message", JsonNull)
                                } else {
                                    put("emergency_message", trimmedMessage)
                                }
                            }
                            val updated = scope.repo.updateCompany(scope.companyId, body)
                            onCompanyUpdated(updated)
                            scope.showMessage(savedMessage)
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            saving = false
                        }
                    }
                },
            ) {
                Text(
                    if (saving) t("common.saving") else t("settings.emergencySaveAction"),
                )
            }
        } else if (!canEdit) {
            Spacer(Modifier.height(4.dp))
            ReadOnlyLine(t("settings.emergencyReadOnly"))
        }
    }
}

/**
 * The one sentence appended to every emergency reply, mirroring
 * `EMERGENCY_SAFETY_LINE` in shared. Kept in Kotlin because this screen has to
 * PREVIEW the composed message while the owner is still typing — the server's
 * composed value is a round trip behind.
 */
const val EMERGENCY_SAFETY_LINE = "If anyone is in danger, call 911."
