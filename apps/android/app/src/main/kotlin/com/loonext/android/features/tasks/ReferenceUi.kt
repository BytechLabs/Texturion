package com.loonext.android.features.tasks

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * #690: everything a screen needs to draw and open reference chips and to
 * offer the `#` picker. A screen that passes null shows its text as typed.
 *
 * Only internal text gets one: a note, a task description, a task comment.
 * The composer for texts to a customer is never handed a source.
 */
class ReferenceSource(
    val repo: ReferenceRepository,
    val companyId: String,
    val onOpen: (ReferenceTarget) -> Unit,
)

@Composable
fun rememberReferenceSource(
    graph: AppGraph,
    companyId: String,
    onOpen: (ReferenceTarget) -> Unit,
): ReferenceSource {
    val repo = remember(graph) { ReferenceRepository(graph.api) }
    // The callback is read at tap time, so a screen that rebuilds its lambda
    // does not rebuild the source (and drop the resolved chips with it).
    val latest = androidx.compose.runtime.rememberUpdatedState(onOpen)
    return remember(repo, companyId) { ReferenceSource(repo, companyId) { latest.value(it) } }
}

/** The words on a chip: "T-142 Title", a customer's name, a conversation's customer. */
fun referenceChipLabel(token: ReferenceToken, ref: ResolvedRef, locale: String?): String = when (ref) {
    is ResolvedRef.TaskRef -> {
        val base = listOf(taskNumberLabel(ref.number), ref.title).filter { it.isNotBlank() }.joinToString(" ")
        // "Done" reads as finished, in words, so it is not carried by a colour alone.
        if (ref.done) AppStrings.translate(locale, "taskLinks.chipFinished", mapOf("label" to base)) else base
    }

    is ResolvedRef.ContactRef -> ref.name?.takeIf { it.isNotBlank() } ?: token.raw
    is ResolvedRef.ConversationRef -> ref.contactName?.takeIf { it.isNotBlank() } ?: token.raw
}

/**
 * Text with its references drawn as chips. A token that does not resolve (gone,
 * denied, never existed) stays exactly as typed.
 */
@Composable
fun ReferenceText(
    text: String,
    source: ReferenceSource?,
    modifier: Modifier = Modifier,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = MaterialTheme.colorScheme.onSurface,
    maxLines: Int = Int.MAX_VALUE,
) {
    val tokens = remember(text) { if (source == null) emptyList() else parseReferenceTokens(text) }
    if (source == null || tokens.isEmpty()) {
        Text(text, modifier = modifier, style = style, color = color, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
        return
    }
    val resolved by produceState(emptyMap<String, ResolvedRef>(), text, source.companyId) {
        value = try {
            source.repo.resolve(source.companyId, tokens)
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            emptyMap()
        }
    }
    val locale = LocalAppLocale.current
    val chipFill = MaterialTheme.colorScheme.secondaryContainer
    val chipInk = MaterialTheme.colorScheme.onSecondaryContainer
    val annotated: AnnotatedString = remember(text, resolved, locale, chipFill, chipInk) {
        buildAnnotatedString {
            var at = 0
            for (token in tokens) {
                val ref = resolved[token.cacheKey()] ?: continue
                append(text.substring(at, token.start))
                val link = LinkAnnotation.Clickable(
                    tag = token.raw,
                    styles = TextLinkStyles(
                        SpanStyle(color = chipInk, background = chipFill, fontWeight = FontWeight.SemiBold),
                    ),
                    linkInteractionListener = { source.onOpen(ref.target()) },
                )
                withLink(link) { append(" " + referenceChipLabel(token, ref, locale) + " ") }
                at = token.end
            }
            append(text.substring(at))
        }
    }
    Text(annotated, modifier = modifier, style = style, color = color, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

private enum class PickerKind(val labelKey: String) {
    Task("taskLinks.pickerTask"),
    Contact("taskLinks.pickerContact"),
    Conversation("taskLinks.pickerConversation"),
}

private data class PickerItem(val kind: PickerKind, val label: String, val insert: String, val key: String)

private const val PICKER_DEBOUNCE_MS = 180L

/**
 * The list under a note or a comment while the caret sits in a `#word`: tasks by
 * number, title or customer; customers; conversations. [onPick] gets the plain
 * text to write over the `#word`.
 */
@Composable
fun ReferencePickerPanel(
    source: ReferenceSource,
    query: ReferenceQuery,
    onPick: (insert: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var items by remember { mutableStateOf<List<PickerItem>?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(query.query, source.companyId) {
        delay(PICKER_DEBOUNCE_MS)
        try {
            val q = query.query
            val tasks = source.repo.searchTasks(source.companyId, q)
                .filter { it.number != null }
                .take(4)
                .map {
                    PickerItem(
                        PickerKind.Task,
                        listOf(taskNumberLabel(it.number!!), it.title).joinToString(" "),
                        taskReferenceText(it.number!!),
                        "t:${it.id}",
                    )
                }
            val records = if (q.length >= 2) source.repo.search(source.companyId, q) else null
            val contacts = records?.contacts.orEmpty().take(3).map {
                PickerItem(
                    PickerKind.Contact,
                    it.name?.takeIf { name -> name.isNotBlank() } ?: it.phone_e164,
                    recordReferenceText(ReferenceKind.Contact, it.id),
                    "c:${it.id}",
                )
            }
            val conversations = records?.conversations.orEmpty().take(3).map {
                PickerItem(
                    PickerKind.Conversation,
                    it.contact.name?.takeIf { name -> name.isNotBlank() } ?: it.contact.phone_e164,
                    recordReferenceText(ReferenceKind.Conversation, it.id),
                    "v:${it.id}",
                )
            }
            items = tasks + contacts + conversations
            failed = false
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    val shown = items
    if (shown == null && !failed) return
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shadowElevation = 2.dp,
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp),
    ) {
        Column(
            Modifier
                .heightIn(max = 240.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            when {
                failed -> PickerNote(t("taskLinks.pickerFailed"))
                shown.isNullOrEmpty() -> PickerNote(t("taskLinks.pickerEmpty"))
                else -> shown.forEach { item ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                            .clickable(role = Role.Button) { onPick(item.insert) }
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            t(item.kind.labelKey),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            item.label,
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PickerNote(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(14.dp),
    )
}

/**
 * The picker for a field that holds a [TextFieldValue] (so the caret is known):
 * shows the panel while the caret is in a `#word` and writes the pick over it.
 */
@Composable
fun ReferencePickerFor(
    source: ReferenceSource?,
    value: TextFieldValue,
    onValueChange: (TextFieldValue) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (source == null || !value.selection.collapsed) return
    val query = referenceQueryAt(value.text, value.selection.end) ?: return
    ReferencePickerPanel(
        source = source,
        query = query,
        modifier = modifier,
        onPick = { insert ->
            val (next, caret) = insertReference(value.text, query, value.selection.end, insert)
            onValueChange(TextFieldValue(next, androidx.compose.ui.text.TextRange(caret)))
        },
    )
}
