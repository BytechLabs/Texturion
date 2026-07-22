package com.loonext.android.features.compose

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.loonext.android.core.model.Template
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

enum class ComposerMode { Text, Note }

/** Loonext amber — notes/overdue accent, tuned per theme for contrast. */
object NoteAmber {
    val LightBg = Color(0xFFFEF3C7)
    val LightInk = Color(0xFF92400E)
    val LightLine = Color(0xFFFDE68A)
    val DarkBg = Color(0xFF3B2A0A)
    val DarkInk = Color(0xFFFCD34D)
    val DarkLine = Color(0xFF6B4E16)

    @Composable
    fun bg(): Color = if (isSystemInDarkTheme()) DarkBg else LightBg

    @Composable
    fun ink(): Color = if (isSystemInDarkTheme()) DarkInk else LightInk

    @Composable
    fun line(): Color = if (isSystemInDarkTheme()) DarkLine else LightLine
}

/**
 * Composer state hoisted out of the UI so the thread controller can restore a
 * failed send. Text persists as a per-conversation client draft (the server
 * keeps none) with a debounced write.
 */
@Stable
class ComposerState(
    private val draftKey: String,
    private val drafts: ComposerDrafts,
    private val scope: CoroutineScope,
) {
    var text by mutableStateOf("")
        private set
    var mode by mutableStateOf(ComposerMode.Text)
    var photos by mutableStateOf(listOf<StagedPhoto>())
    var files by mutableStateOf(listOf<StagedFile>())

    private var draftLoaded = false
    private var saveJob: Job? = null

    fun onTextChange(value: String) {
        text = value
        queueDraftSave()
    }

    suspend fun loadDraftOnce() {
        if (draftLoaded) return
        draftLoaded = true
        val saved = drafts.load(draftKey)
        if (text.isEmpty() && saved.isNotEmpty()) text = saved
    }

    private fun queueDraftSave() {
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(400)
            drafts.save(draftKey, text)
        }
    }

    /** Clear immediately on send — fast by feel; the queued row is the UI. */
    fun clearForSend() {
        text = ""
        photos = emptyList()
        files = emptyList()
        saveJob?.cancel()
        scope.launch { drafts.clear(draftKey) }
    }

    /** Failed send: put the draft back exactly as it was. */
    fun restore(body: String, photos: List<StagedPhoto>, files: List<StagedFile>) {
        text = body
        this.photos = photos
        this.files = files
        queueDraftSave()
    }
}

@Composable
fun rememberComposerState(
    draftKey: String,
    drafts: ComposerDrafts,
): ComposerState {
    val scope = rememberCoroutineScope()
    val state = remember(draftKey) { ComposerState(draftKey, drafts, scope) }
    LaunchedEffect(state) { state.loadDraftOnce() }
    return state
}

/**
 * The Google-Messages-style composer pill: Text/Note mode toggle, auto-grow
 * field (internal scroll past 6 lines), `/` opens saved replies, photo attach
 * (≤3, transcoded ≤1 MB), note files (≤10 × 25 MB), passive segment meter,
 * merge-field live preview. [banner] replaces text mode with an explanatory
 * card — notes stay available; [noteOnly] is the viewer_level='note' gate.
 */
@Composable
fun ThreadComposer(
    state: ComposerState,
    noteOnly: Boolean,
    banner: ComposerBanner?,
    contactName: String?,
    businessName: String?,
    loadTemplates: suspend () -> List<Template>,
    onSendText: (body: String, photos: List<StagedPhoto>) -> Unit,
    onSaveNote: (body: String, files: List<StagedFile>) -> Unit,
    onNotice: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val textBlocked = noteOnly || banner != null
    val isNote = textBlocked || state.mode == ComposerMode.Note

    var templatePickerOpen by remember { mutableStateOf(false) }
    var attachMenuOpen by remember { mutableStateOf(false) }

    val photoPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(MAX_PHOTOS),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var trimmed = false
            for (uri in uris) {
                if (state.photos.size >= MAX_PHOTOS) {
                    trimmed = true
                    break
                }
                when (val result = preparePhoto(context, uri)) {
                    is PhotoPrepResult.Ready -> state.photos = state.photos + result.photo
                    is PhotoPrepResult.Rejected -> onNotice(result.reason)
                }
            }
            if (trimmed) onNotice("You can attach up to 3 photos per text.")
        }
    }

    val filePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        var trimmed = false
        for (uri in uris) {
            if (state.files.size >= MAX_NOTE_FILES) {
                trimmed = true
                break
            }
            when (val result = stageNoteFile(context, uri)) {
                is FileStageResult.Ready -> state.files = state.files + result.file
                is FileStageResult.Rejected -> onNotice(result.reason)
            }
        }
        if (trimmed) onNotice("Notes can carry up to 10 files.")
    }

    val canSend = if (isNote) {
        state.text.isNotBlank() || state.files.isNotEmpty()
    } else {
        state.text.isNotBlank() || state.photos.isNotEmpty()
    }

    fun submit() {
        if (!canSend) return
        val body = state.text.trim()
        if (isNote) {
            val files = state.files
            state.clearForSend()
            onSaveNote(body, files)
        } else {
            val photos = state.photos
            state.clearForSend()
            onSendText(body, photos)
        }
    }

    Column(modifier.fillMaxWidth()) {
        if (banner != null) ComposerBannerCard(banner)

        if (!textBlocked) {
            Row(
                Modifier.padding(start = 16.dp, top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ModePill(
                    label = "Text",
                    selected = state.mode == ComposerMode.Text,
                    selectedBg = MaterialTheme.colorScheme.primaryContainer,
                    selectedInk = MaterialTheme.colorScheme.onPrimaryContainer,
                    onClick = { state.mode = ComposerMode.Text },
                )
                Spacer(Modifier.width(4.dp))
                ModePill(
                    label = "Note",
                    selected = state.mode == ComposerMode.Note,
                    selectedBg = NoteAmber.bg(),
                    selectedInk = NoteAmber.ink(),
                    onClick = { state.mode = ComposerMode.Note },
                )
            }
        }

        if (!isNote && state.photos.isNotEmpty()) {
            PhotoChipsRow(
                photos = state.photos,
                onRemove = { id -> state.photos = state.photos.filterNot { it.id == id } },
            )
        }
        if (isNote && state.files.isNotEmpty()) {
            FileChipsRow(
                files = state.files,
                onRemove = { id -> state.files = state.files.filterNot { it.id == id } },
            )
        }

        val pillBg = if (isNote) NoteAmber.bg() else MaterialTheme.colorScheme.surface
        val pillLine = if (isNote) NoteAmber.line() else MaterialTheme.colorScheme.outlineVariant
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .border(1.dp, pillLine, RoundedCornerShape(24.dp))
                .background(pillBg, RoundedCornerShape(24.dp))
                .padding(horizontal = 6.dp, vertical = 4.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            if (!isNote) {
                Box {
                    IconButton(onClick = { attachMenuOpen = true }) {
                        Icon(
                            Icons.Filled.Add,
                            contentDescription = "Add to message",
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    DropdownMenu(
                        expanded = attachMenuOpen,
                        onDismissRequest = { attachMenuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Attach a photo") },
                            leadingIcon = { Icon(Icons.Filled.Image, contentDescription = null) },
                            enabled = state.photos.size < MAX_PHOTOS,
                            onClick = {
                                attachMenuOpen = false
                                photoPicker.launch(
                                    PickVisualMediaRequest(
                                        ActivityResultContracts.PickVisualMedia.ImageOnly,
                                    ),
                                )
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Saved reply") },
                            leadingIcon = {
                                Icon(Icons.Filled.Description, contentDescription = null)
                            },
                            onClick = {
                                attachMenuOpen = false
                                templatePickerOpen = true
                            },
                        )
                    }
                }
            } else {
                IconButton(
                    onClick = { filePicker.launch(arrayOf("*/*")) },
                    enabled = state.files.size < MAX_NOTE_FILES,
                ) {
                    Icon(
                        Icons.Filled.AttachFile,
                        contentDescription = "Attach files to this note",
                        tint = NoteAmber.ink(),
                    )
                }
            }

            ComposerField(
                value = state.text,
                onValueChange = { value ->
                    // "/" in an empty text draft opens saved replies instead.
                    if (!isNote && state.text.isEmpty() && value == "/") {
                        templatePickerOpen = true
                    } else {
                        state.onTextChange(value)
                    }
                },
                placeholder = if (isNote) "Write an internal note…" else "Text message",
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp, vertical = 10.dp),
            )

            FilledIconButton(
                onClick = { submit() },
                enabled = canSend,
                colors = if (isNote) {
                    IconButtonDefaults.filledIconButtonColors(
                        containerColor = NoteAmber.ink(),
                        contentColor = NoteAmber.bg(),
                    )
                } else {
                    IconButtonDefaults.filledIconButtonColors()
                },
                modifier = Modifier.padding(start = 4.dp),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = if (isNote) "Save note" else "Send message",
                )
            }
        }

        if (!isNote) {
            ComposerHints(
                text = state.text,
                hasMedia = state.photos.isNotEmpty(),
                contactName = contactName,
                businessName = businessName,
            )
        }
    }

    if (templatePickerOpen) {
        TemplatePickerSheet(
            loadTemplates = loadTemplates,
            onPick = { body ->
                templatePickerOpen = false
                val current = state.text
                state.onTextChange(
                    if (current.isEmpty()) body
                    else current + (if (current.endsWith(" ")) "" else " ") + body,
                )
            },
            onDismiss = { templatePickerOpen = false },
        )
    }
}

/** Plain auto-grow field: 1→6 lines then internal scroll. */
@Composable
fun ComposerField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
) {
    BasicTextField(
        value = value,
        onValueChange = onValueChange,
        textStyle = MaterialTheme.typography.bodyLarge.copy(
            color = MaterialTheme.colorScheme.onSurface,
        ),
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        maxLines = 6,
        modifier = modifier,
        decorationBox = { inner ->
            Box {
                if (value.isEmpty()) {
                    Text(
                        placeholder,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                inner()
            }
        },
    )
}

/**
 * Passive hints under the pill: the segment meter (visible from 2+ parts,
 * amber at 4+, flat 3 for MMS) and the merge-field live preview — the same
 * drop-empty substitution the server applies at send time.
 */
@Composable
fun ComposerHints(
    text: String,
    hasMedia: Boolean,
    contactName: String?,
    businessName: String?,
    modifier: Modifier = Modifier,
) {
    val meter = segmentMeter(text, hasMedia)
    val showPreview = MergeFields.hasMergeFields(text)
    if (!meter.visible && !showPreview) return
    Column(modifier.padding(horizontal = 20.dp)) {
        if (meter.visible) {
            Text(
                meter.label,
                style = MaterialTheme.typography.labelSmall,
                color = if (meter.warn) NoteAmber.ink()
                else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (showPreview) {
            Text(
                "Sends as: " + MergeFields.applyMergeFields(text, contactName, businessName),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun ModePill(
    label: String,
    selected: Boolean,
    selectedBg: Color,
    selectedInk: Color,
    onClick: () -> Unit,
) {
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = if (selected) selectedInk else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .background(
                if (selected) selectedBg else Color.Transparent,
                RoundedCornerShape(50),
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/** Removable photo previews above the pill. */
@Composable
fun PhotoChipsRow(
    photos: List<StagedPhoto>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        photos.forEach { photo ->
            Box(Modifier.padding(end = 8.dp)) {
                AsyncImage(
                    model = photo.uri,
                    contentDescription = "Attached photo",
                    modifier = Modifier
                        .size(56.dp)
                        .border(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                            RoundedCornerShape(8.dp),
                        ),
                )
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove photo",
                    tint = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(18.dp)
                        .background(MaterialTheme.colorScheme.surface, CircleShape)
                        .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
                        .clickable { onRemove(photo.id) },
                )
            }
        }
    }
}

/** Removable staged note-file chips. */
@Composable
fun FileChipsRow(
    files: List<StagedFile>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        files.forEach { file ->
            Row(
                Modifier
                    .padding(end = 8.dp)
                    .border(
                        1.dp,
                        MaterialTheme.colorScheme.outlineVariant,
                        RoundedCornerShape(16.dp),
                    )
                    .padding(start = 10.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    file.name,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 160.dp),
                )
                Spacer(Modifier.width(6.dp))
                Icon(
                    Icons.Filled.Close,
                    contentDescription = "Remove ${file.name}",
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { onRemove(file.id) },
                )
            }
        }
    }
}

/**
 * Saved-replies picker (spec 09): radius-30 canvas sheet, Bricolage header,
 * paper search pill, template rows in a PaperCard with Insert pills.
 * Search over GET /v1/templates, tap anywhere on a row to insert.
 */
@Composable
fun TemplatePickerSheet(
    loadTemplates: suspend () -> List<Template>,
    onPick: (body: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var state by remember { mutableStateOf<LoadState<List<Template>>>(LoadState.Loading) }
    var query by remember { mutableStateOf("") }
    var retryKey by remember { mutableStateOf(0) }

    LaunchedEffect(retryKey) {
        state = try {
            LoadState.Ready(loadTemplates())
        } catch (cause: Exception) {
            LoadState.Failed(cause.userMessage())
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.background,
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp),
        ) {
            Text(
                "Templates",
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 21.sp),
                color = MaterialTheme.colorScheme.onBackground,
            )
            when (val current = state) {
                is LoadState.Loading -> Box(
                    Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    androidx.compose.material3.LoadingIndicator()
                }

                is LoadState.Failed -> Column(
                    Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        current.message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        "Try again",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.secondary,
                        modifier = Modifier
                            .padding(top = 8.dp)
                            .clickable { retryKey++ },
                    )
                }

                is LoadState.Ready -> {
                    if (current.value.isEmpty()) {
                        Text(
                            "No saved replies yet. Create them on the web under Settings.",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 16.dp),
                        )
                    } else {
                        TemplateSearchPill(
                            query = query,
                            onQueryChange = { query = it },
                            modifier = Modifier.padding(top = 14.dp, bottom = 14.dp),
                        )
                        val matches = current.value.filter {
                            query.isBlank() ||
                                it.name.contains(query.trim(), ignoreCase = true) ||
                                it.body.contains(query.trim(), ignoreCase = true)
                        }
                        SectionHeader("Saved replies", count = matches.size)
                        Surface(
                            shape = MaterialTheme.shapes.large,
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(1f, fill = false),
                        ) {
                            LazyColumn(Modifier.fillMaxWidth()) {
                                itemsIndexed(
                                    matches,
                                    key = { _, template -> template.id },
                                ) { index, template ->
                                    if (index > 0) RowDivider()
                                    TemplateRow(
                                        template = template,
                                        onPick = { onPick(template.body) },
                                    )
                                }
                                if (matches.isEmpty()) {
                                    item {
                                        Text(
                                            "Nothing matches.",
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(16.dp),
                                        )
                                    }
                                }
                            }
                        }
                        Text(
                            "Type / in the composer to open these inline · " +
                                "shared with the crew",
                            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                                .copy(alpha = 0.75f),
                            textAlign = TextAlign.Center,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 14.dp),
                        )
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** Paper search pill with a muted stroke search glyph. */
@Composable
private fun TemplateSearchPill(
    query: String,
    onQueryChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        modifier = modifier
            .fillMaxWidth()
            .border(1.5.dp, MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape),
    ) {
        Row(
            Modifier.padding(horizontal = 15.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                modifier = Modifier.size(15.dp),
            )
            Spacer(Modifier.width(9.dp))
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium.copy(
                    fontSize = 13.sp,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                modifier = Modifier.weight(1f),
                decorationBox = { inner ->
                    Box {
                        if (query.isEmpty()) {
                            Text(
                                "Search templates…",
                                style = MaterialTheme.typography.bodyMedium.copy(
                                    fontSize = 13.sp,
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                    .copy(alpha = 0.7f),
                            )
                        }
                        inner()
                    }
                },
            )
        }
    }
}

/** One saved reply: bold title, two-line muted preview, Insert pill. */
@Composable
private fun TemplateRow(
    template: Template,
    onPick: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onPick)
            .padding(horizontal = 15.dp, vertical = 13.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                template.name,
                style = MaterialTheme.typography.titleSmall.copy(
                    fontSize = 13.5.sp,
                    fontWeight = FontWeight.Bold,
                ),
            )
            Text(
                template.body,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontSize = 12.sp,
                    lineHeight = 17.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Spacer(Modifier.width(11.dp))
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceContainer,
        ) {
            Text(
                "Insert",
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(horizontal = 13.dp, vertical = 7.dp),
            )
        }
    }
}
