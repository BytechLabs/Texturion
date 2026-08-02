package com.loonext.android.features.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Template
import com.loonext.android.features.compose.estimateSegments
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.assertAboveIme
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/**
 * Templates (parity with apps/web settings/templates): saved replies the crew
 * can send in one tap. The phones could already READ these in the composer's
 * picker but not manage them, so fixing a typo in the reply you send twenty
 * times a day meant finding a laptop. This is the web page's behaviour —
 * create, edit, delete — in the settings section grammar.
 *
 * #461: CURATING the set is admin's now — a template is words the whole crew
 * sends in the business's name, the same class of thing as the away message and
 * the voicemail greeting, both already admin. USING them is untouched: the
 * composer's "/" picker reads the same list and every member still has it.
 * This section no longer appears in a member's settings index at all
 * (it needs `settings.manage`), and the API answers the three write routes
 * with the same axis.
 */

/** Mirrors the API schema (routes/templates.ts): trimmed 1..120 / 1..2000. */
private const val TEMPLATE_NAME_MAX = 120
private const val TEMPLATE_BODY_MAX = 2000

/**
 * The merge variables the editor offers. They resolve server-side at send time
 * (apps/api merge.ts → @loonext/shared applyMergeFields), so a saved body keeps
 * the raw {token}; the preview below the field shows what actually ships.
 */
private val TEMPLATE_VARIABLES = listOf(
    "first_name" to "First name",
    "business_name" to "Business name",
)

@Composable
fun TemplatesSection(
    scope: SettingsScope,
    company: CompanyView,
    onCompanyUpdated: (CompanyView) -> Unit,
) {
    val repo = remember(scope.graph) { MessagingRepository(scope.graph.api) }
    var refreshKey by remember { mutableIntStateOf(0) }
    var state by remember { mutableStateOf<LoadState<List<Template>>>(LoadState.Loading) }
    // Web's dialogOpen/editing pair: `editing == null` inside an open editor is
    // a create, so both flows share one dialog.
    var editorOpen by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Template?>(null) }
    var deleting by remember { mutableStateOf<Template?>(null) }

    // Read fresh on every visit rather than through StoreCache: this screen is
    // the only writer of the list, so a cached paint would only ever be the
    // value the next create/edit/delete invalidates.
    LaunchedEffect(scope.companyId, refreshKey) {
        try {
            state = LoadState.Ready(repo.templates(scope.companyId).data)
        } catch (cause: CancellationException) {
            // On the JVM this IS an Exception: a refreshKey bump cancels the
            // in-flight read, and swallowing it here would paint a load
            // failure over a fetch that is already on its way.
            throw cause
        } catch (cause: Exception) {
            // A failed REFRESH keeps the list on screen (the crew is still
            // reading it); only a failed first load takes the whole section.
            if (state is LoadState.Ready) scope.showMessage(cause.userMessage())
            else state = LoadState.Failed(cause.userMessage())
        }
    }

    Column {
        Text(
            "Replies you type all the time, saved once. Tap Templates in the composer " +
                "to insert one. Anyone on the crew can add or change them.",
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
                val templates = current.value
                SettingsCard(title = "Saved replies") {
                    if (templates.isEmpty()) {
                        ReadOnlyLine(
                            "No templates yet. Save a reply you send often, then insert " +
                                "it from Templates in the composer.",
                        )
                    } else {
                        templates.forEachIndexed { index, template ->
                            if (index > 0) {
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                            }
                            TemplateListRow(
                                template = template,
                                onEdit = {
                                    editing = template
                                    editorOpen = true
                                },
                                onDelete = { deleting = template },
                            )
                        }
                    }
                    Spacer(Modifier.height(10.dp))
                    Button(onClick = {
                        editing = null
                        editorOpen = true
                    }) {
                        Text(
                            if (templates.isEmpty()) "Create your first template"
                            else "New template",
                        )
                    }
                }
            }
        }
    }

    if (editorOpen) {
        TemplateEditorDialog(
            scope = scope,
            repo = repo,
            company = company,
            template = editing,
            onDismiss = { editorOpen = false },
            onSaved = {
                editorOpen = false
                refreshKey++
            },
        )
    }

    // #298: tags live here rather than in a fifteenth settings section.
    // /features/templates-and-tags already pairs them in the product's own
    // vocabulary, so this is a name the crew has seen rather than one
    // invented for a settings row.
    TagsCard(scope, company, onCompanyUpdated)

    deleting?.let { template ->
        DeleteTemplateDialog(
            scope = scope,
            repo = repo,
            template = template,
            onDismiss = { deleting = null },
            onDeleted = {
                deleting = null
                refreshKey++
            },
        )
    }
}

/** Name, the first lines of the body, and when it last changed. */
@Composable
private fun TemplateListRow(
    template: Template,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(template.name, style = MaterialTheme.typography.bodyLarge)
            Text(
                template.body,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                updatedLine(template.updated_at, template.updated_by_name),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.outline,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(Modifier.width(4.dp))
        LinkButton(onClick = onEdit) { Text("Edit") }
        LinkButton(onClick = onDelete) {
            Text("Delete", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

/**
 * [relativeTime] speaks two dialects — durations ("now", "5m", "3h", "2d") and
 * calendar dates ("Jul 8") — and only a duration reads right before "ago".
 */
private fun updatedLine(iso: String, editor: String? = null): String {
    val relative = relativeTime(iso)
    val base = when {
        relative.isEmpty() -> "Saved reply"
        relative == "now" -> "Updated just now"
        relative.last() in "mhd" -> "Updated $relative ago"
        else -> "Updated $relative"
    }
    // #419: not a permission — visibility. A template is the only object here
    // where one person's edit changes what everyone else says to customers,
    // and in a crew of ten "Sam changed this on Tuesday" settles the question
    // before it becomes a dispute. "Saved reply" takes no byline: there is no
    // edit to attribute.
    if (editor.isNullOrBlank() || base == "Saved reply") return base
    return "$base by $editor"
}

/** Create ([template] null) or edit a saved reply — the web dialog's twin. */
@Composable
private fun TemplateEditorDialog(
    scope: SettingsScope,
    repo: MessagingRepository,
    company: CompanyView,
    template: Template?,
    onDismiss: () -> Unit,
    onSaved: () -> Unit,
) {
    var name by remember(template) { mutableStateOf(template?.name.orEmpty()) }
    var body by remember(template) { mutableStateOf(template?.body.orEmpty()) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    val trimmedName = name.trim()
    val trimmedBody = body.trim()
    // #415: count the string the preview below already builds, not the raw
    // template. A saved reply is WHERE merge fields are used, so this surface
    // had the largest version of the composer's bug — and it asserted "per
    // send", which the raw body cannot support.
    //
    // Nothing is invented here: the sample first name and the real company
    // name are the same pair the preview has always shown. The count is still
    // an estimate, because the real customer's name is not this one — but it
    // is an estimate of the right shape, and it catches the case that actually
    // bites, which is an accented or apostrophe-bearing company name flipping
    // the whole message to UCS-2 and cutting per-part capacity from 160 to 70.
    val estimate = estimateSegments(
        applyMergeFields(
            text = trimmedBody,
            contactName = SAMPLE_FIRST_NAME,
            businessName = company.name,
        ),
    )

    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(if (template == null) "New template" else "Edit template") },
        text = {
            // #180: the dialog body scrolls so the preview below the fields is
            // never squeezed out on a short viewport. #199: the platform keeps
            // the dialog window above the keyboard; the guard verifies it.
            Column(Modifier.verticalScroll(rememberScrollState()).assertAboveIme("dialog")) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { if (it.length <= TEMPLATE_NAME_MAX) name = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    enabled = !saving,
                    label = { Text("Name") },
                    placeholder = { Text("On my way") },
                )
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(
                    value = body,
                    onValueChange = { if (it.length <= TEMPLATE_BODY_MAX) body = it },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    enabled = !saving,
                    label = { Text("Message") },
                    placeholder = { Text("On our way. See you in about 20 minutes.") },
                    supportingText = {
                        val unit = if (estimate.segments == 1) "segment" else "segments"
                        Text(
                            "${body.length}/$TEMPLATE_BODY_MAX · " +
                                "${estimate.segments} $unit per send",
                        )
                    },
                )
                Spacer(Modifier.height(10.dp))
                Text(
                    "Variables: tap to insert",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TEMPLATE_VARIABLES.forEach { (token, label) ->
                        AssistChip(
                            onClick = {
                                haptics.tap()
                                body = appendToken(body, token)
                            },
                            enabled = !saving,
                            label = { Text(label) },
                        )
                    }
                }
                if (trimmedBody.isNotEmpty()) {
                    // Exactly the send-time substitution (sample first name +
                    // the real company name), so what you see is what ships.
                    PreviewBubble(
                        label = "Preview for $SAMPLE_FIRST_NAME",
                        text = applyMergeFields(
                            text = trimmedBody,
                            contactName = SAMPLE_FIRST_NAME,
                            businessName = company.name,
                        ),
                    )
                }
                InlineError(error)
            }
        },
        confirmButton = {
            Button(
                enabled = trimmedName.isNotEmpty() && trimmedBody.isNotEmpty() && !saving,
                onClick = {
                    error = null
                    saving = true
                    coroutines.launch {
                        try {
                            if (template == null) {
                                repo.createTemplate(scope.companyId, trimmedName, trimmedBody)
                            } else {
                                repo.updateTemplate(
                                    companyId = scope.companyId,
                                    templateId = template.id,
                                    name = trimmedName,
                                    body = trimmedBody,
                                )
                            }
                            haptics.confirm()
                            scope.showMessage(
                                if (template == null) "Template created." else "Template saved.",
                            )
                            onSaved()
                        } catch (cause: Exception) {
                            error = cause.userMessage()
                        } finally {
                            saving = false
                        }
                    }
                },
            ) {
                Text(
                    when {
                        saving -> "Saving…"
                        template == null -> "Create template"
                        else -> "Save"
                    },
                )
            }
        },
        dismissButton = {
            LinkButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") }
        },
    )
}

/** Append a {token}, keeping one space between it and whatever came before. */
private fun appendToken(body: String, token: String): String {
    val separator = if (body.isEmpty() || body.endsWith(" ")) "" else " "
    return "$body$separator{$token}"
}

@Composable
private fun DeleteTemplateDialog(
    scope: SettingsScope,
    repo: MessagingRepository,
    template: Template,
    onDismiss: () -> Unit,
    onDeleted: () -> Unit,
) {
    var deleting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val coroutines = rememberCoroutineScope()
    val haptics = rememberHaptics()

    ConfirmDialog(
        title = "Delete \"${template.name}\"?",
        body = "It disappears from the composer's Templates picker for the whole crew. " +
            "This can't be undone.",
        confirmLabel = "Delete",
        dismissLabel = "Keep it",
        destructive = true,
        pending = deleting,
        error = error,
        onDismiss = onDismiss,
        onConfirm = {
            haptics.reject()
            error = null
            deleting = true
            coroutines.launch {
                try {
                    repo.deleteTemplate(scope.companyId, template.id)
                    scope.showMessage("Template deleted.")
                    onDeleted()
                } catch (cause: Exception) {
                    error = cause.userMessage()
                } finally {
                    deleting = false
                }
            }
        },
    )
}
