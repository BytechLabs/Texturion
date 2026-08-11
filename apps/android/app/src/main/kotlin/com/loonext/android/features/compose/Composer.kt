package com.loonext.android.features.compose

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material.icons.outlined.AutoAwesome
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
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Videocam
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.time.TwoClocks
import com.loonext.android.features.thread.MentionLogic
import com.loonext.android.features.thread.MentionableMember
import com.loonext.android.features.thread.PickedMention
import com.loonext.android.core.model.DestinationClock
import com.loonext.android.core.compose.OnMyWay
import com.loonext.android.core.model.Message
import com.loonext.android.features.thread.theirTimeLine
import com.loonext.android.core.model.ReplySuggestions
import com.loonext.android.core.model.replyDraftMessage
import com.loonext.android.core.model.Template
import com.loonext.android.core.scheduled.ScheduledSend
import com.loonext.android.ui.common.AiOrb
import com.loonext.android.ui.common.AiOrbState
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import com.loonext.android.ui.theme.BrandColor
import java.io.ByteArrayOutputStream
import java.time.ZoneId
import java.time.Instant
import java.util.Locale
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import androidx.compose.ui.text.style.TextDecoration

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
 * Draft writes run here, NOT on the composition's scope (#269).
 *
 * ThreadScreen is a routed overlay: a back press removes it from the
 * composition immediately, which cancelled `rememberCoroutineScope()` and with
 * it the pending 400 ms debounce — so anyone who typed and left inside that
 * window found an empty composer next time, with nothing to say the words had
 * ever existed. `clearForSend()` had the mirror-image bug: a just-sent message
 * came back as a draft. A draft write is not screen work; it must finish
 * whatever the user does next. (The iOS twin uses an unstructured Task for the
 * same reason.)
 *
 * Process-lifetime by design and cheap: at most one small DataStore write per
 * composer, and the writes are what the user would otherwise lose.
 */
internal val DraftPersistScope: CoroutineScope =
    CoroutineScope(SupervisorJob() + Dispatchers.IO)

/** How long typing settles before a draft is written. */
private const val DRAFT_DEBOUNCE_MS = 400L

/**
 * Composer state hoisted out of the UI so the thread controller can restore a
 * failed send. Text persists as a per-conversation client draft (the server
 * keeps none) with a debounced write.
 */
@Stable
class ComposerState(
    private val draftKey: String,
    private val drafts: ComposerDrafts,
    /** See [DraftPersistScope] — deliberately NOT the composition's scope. */
    private val scope: CoroutineScope = DraftPersistScope,
) {
    var text by mutableStateOf("")
        private set
    var mode by mutableStateOf(ComposerMode.Text)
    var photos by mutableStateOf(listOf<StagedPhoto>())
    var files by mutableStateOf(listOf<StagedFile>())

    /**
     * #294: whether these photos are the before or the after.
     *
     * Null unless somebody says otherwise. Defaulting to "before" would mislabel
     * most notes, and a job record that is confidently wrong is worse than one
     * that says nothing.
     */
    var workPhase by mutableStateOf<String?>(null)

    /**
     * Display metadata for staged MMS media, keyed by staged id (#189 file
     * chips need a name + size the wire format doesn't carry). Survives
     * [clearForSend] on purpose: a failed send [restore] puts the same staged
     * items back and their chips must still read.
     */
    var mediaInfo by mutableStateOf(mapOf<String, StagedMediaInfo>())

    /**
     * Teammates named on a NOTE draft. Ids come from what was picked, never
     * from re-reading the draft for "@name": display names are neither unique
     * nor prefix-free, so parsing notifies the wrong people. Deleting a name
     * from the text still withdraws that mention at send time.
     */
    var picked by mutableStateOf(listOf<PickedMention>())
        private set

    private var draftLoaded = false
    private var saveJob: Job? = null

    /**
     * #408: when this draft began — the moment the composer first held text.
     *
     * Held in memory rather than persisted with the draft, deliberately. A
     * draft restored after the process died has no start moment we can
     * honestly claim, and the predicate treats null as "do not warn": a
     * confirmation we cannot justify is worse than none, because the first
     * false one teaches people to dismiss the true ones.
     */
    var draftStartedAt by mutableStateOf<String?>(null)
        private set

    fun onTextChange(value: String) {
        text = value
        draftStartedAt = if (value.isBlank()) {
            null
        } else {
            draftStartedAt ?: java.time.Instant.now().toString()
        }
        queueDraftSave()
    }

    suspend fun loadDraftOnce() {
        if (draftLoaded) return
        draftLoaded = true
        val saved = drafts.load(draftKey)
        if (text.isEmpty() && saved.isNotEmpty()) text = saved
        // The picks ride with the words; restoring one without the other makes
        // the draft lie about who it will notify.
        if (picked.isEmpty()) picked = drafts.loadMentions(draftKey)
    }

    fun addMention(mention: PickedMention) {
        picked = picked + mention
        queueDraftSave()
    }

    private fun queueDraftSave() {
        // Capture what is on screen NOW: the write runs after the screen may
        // be gone, and it must record the words the user actually typed.
        val body = text
        val mentions = picked
        saveJob?.cancel()
        saveJob = scope.launch {
            delay(DRAFT_DEBOUNCE_MS)
            drafts.save(draftKey, body)
            drafts.saveMentions(draftKey, mentions)
        }
    }

    /** Clear immediately on send — fast by feel; the queued row is the UI. */
    fun clearForSend() {
        text = ""
        // #408: the next draft is a new one, and its warning must be judged
        // against when IT began, not against a moment two sends ago.
        draftStartedAt = null
        photos = emptyList()
        files = emptyList()
        picked = emptyList()
        workPhase = null
        saveJob?.cancel()
        scope.launch { drafts.clear(draftKey) }
    }

    /** Failed send: put the draft back exactly as it was. */
    fun restore(
        body: String,
        photos: List<StagedPhoto>,
        files: List<StagedFile>,
        picked: List<PickedMention> = emptyList(),
    ) {
        text = body
        this.photos = photos
        this.files = files
        this.picked = picked
        queueDraftSave()
    }
}

@Composable
fun rememberComposerState(
    draftKey: String,
    drafts: ComposerDrafts,
): ComposerState {
    val state = remember(draftKey) { ComposerState(draftKey, drafts) }
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
 * [noteOnly] is the viewer_level='note' gate. [readOnly] (#315) is the
 * stronger one: a view-only observer may do NEITHER, so the card is all there
 * is. Leaving the note box under it would offer a write the API refuses, and
 * the worst version of that is somebody believing they left a note.
 */
@Composable
fun ThreadComposer(
    state: ComposerState,
    noteOnly: Boolean,
    /** #315: view-only — no text box and no note box, just the reason. */
    readOnly: Boolean = false,
    /**
     * #302: called on each keystroke of a REPLY so teammates on this thread can
     * see somebody is answering. Throttled by the caller — the keystroke rate is
     * not the broadcast rate. Notes deliberately do not signal: a note goes to
     * the crew, and nobody is racing to answer the customer with it.
     */
    onTyping: (() -> Unit)? = null,
    banner: ComposerBanner?,
    contactName: String?,
    businessName: String?,
    /** #274: the contact's service address, for {address} in the preview. */
    contactAddress: String? = null,
    /** #274: the signed-in member, for {my_name}. */
    senderName: String? = null,
    /** #274: this conversation's number in E.164, for {our_number}. */
    ourNumberE164: String? = null,
    loadTemplates: suspend () -> List<Template>,
    onSendText: (
        body: String,
        photos: List<StagedPhoto>,
        /** #475: the saved reply this was built from, if any. */
        templateId: String?,
        /** #274: whether the words changed after it was inserted. */
        templateEdited: Boolean,
    ) -> Unit,
    /**
     * #520: does this thread have a job due TODAY? Decided by the screen, not
     * here — this composable stays presentational, and "today" is a question
     * about the device's clock and the task list rather than about a draft.
     *
     * False hides the affordance entirely rather than disabling it: a control
     * that is present and inert still costs a reader the moment it takes to
     * work out why it does nothing, on a toolbar that already carries five.
     */
    hasJobToday: Boolean = false,
    /** #520: send "on my way — about N minutes", where N is the tap. */
    onSendOnMyWay: ((Int) -> Unit)? = null,
    /**
     * #408: the newest outbound in this thread, so the send boundary can ask
     * before landing on top of a colleague's answer. Null means "nothing to
     * compare", which never warns.
     */
    lastOutbound: Message? = null,
    /** Resolves the sender to a display name — "Sam replied" is a fact
     *  somebody can act on, "someone replied" is not. */
    memberName: (String) -> String? = { null },
    meUserId: String = "",
    onSaveNote: (
        body: String,
        files: List<StagedFile>,
        mentionUserIds: List<String>,
        workPhase: String?,
    ) -> Unit,
    onNotice: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Ask for AI-drafted replies. Null hides the affordance entirely. */
    suggestReplies: (suspend (draft: String) -> ReplySuggestions)? = null,
    /**
     * #507: write down a wrap-up the member speaks after a call has ended, so
     * the words can be checked and posted as an internal note. Their own voice,
     * on their own phone, about a call that is over — never the call, never the
     * customer (D117).
     *
     * Null hides the microphone entirely: a compose screen with no conversation
     * behind it yet has nowhere to send the audio, and an affordance that only
     * ever fails is worse than no affordance.
     */
    transcribeWrapUp: (suspend (audio: ByteArray, seconds: Int) -> WrapUpTranscript)? = null,
    /**
     * #431: report what happened to one of Lou's drafts — sent as written, sent
     * after changes, or shown and not used. Enum only; the draft's words never
     * leave the device for this. Null skips the measurement (a screen with no
     * company context behind it), never the send.
     */
    reportAiOutcome: ((feature: String, outcome: String) -> Unit)? = null,
    /**
     * Open the AI settings, offered under the drafts when Lou has not been
     * told what the business does. Null withholds the offer rather than
     * printing a sentence with nothing behind it.
     */
    onOpenAiSettings: (() -> Unit)? = null,
    /**
     * Place a call to this customer, offered by a banner that blocks texting
     * but not calling. Null withholds it (a member without text level on the
     * number would be refused by the API).
     */
    onCallInstead: (() -> Unit)? = null,
    /** #253: report THIS failure. Null withholds the offer entirely. */
    onReportBanner: ((ComposerBanner) -> Unit)? = null,
    /**
     * Who may be named on a note here. Null withholds mentions entirely rather
     * than opening a picker with nothing behind it.
     */
    loadMentionableMembers: (suspend () -> List<MentionableMember>)? = null,
    /**
     * Identifies this thread AT ITS CURRENT POINT, so drafts already paid for
     * are reused until a message in either direction retires them. Null skips
     * the cache entirely (a compose screen with no thread behind it yet).
     */
    draftCacheKey: String? = null,
    /**
     * #225: what time it is where the customer is. Null, or a daytime clock,
     * shows nothing — the line exists only for the hour that would change what
     * somebody does, and a clock on screen all day is furniture.
     */
    destinationClock: DestinationClock? = null,
    /**
     * #233: queue this text for [sendAtIso] instead of sending it now.
     *
     * Returns what the API said, because a quiet-hours 409 is a QUESTION rather
     * than a failure — the composer asks and retries with the flag, which is
     * #225 ask 2 (warned, never blocked). Null hides the affordance entirely: a
     * screen with no conversation behind it has nothing to schedule against,
     * and an affordance that only ever fails is worse than no affordance.
     */
    onScheduleSend: (
        suspend (body: String, sendAtIso: String, quietHoursConfirmed: Boolean) -> ScheduleOutcome
    )? = null,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    val locale = LocalAppLocale.current
    // Read in composition. Everything below is a coroutine, a permission
    // callback or a picker result — none of them a place a @Composable lookup
    // can go, and all of them places this composer says something.
    val wrapUpLostCopy = t("thread.wrapUpLost")
    val micAllowedCopy = t("thread.micAllowed")
    val micDeniedCopy = t("thread.micDeniedWrapUp")
    val micStartFailedCopy = t("thread.micStartFailed")
    val attachLimitTextCopy = t("thread.attachLimitText", "max" to "$MAX_PHOTOS")
    val attachLimitNoteCopy = t("thread.attachLimitNote")
    val teammateName = t("thread.teammate")
    /** #294: the staged photo open in the markup editor, if any. */
    var markingUp by remember { mutableStateOf<StagedFile?>(null) }
    var markingUpBytes by remember { mutableStateOf<ByteArray?>(null) }
    val textBlocked = noteOnly || banner != null
    val isNote = textBlocked || state.mode == ComposerMode.Note

    var templatePickerOpen by remember { mutableStateOf(false) }
    var mentionPickerOpen by remember { mutableStateOf(false) }

    /**
     * #475: which saved reply is in the box, and what it said when it arrived.
     *
     * Compared at SEND time rather than tracked per keystroke: the question
     * #274 asks is "did this go out different from the template", and somebody
     * who types a word and deletes it did not edit anything.
     */
    var templateUse by remember { mutableStateOf<TemplateUse?>(null) }
    var mentionRows by remember { mutableStateOf(listOf<MentionableMember>()) }
    var attachMenuOpen by remember { mutableStateOf(false) }
    // Drafts are kept per conversation until it moves: asking costs a real AI
    // call, so closing the strip and opening it again, or leaving and coming
    // back, must not spend again (see DraftSuggestionsCache).
    var suggestions by remember { mutableStateOf<List<String>>(emptyList()) }
    // Reported with the drafts: Lou was never told what this business does.
    // Held for the life of the composer rather than re-fetched, since it only
    // changes when someone writes the line.
    var businessUnknown by remember { mutableStateOf(false) }
    var suggesting by remember { mutableStateOf(false) }
    /**
     * #431: which of Lou's drafts (if any) was taken into the composer, and
     * whether any were shown at all. Kept so the outcome can be judged at the
     * moment of sending — the only moment that says whether it was useful.
     */
    var pickedSuggestion by remember { mutableStateOf<String?>(null) }
    var suggestionsWereShown by remember { mutableStateOf(false) }

    // ----------------------------------------------------------------------
    // #507: the dictated wrap-up.
    //
    // Hoisted here rather than kept inside the button because two places show
    // it — the counter line above the pill and the microphone inside it — and
    // a member holding a button needs to see the clock, not just the icon
    // under their thumb.
    // ----------------------------------------------------------------------
    var wrapUpPhase by remember { mutableStateOf(WrapUpPhase.Idle) }
    var wrapUpElapsed by remember { mutableIntStateOf(0) }
    /** The last words Lou wrote down, until the note carrying them is saved. */
    var wrapUpDictated by remember { mutableStateOf<String?>(null) }
    val wrapUpRecorder = remember(context) { WrapUpRecorder(context) }
    // The one teardown the gesture cannot do for itself: a back press or a
    // rotation mid-hold cancels the pointer coroutine before it ever reaches
    // its release, and the whole promise of this feature is that no audio is
    // left behind. Deleting here covers every way out of the composition.
    DisposableEffect(wrapUpRecorder) {
        onDispose { wrapUpRecorder.discard() }
    }

    // Leaving note mode mid-hold. The mic button and the recording counter both
    // live inside the note branch, so when `isNote` flips false they leave the
    // composition — taking away the only control that stops the recording AND
    // the only thing on screen saying one is running. The microphone stays
    // open with nothing to show for it, which is precisely the impression this
    // feature cannot afford to give.
    //
    // `isNote` is not only the mode pill: `textBlocked` forces it true while a
    // banner is up, so a banner clearing underneath a member who is mid-hold
    // flips it with no gesture at all.
    LaunchedEffect(isNote) {
        if (!isNote && wrapUpPhase != WrapUpPhase.Idle) {
            withContext(Dispatchers.IO) { wrapUpRecorder.discard() }
            wrapUpPhase = WrapUpPhase.Idle
            wrapUpElapsed = 0
        }
    }

    val finishWrapUp: () -> Unit = {
        if (wrapUpPhase == WrapUpPhase.Recording) {
            // Moved out of Recording before the disk work rather than after, so
            // a second press cannot start a recording on top of this one. A
            // hold too short to be a wrap-up passes through this state in a few
            // milliseconds, which is below the threshold of anything visible.
            wrapUpPhase = WrapUpPhase.Sending
            scope.launch {
                // stop() and the read both touch the disk, and this runs the
                // instant a finger lifts — off the main thread so the release
                // does not stutter.
                val finished = withContext(Dispatchers.IO) { wrapUpRecorder.finish() }
                if (finished !is WrapUpFinish.Ready) {
                    // A brush of the button is silent on purpose — a sentence
                    // after every mis-tap is noise, and nothing was spent. A
                    // recorder that BROKE is not the same event: somebody
                    // watched the counter tick and is owed an explanation.
                    if (finished is WrapUpFinish.Failed) {
                        onNotice(wrapUpLostCopy)
                    }
                    wrapUpPhase = WrapUpPhase.Idle
                } else {
                    val recording = finished.recording
                    val written = try {
                        transcribeWrapUp?.invoke(recording.audio, recording.seconds)
                    } catch (e: CancellationException) {
                        throw e // the screen went away; nothing to say to nobody
                    } catch (cause: Exception) {
                        // The server's own sentence, not a reason string: a
                        // refused capability or a dead session says something
                        // truer than "couldn't write that down".
                        onNotice(cause.userMessage())
                        null
                    }
                    wrapUpPhase = WrapUpPhase.Idle
                    val words = written?.text?.trim().orEmpty()
                    if (written != null && words.isEmpty()) {
                        onNotice(wrapUpDictationMessage(written.reason))
                    } else if (words.isNotEmpty()) {
                        // The draft is shared between the two modes, and a
                        // wrap-up dictated into the note box must never surface
                        // in a box addressed to the customer — so if the mode
                        // moved while Lou was writing, it moves back. The words
                        // were spoken for a note.
                        if (state.mode != ComposerMode.Note) state.mode = ComposerMode.Note
                        // Remembered so the save can say whether these words
                        // went out as spoken or were corrected first.
                        wrapUpDictated = words
                        // Into the box, NEVER straight onto the thread. Every
                        // AI output in this product is a suggestion somebody
                        // reads and edits first, and the note route the Save
                        // button already uses stays the only way a note is
                        // written. Appended, so words typed while it was
                        // thinking survive.
                        val current = state.text
                        val joiner =
                            if (current.isEmpty() ||
                                current.endsWith(" ") ||
                                current.endsWith("\n")
                            ) "" else " "
                        state.onTextChange(current + joiner + words)
                        haptics.tap()
                    }
                }
            }
        }
    }

    // The cap, enforced where the member can see it: the counter stops at two
    // minutes and the recording is sent rather than thrown away, because two
    // minutes of somebody talking is content. MediaRecorder holds the same
    // ceiling itself — a missed tick must not leave a microphone open.
    LaunchedEffect(wrapUpPhase) {
        if (wrapUpPhase != WrapUpPhase.Recording) return@LaunchedEffect
        while (wrapUpPhase == WrapUpPhase.Recording) {
            wrapUpElapsed = wrapUpRecorder.elapsedSeconds()
            if (wrapUpElapsed >= WrapUpDictation.MAX_SECONDS) {
                finishWrapUp()
                break
            }
            delay(WRAP_UP_TICK_MS)
        }
    }

    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        // Nothing is recorded either way: answering a system dialog means the
        // button was released, and there is no hold left to record. Both
        // sentences therefore say what to do next, and both leave the member in
        // the note box with a keyboard.
        onNotice(if (granted) micAllowedCopy else micDeniedCopy)
    }

    val askForSuggestions: () -> Unit = {
        val ask = suggestReplies
        val cached = draftCacheKey?.let { DraftSuggestionsCache.read(it) }
        if (cached != null) {
            // Already drafted for this thread, and nothing has happened since:
            // show what Lou wrote rather than paying for the same answer twice.
            suggestions = cached
            // #431: shown but not taken. A send from here counts as discarded.
            suggestionsWereShown = true
        } else if (ask != null && !suggesting) {
            suggesting = true
            suggestions = emptyList()
            scope.launch {
                val drafted = ask(state.text)
                suggesting = false
                if (drafted.suggestions.isEmpty()) {
                    onNotice(replyDraftMessage(drafted.reason))
                } else {
                    suggestions = drafted.suggestions
                    businessUnknown = drafted.business_unknown
                    suggestionsWereShown = true
                    draftCacheKey?.let { DraftSuggestionsCache.write(it, drafted.suggestions) }
                }
            }
        }
    }

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
            if (trimmed) onNotice(attachLimitTextCopy)
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
        if (trimmed) onNotice(attachLimitNoteCopy)
    }

    val canSend = if (isNote) {
        state.text.isNotBlank() || state.files.isNotEmpty()
    } else {
        state.text.isNotBlank() || state.photos.isNotEmpty()
    }

    var confirmCollision by remember { mutableStateOf(false) }

    // #233 send later. The sheet, the picker and the quiet-hours question are
    // owned HERE rather than by the caller, because the words being scheduled
    // live in this box: a 409 has to leave the draft where it is so the second
    // attempt still has something to send.
    var sendLaterOpen by remember { mutableStateOf(false) }
    var pickTimeOpen by remember { mutableStateOf(false) }
    var quietConfirmFor by remember { mutableStateOf<Instant?>(null) }
    val canScheduleLater = onScheduleSend != null && !isNote && canSend

    /**
     * Queue what is in the box, and clear it exactly as a send would.
     *
     * The clear happens on SUCCESS only. The words have left the box and are
     * somewhere the person can see them; a draft left behind would be sent
     * twice by anybody who assumed otherwise, and a draft cleared on a refusal
     * would be a message nobody can recover.
     */
    fun scheduleFor(at: Instant, quietHoursConfirmed: Boolean = false) {
        val schedule = onScheduleSend ?: return
        val body = state.text.trim()
        if (body.isEmpty()) return
        scope.launch {
            when (schedule(body, at.toString(), quietHoursConfirmed)) {
                ScheduleOutcome.Scheduled -> {
                    haptics.confirm()
                    quietConfirmFor = null
                    state.clearForSend()
                    templateUse = null
                    // #539: the confirmation names the clock too. It used to
                    // render the customer's time unlabelled, so the one sentence
                    // telling somebody what they had just scheduled was the same
                    // trap as the queued row it was confirming.
                    onNotice(
                        AppStrings.translate(
                            locale,
                            "thread.scheduledConfirm",
                            mapOf(
                                "when" to TwoClocks.bothClocks(
                                    sendAtLabel(at, destinationZone(destinationClock)),
                                    sendAtLabel(at, ZoneId.systemDefault()),
                                ),
                            ),
                        ) + " " + ScheduledSend.copy("picker_reassurance"),
                    )
                }

                ScheduleOutcome.NeedsQuietHoursConfirm -> quietConfirmFor = at
                // The caller has already said what went wrong, in the API's own
                // words. A second sentence written here would either repeat it
                // or contradict it.
                ScheduleOutcome.Failed -> quietConfirmFor = null
            }
        }
    }

    fun send() {
        haptics.confirm()
        val body = state.text.trim()
        // #431: judge Lou's draft against what is actually being sent, before
        // the composer is cleared. Notes are excluded — a note reaches no
        // customer, so a draft was never in play. Cleared either way, so one
        // draft can only ever yield one outcome.
        if (!isNote) {
            val outcome = AiOutcome.forDraft(
                shown = pickedSuggestion != null || suggestionsWereShown,
                picked = pickedSuggestion,
                sent = body,
            )
            pickedSuggestion = null
            suggestionsWereShown = false
            if (outcome != null) {
                reportAiOutcome?.invoke(AiOutcome.FEATURE_SUGGEST_REPLY, outcome)
            }
        }
        if (isNote) {
            val files = state.files
            val mentionIds = MentionLogic.resolveMentions(body, state.picked)
            // #431/#507: what became of the dictation. The server's spec says
            // this is the whole reason the route hands back text rather than
            // writing the note itself — a suggestion somebody reads can be
            // measured. Reported only when there WAS one, so an ordinary typed
            // note is not counted as a rejection of a wrap-up that never
            // happened.
            val dictated = wrapUpDictated
            if (dictated != null) {
                reportAiOutcome?.invoke(
                    AiOutcome.FEATURE_CALL_WRAPUP,
                    AiOutcome.forWrapUp(dictated, posted = true, saved = body),
                )
                wrapUpDictated = null
            }
            val phase = state.workPhase
            state.clearForSend()
            onSaveNote(body, files, mentionIds, phase)
        } else {
            val photos = state.photos
            state.clearForSend()
            // #475/#274: what it came from, and whether the crew changed it.
            val used = templateUse
            onSendText(
                body,
                photos,
                used?.templateId,
                used != null && used.body.trim() != body.trim(),
            )
            // The box is empty again, so whatever was inserted is spent. A
            // template left attached would tag the NEXT message too.
            templateUse = null
        }
    }

    /**
     * #408: the send boundary. A teammate answering this customer while the
     * draft was being written is the one thing worth a pause here.
     *
     * A WARNING, NOT A BLOCK. A duplicate reply is genuinely better than no
     * reply, and anything discouraging a tech from answering works against the
     * five-minute window that decides the job. Notes skip it entirely — they
     * reach no customer, so there is no collision to have.
     */
    fun submit() {
        if (!canSend) return
        val collision = duplicateReplyWarning(
            draftStartedAt = state.draftStartedAt,
            lastOutboundAt = lastOutbound?.created_at,
            lastOutboundByUserId = lastOutbound?.sent_by_user_id,
            meUserId = meUserId,
        )
        if (!isNote && collision.warn) {
            confirmCollision = true
            return
        }
        send()
    }

    if (confirmCollision) {
        val secondsAgo = lastOutbound?.created_at
            ?.let {
                runCatching {
                    java.time.Duration.between(java.time.Instant.parse(it), java.time.Instant.now())
                        .seconds
                }.getOrDefault(0L)
            }
            ?.coerceAtLeast(0L) ?: 0L
        AlertDialog(
            onDismissRequest = { confirmCollision = false },
            title = { Text(t("thread.collisionTitle")) },
            text = {
                Text(
                    duplicateReplyPrompt(
                        lastOutbound?.sent_by_user_id?.let(memberName),
                        secondsAgo,
                    ) + t("thread.collisionAsk"),
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmCollision = false
                    send()
                }) { Text(t("thread.sendAnyway")) }
            },
            dismissButton = {
                TextButton(onClick = { confirmCollision = false }) {
                    Text(t("thread.letMeLook"))
                }
            },
        )
    }

    if (readOnly) {
        Column(modifier.fillMaxWidth()) {
            if (banner != null) {
                ComposerBannerCard(
                    banner,
                    onCallInstead = onCallInstead,
                    onReport = onReportBanner?.let { report -> { report(banner) } },
                )
            }
        }
        return
    }

    Column(modifier.fillMaxWidth()) {
        if (banner != null) {
            ComposerBannerCard(
                banner,
                onCallInstead = onCallInstead,
                onReport = onReportBanner?.let { report -> { report(banner) } },
            )
        }

        // #520: above the box, and only when there is a job today. Not on a
        // note — a note goes to the crew, and "on my way" is for the customer.
        val sendOnMyWay = onSendOnMyWay
        if (!noteOnly && hasJobToday && sendOnMyWay != null) {
            var choosing by remember { mutableStateOf(false) }
            if (choosing) {
                Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            OnMyWay.Copy.PROMPT,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        for (minutes in OnMyWay.PRESETS) {
                            OutlinedButton(onClick = {
                                choosing = false
                                sendOnMyWay(minutes)
                            }) { Text(OnMyWay.presetLabel(minutes)) }
                        }
                        TextButton(onClick = { choosing = false }) { Text(t("common.cancel")) }
                    }
                    // What the next tap does, said before it is tapped.
                    Text(
                        OnMyWay.Copy.GATED_NOTE,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                TextButton(
                    onClick = { choosing = true },
                    modifier = Modifier.padding(start = 8.dp, top = 2.dp),
                ) { Text(OnMyWay.Copy.ACTION) }
            }
        }

        // #225: above the box, below any banner. Never shown for a notes-only
        // member — an internal note has no recipient to wake up.
        if (!noteOnly) {
            theirTimeLine(destinationClock)?.let { line ->
                Text(
                    line,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp),
                )
            }
        }

        if (!textBlocked) {
            Row(
                Modifier.padding(start = 16.dp, top = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ModePill(
                    label = t("thread.modeText"),
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
                    label = t("thread.modeNote"),
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

        if (!isNote && (suggestions.isNotEmpty() || suggesting)) {
            ReplySuggestionsRow(
                suggestions = suggestions,
                loading = suggesting,
                businessUnknown = businessUnknown,
                onTellLou = onOpenAiSettings,
                onUse = { suggestion ->
                    haptics.tap()
                    state.onTextChange(suggestion)
                    suggestions = emptyList()
                    // #431: taken into the composer. Whether it was CHANGED is
                    // decided at send time by comparing it with what goes out.
                    pickedSuggestion = suggestion
                    suggestionsWereShown = false
                },
                onDismiss = {
                    suggestions = emptyList()
                    // #431: closed the strip without taking one. Reported now
                    // rather than deferred to a send that may never come.
                    if (suggestionsWereShown) {
                        suggestionsWereShown = false
                        reportAiOutcome?.invoke(
                            AiOutcome.FEATURE_SUGGEST_REPLY,
                            AiOutcome.DISCARDED,
                        )
                    }
                },
            )
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
                onMarkUp = { id ->
                    haptics.tap()
                    markingUp = state.files.firstOrNull { it.id == id }
                },
            )
            // #294 — the marks are burned into the staged bytes and the file is
            // replaced, so what uploads is an ordinary note attachment. D28 keeps
            // two doors, and this does not add a third.
            val opened = markingUp
            LaunchedEffect(opened?.id) {
                markingUpBytes =
                    if (opened == null) null else readStagedFile(context, opened)
                // A photo the phone cannot read is a photo it cannot mark up.
                if (opened != null && markingUpBytes == null) markingUp = null
            }
            PhotoMarkupSheet(
                bytes = markingUpBytes,
                onCancel = {
                    markingUp = null
                    markingUpBytes = null
                },
                onDone = { marked ->
                    val target = opened
                    markingUp = null
                    markingUpBytes = null
                    if (target != null) {
                        scope.launch {
                            val replacement = stageMarkedUpPhoto(context, target, marked)
                            // Keeping the unmarked original beats losing the photo:
                            // an arrow that did not save is annoying, a missing
                            // picture is not acceptable.
                            if (replacement != null) {
                                state.files = state.files.map { staged ->
                                    if (staged.id == target.id) replacement else staged
                                }
                            }
                        }
                    }
                },
            )
            // #294: only once there are photos to describe. A before/after choice on
            // a text-only note is noise on the most common thing anybody does here.
            WorkPhaseRow(
                value = state.workPhase,
                onChange = { next ->
                    haptics.tap()
                    state.workPhase = next
                },
            )
        }

        // #507: the clock, where the words will land rather than under the
        // thumb that is covering the button. Present ONLY while something is
        // happening — a line that sat there all day would be furniture, which
        // is the same reasoning theirTimeLine above it follows.
        if (isNote && wrapUpPhase != WrapUpPhase.Idle) {
            val recording = wrapUpPhase == WrapUpPhase.Recording
            Text(
                if (recording) {
                    t(
                        "thread.wrapUpRecording",
                        "elapsed" to WrapUpDictation.elapsedLabel(wrapUpElapsed),
                    )
                } else {
                    t("thread.wrapUpWriting")
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (recording) {
                    NoteAmber.ink()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 6.dp),
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
                            contentDescription = t("thread.addToMessage"),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    DropdownMenu(
                        expanded = attachMenuOpen,
                        onDismissRequest = { attachMenuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text(t("thread.attachFiles")) },
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
                            text = { Text(t("thread.savedReply")) },
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

                // Lou sits in the row, not inside the overflow: asking for a
                // draft was two taps and a menu, which is more work than
                // typing the reply.
                if (suggestReplies != null) {
                    IconButton(
                        onClick = { askForSuggestions() },
                        enabled = !suggesting,
                    ) {
                        AiOrb(
                            state = if (suggesting) AiOrbState.Thinking else AiOrbState.Idle,
                            contentDescription = if (state.text.isBlank()) {
                                t("thread.draftWithLou")
                            } else {
                                t("thread.finishWithLou")
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
                        contentDescription = t("thread.attachFilesToNote"),
                        tint = NoteAmber.ink(),
                    )
                }

                // #507. In the row beside the paperclip rather than behind a
                // menu, for the reason Lou's orb is: somebody who has just hung
                // up and is standing at a truck will type the note before they
                // will find a two-tap affordance.
                if (transcribeWrapUp != null) {
                    WrapUpMicButton(
                        phase = wrapUpPhase,
                        onStart = suspend {
                            val granted = context.checkSelfPermission(
                                Manifest.permission.RECORD_AUDIO,
                            ) == PackageManager.PERMISSION_GRANTED
                            when {
                                // Asked at the point of use, never on arrival:
                                // the microphone makes sense here and nowhere
                                // else in a messaging screen.
                                !granted -> {
                                    micPermission.launch(Manifest.permission.RECORD_AUDIO)
                                    false
                                }
                                // A mic held by a live call, or an OEM that
                                // refuses the encoder. Says so and stops —
                                // there is still a keyboard.
                                //
                                // Off the main thread: prepare() writes a file
                                // header and start() blocks until the audio
                                // source opens, which is a couple of hundred
                                // milliseconds on a mid-range phone and would
                                // otherwise be a stutter under the finger.
                                !withContext(Dispatchers.IO) { wrapUpRecorder.start() } -> {
                                    onNotice(micStartFailedCopy)
                                    false
                                }

                                else -> {
                                    haptics.tap()
                                    wrapUpElapsed = 0
                                    wrapUpPhase = WrapUpPhase.Recording
                                    true
                                }
                            }
                        },
                        onFinish = finishWrapUp,
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
                        if (!isNote && value.isNotEmpty()) onTyping?.invoke()
                        // "@" at the start of a note or after a space names a
                        // teammate. Mid-word it belongs to an email address or
                        // a rate like "2 hrs @ $95", so the picker stays shut
                        // and the character is always kept.
                        // A single appended character, so a stale "@" already
                        // sitting at the end cannot re-open the picker on an
                        // unrelated edit.
                        if (isNote &&
                            value.length == state.text.length + 1 &&
                            value.startsWith(state.text) &&
                            MentionLogic.isMentionTrigger(value, value.length)
                        ) {
                            mentionPickerOpen = true
                        }
                        // Drafts were written for what was typed a moment ago;
                        // once that changes they are stale, so they go rather
                        // than sit there offering to overwrite newer words.
                        if (suggestions.isNotEmpty()) suggestions = emptyList()
                    }
                },
                placeholder = if (isNote) t("thread.notePlaceholder")
                else t("thread.textPlaceholder"),
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 4.dp, vertical = 10.dp),
            )

            // #233: send later, as a visible control beside Send rather than a
            // long-press on it.
            //
            // Web splits the send pill, which works with a cursor; a 40dp pill
            // split under a thumb gives neither half Material's minimum touch
            // target. A long-press would fit, but IconButton owns its own tap
            // gesture (see WrapUpMicButton) and — more to the point — a gesture
            // with no glyph is a feature only the people who already know about
            // it can use.
            //
            // It appears only when there are words to schedule and hides again
            // the moment the box is empty, so it is never furniture. Send keeps
            // the filled pill and stays the single primary.
            // *Applying: Zen of Clarity & Relationship Strength.*
            if (canScheduleLater) {
                IconButton(onClick = {
                    haptics.tap()
                    sendLaterOpen = true
                }) {
                    Icon(
                        Icons.Outlined.Schedule,
                        contentDescription = t("thread.sendLater"),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

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
                    contentDescription = if (isNote) t("thread.saveNote")
                    else t("thread.sendMessage"),
                )
            }
        }

        if (!isNote) {
            ComposerHints(
                text = state.text,
                hasMedia = state.photos.isNotEmpty(),
                locale = locale,
                contactName = contactName,
                businessName = businessName,
                contactAddress = contactAddress,
                senderName = senderName,
                ourNumberE164 = ourNumberE164,
            )
        }
    }

    if (templatePickerOpen) {
        TemplatePickerSheet(
            loadTemplates = loadTemplates,
            onPick = { body, templateId ->
                haptics.tap()
                templatePickerOpen = false
                val current = state.text
                val next =
                    if (current.isEmpty()) body
                    else current + (if (current.endsWith(" ")) "" else " ") + body
                // #475: remember what the box holds AFTER the insert, so an
                // append onto existing words is not later read as an edit.
                templateUse = TemplateUse(templateId, next)
                state.onTextChange(next)
            },
            onDismiss = { templatePickerOpen = false },
        )
    }

    // #233: the three send-later surfaces. Presets and picker are one flow —
    // choosing "Pick a time…" closes the sheet and opens the calendar, so a
    // person is never looking at both.
    if (sendLaterOpen) {
        SendLaterSheet(
            clock = destinationClock,
            onPick = { at ->
                sendLaterOpen = false
                scheduleFor(at)
            },
            onPickCustom = {
                sendLaterOpen = false
                pickTimeOpen = true
            },
            onDismiss = { sendLaterOpen = false },
        )
    }

    if (pickTimeOpen) {
        SendLaterPicker(
            clock = destinationClock,
            onConfirm = { at ->
                pickTimeOpen = false
                scheduleFor(at)
            },
            onDismiss = { pickTimeOpen = false },
        )
    }

    quietConfirmFor?.let { pending ->
        QuietHoursScheduleDialog(
            localHour = destinationClock?.local_hour,
            onConfirm = { scheduleFor(pending, quietHoursConfirmed = true) },
            onDismiss = { quietConfirmFor = null },
        )
    }

    if (mentionPickerOpen) {
        MentionPickerSheet(
            loadMembers = loadMentionableMembers ?: { emptyList() },
            onPick = { member ->
                haptics.tap()
                mentionPickerOpen = false
                val name = member.display_name.trim().ifEmpty { teammateName }
                val next = MentionLogic.insertMention(state.text, state.text.length, name)
                state.onTextChange(next.text)
                state.addMention(PickedMention(member.user_id, name))
            },
            onDismiss = { mentionPickerOpen = false },
        )
    }
}

/**
 * Names a teammate on an internal note. The list is the SERVER's answer to who
 * may be named here, never a filter over the whole team: a teammate who cannot
 * open this thread must not be offered, because the note quotes the customer.
 */
@Composable
private fun MentionPickerSheet(
    loadMembers: suspend () -> List<MentionableMember>,
    onPick: (MentionableMember) -> Unit,
    onDismiss: () -> Unit,
) {
    var rows by remember { mutableStateOf<List<MentionableMember>?>(null) }
    LaunchedEffect(Unit) { rows = loadMembers() }

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
                t("thread.mentionTeammate"),
                style = MaterialTheme.typography.headlineMedium.copy(fontSize = 21.sp),
                color = MaterialTheme.colorScheme.onBackground,
            )
            val current = rows
            when {
                current == null -> SkeletonList(
                    modifier = Modifier.padding(top = 10.dp),
                    rows = 3,
                    avatar = false,
                )

                current.isEmpty() -> Text(
                    t("thread.noMentionable"),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 16.dp),
                )

                else -> Column(Modifier.padding(top = 6.dp, bottom = 12.dp)) {
                    for (member in current) {
                        Text(
                            member.display_name.trim().ifEmpty { t("thread.teammate") },
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onBackground,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onPick(member) }
                                .padding(vertical = 14.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * AI-drafted replies offered above the pill. Tapping one loads it into the
 * composer to read and edit. NOTHING here sends — the person still presses
 * send, every time, which is the whole safety model of the feature.
 */
@Composable
private fun ReplySuggestionsRow(
    suggestions: List<String>,
    loading: Boolean,
    businessUnknown: Boolean,
    onTellLou: (() -> Unit)?,
    onUse: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AiOrb(
                state = if (loading) AiOrbState.Thinking else AiOrbState.Done,
                size = 14.dp,
            )
            Spacer(Modifier.width(5.dp))
            Text(
                if (loading) t("thread.drafting") else t("thread.lousDrafts"),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.weight(1f))
            if (!loading) {
                // No re-ask. Every ask is a real AI call, and re-rolling until
                // a draft reads nicely is what turns a bounded per-message cost
                // into an unbounded one, for an answer that is a starting point
                // you edit anyway. The next set comes when the thread moves.
                Text(
                    t("thread.dismiss"),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.clickable(onClick = onDismiss),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        // Three placeholders while drafting, because three is what comes back:
        // the strip keeps its shape instead of jumping when they land.
        if (loading) {
            repeat(3) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(38.dp)
                        .padding(bottom = 6.dp)
                        .background(
                            MaterialTheme.colorScheme.surfaceContainerHigh,
                            RoundedCornerShape(14.dp),
                        ),
                )
            }
        }
        suggestions.forEach { suggestion ->
            Surface(
                onClick = { onUse(suggestion) },
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surface,
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 6.dp),
            ) {
                Text(
                    suggestion,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                    ),
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
                )
            }
        }
        // Offered here rather than only in Settings, because this is the moment
        // the gap is felt: the drafts are on screen and vaguer than they need
        // to be. The setting exists either way; almost nobody goes looking.
        if (!loading && businessUnknown && onTellLou != null) {
            Text(
                t("thread.louNeedsBusiness"),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .padding(top = 2.dp)
                    .clickable(onClick = onTellLou),
            )
        }
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
    /** #274: everything else this side can answer honestly. */
    contactAddress: String? = null,
    senderName: String? = null,
    ourNumberE164: String? = null,
    modifier: Modifier = Modifier,
    /** #228: the reader's language, for the segment meter's own sentence. */
    locale: String? = null,
) {
    // #415: measure what SENDS, not what was typed. This function already had
    // both names in hand for the preview below and gave the meter the raw
    // draft, so a message built around {business_name} — 15 characters against
    // "Wilson & Sons Plumbing and Heating" at 34 — was reported a part short
    // every time it went out.
    //
    // The encoding boundary is where it stops being a rounding error: an
    // accent or a curly apostrophe arriving through a name flips the WHOLE
    // message from GSM-7 to UCS-2 and per-part capacity falls from 160 to 70.
    // #274: the same values the preview renders with, so the meter counts the
    // string that actually ships. An address resolving into the body changes
    // the part count exactly the way a business name does.
    val values = MergeFields.MergeValues(
        contactName = contactName,
        businessName = businessName,
        contactAddress = contactAddress,
        senderName = senderName,
        ourNumber = ourNumberE164?.let { MergeFields.formatNanpNumber(it) },
    )
    val meter = segmentMeter(MergeFields.applyMergeFields(text, values), hasMedia, locale)
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
                t("thread.sendsAs") + MergeFields.applyMergeFields(text, values),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            // #274: the two tokens this side cannot answer honestly. A cached
            // "next visit" would be confidently wrong the moment a teammate
            // reschedules it, and a preview that is usually right is worse
            // than one that says which part it cannot show.
            if (MergeFields.hasServerOnlyTokens(text)) {
                Text(
                    MergeFields.SERVER_ONLY_TOKENS_NOTE,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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

/** #507: what the microphone in the note box is doing right now. */
private enum class WrapUpPhase { Idle, Recording, Sending }

/** How often the held-button counter redraws. Four ticks a second reads as live. */
private const val WRAP_UP_TICK_MS = 250L

/**
 * #507: hold to say what the call was about.
 *
 * HOLD, not tap-to-start/tap-to-stop, and the reason is not taste. The cost
 * posture in `apps/api/src/ai/call-wrapup.ts` rests on this feature being
 * "bounded by a person deliberately holding a button" — a toggle can be left
 * running in a pocket, and that is exactly the runaway the two-minute cap
 * exists to catch rather than to rely on.
 *
 * Built from a Box rather than an IconButton because IconButton owns its own
 * tap gesture, and a press/release pair has to reach us instead of being
 * consumed. The size is Material's minimum touch target, which is also what the
 * paperclip beside it measures, so the two read as one row.
 */
@Composable
private fun WrapUpMicButton(
    phase: WrapUpPhase,
    /** Begin. False means nothing started (permission asked for, mic refused). */
    onStart: suspend () -> Boolean,
    onFinish: () -> Unit,
) {
    val sending = phase == WrapUpPhase.Sending
    // `semantics` is not composition, so the sentence is read here.
    val holdLabel = t("thread.holdToDictate")
    Box(
        modifier = Modifier
            .size(WRAP_UP_TOUCH_TARGET)
            .clip(CircleShape)
            .pointerInput(sending) {
                // Nothing to hold while Lou is still writing the last one down.
                if (sending) return@pointerInput
                detectTapGestures(
                    onPress = {
                        if (!onStart()) return@detectTapGestures
                        // False here is a cancelled gesture (a scroll stole the
                        // pointer), which still has to end the recording — the
                        // audio must never outlive the finger.
                        tryAwaitRelease()
                        onFinish()
                    },
                )
            }
            // One description for the control in every phase: TalkBack reads
            // the instruction, and the counter line above the pill carries the
            // state in words rather than in a colour.
            .semantics { contentDescription = holdLabel },
        contentAlignment = Alignment.Center,
    ) {
        if (sending) {
            // THE AI mark, and only here: the microphone is a recorder, but
            // turning speech into words is Lou.
            AiOrb(state = AiOrbState.Thinking)
        } else {
            Icon(
                Icons.Outlined.Mic,
                contentDescription = null,
                tint = if (phase == WrapUpPhase.Recording) {
                    NoteAmber.ink()
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
        }
    }
}

/** Material's minimum touch target — the size IconButton lays itself out at. */
private val WRAP_UP_TOUCH_TARGET = 48.dp

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
                        contentDescription = t("thread.attachedPhoto"),
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
                        contentDescription = t("thread.removePhoto"),
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
    val name = info?.name?.takeIf { it.isNotBlank() } ?: t(kind.labelKey)
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
            contentDescription = t("thread.removeNamed", "name" to name),
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
    /**
     * #294: open the markup editor on this photo. Absent where marking up makes no
     * sense — these chips carry documents too, and an editor on a PDF is a control
     * that does nothing.
     */
    onMarkUp: ((String) -> Unit)? = null,
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
                // #294: the name is the handle for marking up, so pointing at
                // something costs one tap on the thing already on screen.
                val markable = onMarkUp != null && file.contentType.startsWith("image/")
                Text(
                    file.name,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textDecoration = if (markable) TextDecoration.Underline else null,
                    modifier = Modifier
                        .widthIn(max = 160.dp)
                        .then(
                            if (markable) {
                                Modifier.clickable { onMarkUp?.invoke(file.id) }
                            } else {
                                Modifier
                            },
                        ),
                )
                Spacer(Modifier.width(6.dp))
                Icon(
                    Icons.Filled.Close,
                    contentDescription = t("thread.removeNamed", "name" to file.name),
                    modifier = Modifier
                        .size(16.dp)
                        .clickable { onRemove(file.id) },
                )
            }
        }
    }
}

/** #475: a saved reply sitting in the composer, and the text it produced. */
data class TemplateUse(val templateId: String, val body: String)

/**
 * Saved-replies picker (spec 09): radius-30 canvas sheet, Bricolage header,
 * paper search pill, template rows in a PaperCard with Insert pills.
 * Search over GET /v1/templates, tap anywhere on a row to insert.
 */
@Composable
fun TemplatePickerSheet(
    loadTemplates: suspend () -> List<Template>,
    /**
     * #475: the body AND which saved reply it came from. Nothing downstream can
     * recover the second from the first — by send time the words have been
     * merged and possibly edited.
     */
    onPick: (body: String, templateId: String) -> Unit,
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
                t("thread.templates"),
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
                        t("common.retry"),
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
                            t("thread.noTemplates"),
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
                        SectionHeader(t("thread.savedReplies"), count = matches.size)
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
                                        onPick = { onPick(template.body, template.id) },
                                    )
                                }
                                if (matches.isEmpty()) {
                                    item {
                                        Text(
                                            t("thread.nothingMatches"),
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.padding(16.dp),
                                        )
                                    }
                                }
                            }
                        }
                        Text(
                            t("thread.templateHint"),
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
                                t("thread.searchTemplates"),
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
                t("thread.insert"),
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

/**
 * Coarse media kind for icons/labels — mirrors shared `mmsMediaKind`.
 *
 * #228: the constant carries the catalogue KEY rather than the English word, so
 * a chip reads in the reader's language and this pure enum never has to know
 * what a locale is. [attachmentLabel] below still answers in English — it is
 * read by the inbox and its toast, which are another slice's to extract.
 */
enum class MmsKind(val labelKey: String) {
    Image("thread.mmsKindImage"),
    Audio("thread.mmsKindAudio"),
    Video("thread.mmsKindVideo"),
    Contact("thread.mmsKindContact"),
    Calendar("thread.mmsKindCalendar"),
    Document("thread.mmsKindDocument"),
    Text("thread.mmsKindText"),
    File("thread.mmsKindFile"),
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

/**
 * What to call an attachment in a one-line preview (inbox row, inbound toast).
 *
 * A customer's voice message used to read as "Photo" everywhere, because the
 * row only had a has_attachments boolean and every surface guessed a noun. This
 * is the one place that turns a kind plus a count into words. Mirrors
 * attachmentLabel in apps/web/src/lib/attachments/media-label.ts and
 * apps/ios/Loonext/Core/Model/MediaKind.swift.
 *
 * `kind` is null for an unknown kind or a MIXED set: the neutral noun.
 */
fun attachmentLabel(kind: MmsKind?, count: Int): String {
    val n = maxOf(count, 1)
    val many = n > 1
    return when (kind) {
        MmsKind.Image -> if (many) "$n photos" else "Photo"
        MmsKind.Audio -> if (many) "$n audio messages" else "Audio message"
        MmsKind.Video -> if (many) "$n videos" else "Video"
        MmsKind.Contact -> if (many) "$n contact cards" else "Contact card"
        MmsKind.Calendar -> if (many) "$n calendar invites" else "Calendar invite"
        MmsKind.Document -> if (many) "$n PDFs" else "PDF"
        MmsKind.Text -> if (many) "$n text files" else "Text file"
        MmsKind.File, null -> if (many) "$n attachments" else "Attachment"
    }
}

/** Parse the server's snippet kind string; unknown or absent → null. */
fun mmsKindFromName(name: String?): MmsKind? = when (name) {
    "image" -> MmsKind.Image
    "audio" -> MmsKind.Audio
    "video" -> MmsKind.Video
    "contact" -> MmsKind.Contact
    "calendar" -> MmsKind.Calendar
    "document" -> MmsKind.Document
    "text" -> MmsKind.Text
    "file" -> MmsKind.File
    else -> null
}

/**
 * The kind every attachment shares, or null when they disagree (a mixed set
 * takes the neutral wording). Mirrors the SQL in migration 20260724080000.
 */
fun sharedMmsKind(kinds: List<MmsKind>): MmsKind? =
    kinds.firstOrNull()?.takeIf { first -> kinds.all { it == first } }

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
