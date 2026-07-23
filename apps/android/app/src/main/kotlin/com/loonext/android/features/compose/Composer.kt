package com.loonext.android.features.compose

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
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
import androidx.compose.material.icons.outlined.ContactPage
import androidx.compose.material.icons.outlined.Description as DescriptionOutlined
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.InsertDriveFile
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.loonext.android.core.model.Template
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.io.ByteArrayOutputStream
import java.util.Locale
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

enum class ComposerMode { Text, Note }

/** Loonext amber — notes/overdue accent, tuned per theme for contrast. */
object NoteAmber {
    val LightBg = BrandColor.Cream
    val LightInk = BrandColor.Amber
    val LightLine = BrandColor.InsetDeep
    val DarkBg = BrandColor.DarkRaised
    val DarkInk = BrandColor.DarkAmber
    val DarkLine = BrandColor.DarkOutline

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

    /**
     * Display metadata for staged MMS media, keyed by staged id (#189 file
     * chips need a name + size the wire format doesn't carry). Survives
     * [clearForSend] on purpose: a failed send [restore] puts the same staged
     * items back and their chips must still read.
     */
    var mediaInfo by mutableStateOf(mapOf<String, StagedMediaInfo>())

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
 * The Google-Messages-style composer pill: Text/Note mode toggle (tap the
 * pills or swipe the input sideways, #185), auto-grow field (internal scroll
 * past 6 lines), `/` opens saved replies, MMS attachments (#189: ≤3
 * deliverable files ≤1 MB each, images transcoded down), note files
 * (≤10 × 25 MB), passive segment meter, merge-field live preview. [banner]
 * replaces text mode with an explanatory card — notes stay available;
 * [noteOnly] is the viewer_level='note' gate.
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
    val haptics = rememberHaptics()
    val textBlocked = noteOnly || banner != null
    val isNote = textBlocked || state.mode == ComposerMode.Note

    var templatePickerOpen by remember { mutableStateOf(false) }
    var attachMenuOpen by remember { mutableStateOf(false) }

    val mediaPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments(),
    ) { uris ->
        if (uris.isEmpty()) return@rememberLauncherForActivityResult
        scope.launch {
            var trimmed = false
            for (uri in uris) {
                if (state.photos.size >= MAX_PHOTOS) {
                    trimmed = true
                    break
                }
                when (val result = stageMmsMedia(context, uri)) {
                    is MmsStageResult.Ready -> {
                        state.photos = state.photos + result.media
                        state.mediaInfo = state.mediaInfo + (result.media.id to result.info)
                    }

                    is MmsStageResult.Rejected -> onNotice(result.reason)
                }
            }
            if (trimmed) onNotice("You can attach up to $MAX_PHOTOS files per text.")
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
        haptics.confirm()
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
                    onClick = {
                        if (state.mode != ComposerMode.Text) haptics.tap()
                        state.mode = ComposerMode.Text
                    },
                )
                Spacer(Modifier.width(4.dp))
                ModePill(
                    label = "Note",
                    selected = state.mode == ComposerMode.Note,
                    selectedBg = NoteAmber.bg(),
                    selectedInk = NoteAmber.ink(),
                    onClick = {
                        if (state.mode != ComposerMode.Note) haptics.tap()
                        state.mode = ComposerMode.Note
                    },
                )
            }
        }

        if (!isNote && state.photos.isNotEmpty()) {
            PhotoChipsRow(
                photos = state.photos,
                onRemove = { id ->
                    haptics.tap()
                    state.photos = state.photos.filterNot { it.id == id }
                    state.mediaInfo = state.mediaInfo - id
                },
                info = state.mediaInfo,
            )
        }
        if (isNote && state.files.isNotEmpty()) {
            FileChipsRow(
                files = state.files,
                onRemove = { id ->
                    haptics.tap()
                    state.files = state.files.filterNot { it.id == id }
                },
            )
        }

        // Mode colors crossfade (#185) so a swipe reads as one smooth turn of
        // the pill, not a hard repaint.
        val pillBg by animateColorAsState(
            if (isNote) NoteAmber.bg() else MaterialTheme.colorScheme.surface,
            animationSpec = tween(durationMillis = 240),
            label = "composer-bg",
        )
        val pillLine by animateColorAsState(
            if (isNote) NoteAmber.line() else MaterialTheme.colorScheme.outlineVariant,
            animationSpec = tween(durationMillis = 240),
            label = "composer-line",
        )

        // #185: a horizontal swipe anywhere on the pill flips Text/Note. The
        // drag detector only sees gestures the field ignores — text selection
        // and cursor-handle drags consume their events first.
        val swipeThresholdPx = with(LocalDensity.current) { 56.dp.toPx() }
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .border(1.dp, pillLine, RoundedCornerShape(24.dp))
                .background(pillBg, RoundedCornerShape(24.dp))
                .pointerInput(textBlocked) {
                    if (textBlocked) return@pointerInput
                    var dragged = 0f
                    var toggled = false
                    detectHorizontalDragGestures(
                        onDragStart = {
                            dragged = 0f
                            toggled = false
                        },
                        onDragEnd = { dragged = 0f },
                        onDragCancel = { dragged = 0f },
                    ) { _, dragAmount ->
                        dragged += dragAmount
                        if (!toggled && abs(dragged) >= swipeThresholdPx) {
                            toggled = true
                            state.mode =
                                if (state.mode == ComposerMode.Text) ComposerMode.Note
                                else ComposerMode.Text
                            haptics.tap()
                        }
                    }
                }
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
                            text = { Text("Attach files") },
                            leadingIcon = {
                                Icon(Icons.Filled.AttachFile, contentDescription = null)
                            },
                            enabled = state.photos.size < MAX_PHOTOS,
                            onClick = {
                                attachMenuOpen = false
                                mediaPicker.launch(MMS_PICKER_MIME_TYPES)
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
                haptics.tap()
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
    // Crossfade with the pill body (#185) instead of snapping.
    val bg by animateColorAsState(
        if (selected) selectedBg else Color.Transparent,
        animationSpec = tween(durationMillis = 200),
        label = "mode-pill-bg",
    )
    val ink by animateColorAsState(
        if (selected) selectedInk else MaterialTheme.colorScheme.onSurfaceVariant,
        animationSpec = tween(durationMillis = 200),
        label = "mode-pill-ink",
    )
    Text(
        label,
        style = MaterialTheme.typography.labelMedium,
        color = ink,
        modifier = Modifier
            .background(bg, RoundedCornerShape(50))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    )
}

/**
 * Removable staged-media previews above the pill (#189): images keep their
 * thumbnail; any other deliverable file renders as a chip with its kind icon,
 * name, and size.
 */
@Composable
fun PhotoChipsRow(
    photos: List<StagedPhoto>,
    onRemove: (String) -> Unit,
    modifier: Modifier = Modifier,
    info: Map<String, StagedMediaInfo> = emptyMap(),
) {
    Row(
        modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 16.dp, vertical = 4.dp),
    ) {
        photos.forEach { photo ->
            if (photo.contentType.startsWith("image/")) {
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
            } else {
                StagedMediaChip(
                    photo = photo,
                    info = info[photo.id],
                    onRemove = onRemove,
                )
            }
        }
    }
}

/** A staged non-image MMS file: kind icon + name + size + remove (#189). */
@Composable
private fun StagedMediaChip(
    photo: StagedPhoto,
    info: StagedMediaInfo?,
    onRemove: (String) -> Unit,
) {
    val kind = mmsKindOf(photo.contentType)
    val name = info?.name?.takeIf { it.isNotBlank() } ?: kind.label
    Row(
        Modifier
            .padding(end = 8.dp)
            .border(
                1.dp,
                MaterialTheme.colorScheme.outlineVariant,
                RoundedCornerShape(16.dp),
            )
            .padding(start = 9.dp, end = 7.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            kind.icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.secondary,
            modifier = Modifier.size(15.dp),
        )
        Spacer(Modifier.width(7.dp))
        Column {
            Text(
                name,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.widthIn(max = 140.dp),
            )
            val size = info?.sizeBytes?.let(::stagedSizeLabel)
            if (size != null) {
                Text(
                    size,
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.width(7.dp))
        Icon(
            Icons.Filled.Close,
            contentDescription = "Remove $name",
            modifier = Modifier
                .size(16.dp)
                .clickable { onRemove(photo.id) },
        )
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

    AppSheet(
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
                // First-fetch shimmer in the row grammar the list will use.
                is LoadState.Loading -> SkeletonList(
                    modifier = Modifier.padding(top = 10.dp),
                    rows = 3,
                    avatar = false,
                )

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

// ---------------------------------------------------------------------------
// #189 — the MMS deliverable contract, mirrored from @loonext/shared/mms.ts.
// The API is the source of truth and re-validates; this exists so a pick that
// would 422 never round-trips.
// ---------------------------------------------------------------------------

/** Media types an outbound MMS may declare — the DELIVERABLE set. */
val MMS_OUTBOUND_MEDIA_TYPES = setOf(
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/mpeg", "audio/mp4", "audio/amr", "audio/wav", "audio/ogg", "audio/3gpp",
    "video/mp4", "video/3gpp", "video/quicktime",
    "application/pdf", "text/vcard", "text/x-vcard", "text/calendar", "text/plain",
)

/** What the system picker offers — steering, not the gate (the API is). */
val MMS_PICKER_MIME_TYPES = arrayOf(
    "image/*", "audio/*", "video/mp4", "video/3gpp",
    "application/pdf", "text/vcard", "text/x-vcard", "text/calendar",
)

/** Vendor/legacy MIME spellings normalized onto the canonical allow-list. */
private val MMS_TYPE_ALIASES = mapOf(
    "audio/x-m4a" to "audio/mp4",
    "audio/m4a" to "audio/mp4",
    "audio/x-wav" to "audio/wav",
    "audio/wave" to "audio/wav",
    "audio/vnd.wave" to "audio/wav",
    "audio/amr-nb" to "audio/amr",
    "audio/mp3" to "audio/mpeg",
    "video/3gp" to "video/3gpp",
    "text/directory" to "text/vcard",
)

/** Extension fallback for providers that report an empty/blank MIME type. */
private val MMS_EXTENSION_TYPES = mapOf(
    "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "png" to "image/png",
    "gif" to "image/gif", "webp" to "image/webp",
    "mp3" to "audio/mpeg", "m4a" to "audio/mp4", "amr" to "audio/amr",
    "wav" to "audio/wav", "ogg" to "audio/ogg", "oga" to "audio/ogg",
    "mp4" to "video/mp4", "3gp" to "video/3gpp", "mov" to "video/quicktime",
    "pdf" to "application/pdf", "vcf" to "text/vcard", "ics" to "text/calendar",
    "txt" to "text/plain",
)

/** Lowercase, parameters stripped, aliases mapped. */
fun canonicalMmsType(raw: String): String {
    val cleaned = raw.substringBefore(';').trim().lowercase(Locale.US)
    return MMS_TYPE_ALIASES[cleaned] ?: cleaned
}

/** The content type a picked file would be SENT as; null = not deliverable. */
fun mmsTypeForFile(declaredType: String?, name: String?): String? {
    val declared = canonicalMmsType(declaredType.orEmpty())
    if (declared in MMS_OUTBOUND_MEDIA_TYPES) return declared
    val extension = name.orEmpty().substringAfterLast('.', "").lowercase(Locale.US)
    return MMS_EXTENSION_TYPES[extension]
}

/** Coarse media kind for icons/labels — mirrors shared `mmsMediaKind`. */
enum class MmsKind(val label: String) {
    Image("Image"),
    Audio("Audio"),
    Video("Video"),
    Contact("Contact card"),
    Calendar("Calendar invite"),
    Document("PDF"),
    Text("Text file"),
    File("File"),
}

fun mmsKindOf(contentType: String?): MmsKind {
    val type = canonicalMmsType(contentType.orEmpty())
    return when {
        type.startsWith("image/") -> MmsKind.Image
        type.startsWith("audio/") -> MmsKind.Audio
        type.startsWith("video/") -> MmsKind.Video
        type == "text/vcard" || type == "text/x-vcard" -> MmsKind.Contact
        type == "text/calendar" -> MmsKind.Calendar
        type == "application/pdf" -> MmsKind.Document
        type.startsWith("text/") -> MmsKind.Text
        else -> MmsKind.File
    }
}

/** The stroke icon a kind renders with (file chips in composer + bubbles). */
val MmsKind.icon: ImageVector
    get() = when (this) {
        MmsKind.Audio -> Icons.Outlined.MusicNote
        MmsKind.Video -> Icons.Outlined.Videocam
        MmsKind.Contact -> Icons.Outlined.ContactPage
        MmsKind.Calendar -> Icons.Outlined.Event
        MmsKind.Document, MmsKind.Text -> Icons.Outlined.DescriptionOutlined
        MmsKind.Image, MmsKind.File -> Icons.Outlined.InsertDriveFile
    }

/** Display metadata for one staged MMS item (chips show name + size). */
data class StagedMediaInfo(val name: String?, val sizeBytes: Long?)

sealed interface MmsStageResult {
    data class Ready(val media: StagedPhoto, val info: StagedMediaInfo) : MmsStageResult
    data class Rejected(val reason: String) : MmsStageResult
}

/** "312 B" / "48 KB" / "0.9 MB" for staged chips. */
fun stagedSizeLabel(sizeBytes: Long): String = when {
    sizeBytes < 1024 -> "$sizeBytes B"
    sizeBytes < 1024 * 1024 -> "${(sizeBytes + 512) / 1024} KB"
    else -> String.format(Locale.US, "%.1f MB", sizeBytes / (1024.0 * 1024.0))
}

/**
 * Stage one picked document as outbound MMS media (#189): resolve name and
 * type, route images through the existing transcode pipeline (an oversized
 * photo still becomes deliverable), and hold everything else to the 1 MB
 * decoded ceiling. Rejection copy matches the web composer word for word.
 */
suspend fun stageMmsMedia(context: Context, uri: Uri): MmsStageResult =
    withContext(Dispatchers.IO) {
        val resolver = context.contentResolver
        var name: String? = null
        try {
            resolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    if (nameIdx >= 0) name = cursor.getString(nameIdx)
                }
            }
        } catch (_: Exception) {
            // Name is display-only; the type and bytes below decide admission.
        }
        val display = name?.trim()?.takeIf { it.isNotEmpty() }?.let { "\"$it\"" }
            ?: "That file"

        val contentType = mmsTypeForFile(resolver.getType(uri), name)
            ?: return@withContext MmsStageResult.Rejected(
                "$display isn't something a text can carry. " +
                    "Try a photo, video, audio clip, contact card, or PDF.",
            )

        if (contentType.startsWith("image/")) {
            return@withContext when (val result = preparePhoto(context, uri)) {
                is PhotoPrepResult.Ready -> MmsStageResult.Ready(
                    result.photo,
                    StagedMediaInfo(name, result.photo.bytes.size.toLong()),
                )

                is PhotoPrepResult.Rejected -> MmsStageResult.Rejected(result.reason)
            }
        }

        // Bounded read: stop past the ceiling instead of buffering a whole
        // phone video just to reject it.
        val bytes = try {
            resolver.openInputStream(uri)?.use { stream ->
                val out = ByteArrayOutputStream()
                val chunk = ByteArray(64 * 1024)
                while (out.size() <= MAX_PHOTO_BYTES) {
                    val read = stream.read(chunk)
                    if (read < 0) break
                    out.write(chunk, 0, read)
                }
                out.toByteArray()
            }
        } catch (_: Exception) {
            null
        } ?: return@withContext MmsStageResult.Rejected(
            "Couldn't read that file. Try picking it again.",
        )

        if (bytes.isEmpty()) {
            return@withContext MmsStageResult.Rejected("$display is empty.")
        }
        if (bytes.size > MAX_PHOTO_BYTES) {
            return@withContext MmsStageResult.Rejected(
                "$display is over 1 MB, the most a text can carry.",
            )
        }
        MmsStageResult.Ready(
            StagedPhoto(
                id = java.util.UUID.randomUUID().toString(),
                uri = uri,
                contentType = contentType,
                bytes = bytes,
            ),
            StagedMediaInfo(name, bytes.size.toLong()),
        )
    }
