package com.loonext.android.features.contacts

import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.csvExportBytes
import com.loonext.android.ui.common.RefreshBox
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.PersonAdd
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.IconButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExperimentalMaterial3ExpressiveApi
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.contacts.ContactImport
import com.loonext.android.core.contacts.ContactImportKind
import com.loonext.android.core.i18n.AppStrings
import com.loonext.android.core.i18n.LocalAppLocale
import com.loonext.android.core.i18n.t
import com.loonext.android.core.contacts.ImportColumns
import com.loonext.android.core.contacts.VCardProperties
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ContactFieldDef
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Page
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SkeletonList
import androidx.core.content.ContextCompat
import com.loonext.android.features.contacts.device.ContentResolverDeviceContacts
import com.loonext.android.features.contacts.device.DeviceContactListRow
import com.loonext.android.features.contacts.device.deviceContactRows
import com.loonext.android.features.contacts.device.filterDeviceContacts
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val IMPORT_ERRORS_SHOWN = 50

/** One finished import, kept with its kind so skipped rows label honestly. */
private data class ImportReport(val kind: ContactImportKind, val result: ImportResult)

/**
 * #248 round 3 — a picked CSV waiting for somebody to say what its columns are.
 *
 * Nothing is uploaded until this is answered. A plain class rather than a `data
 * class` on purpose, here and in the two below: it carries the file's BYTES, and
 * a generated `equals` over a ByteArray compares references anyway while a
 * generated `hashCode` would walk two megabytes every time Compose asked.
 */
private class ColumnStep(
    val fileName: String,
    val bytes: ByteArray,
    val plan: ImportColumns.Plan,
)

/** The same, at the vCard door: properties these cards carry that we do not read. */
private class PropertyStep(
    val fileName: String,
    val bytes: ByteArray,
    val properties: List<String>,
)

/**
 * One whole file the server refused, kept so the refusal can be READ rather than
 * glimpsed — and, when this app could read the file, answered again.
 */
private class ImportRefusal(
    val kind: ContactImportKind,
    val fileName: String,
    val bytes: ByteArray,
    /** The server's own sentence, verbatim — it is the only thing that says why. */
    val message: String,
    /**
     * The columns of this file, when it parsed. Present means the per-column
     * question can be asked again: "missing `phone` column" and "the do-not-text
     * column carries values it cannot read" are both answered by declaring
     * differently, and re-picking the file to change one answer is how somebody
     * decides to go and use a laptop instead.
     */
    val plan: ImportColumns.Plan?,
)

/**
 * The cached contacts list (#176): every page loaded so far plus its cursor,
 * cached as ONE value under [CacheKeys.contacts] so returning to the tab
 * restores the full scroll depth instantly. Internal so the shell warmer can
 * prefetch the default (empty-query) entry.
 */
internal data class ContactsSnapshot(val rows: List<Contact>, val nextCursor: String?)

/**
 * Contacts: debounced name/phone search over the cursor-paginated list,
 * create-contact sheet (NANP-validated), row tap → [ContactDetailScreen],
 * CSV export (respecting the live search, saved where the user picks), and
 * owner/admin CSV + vCard imports with a per-row skipped-rows report.
 *
 * [onOpenConversation]/[onComposeNew] are shell callbacks into #153's thread
 * and compose screens; affordances that need them stay hidden until wired.
 * [me] gates import to owner/admin — when the shell doesn't pass it, the tab
 * resolves it once via GET /v1/me.
 */
@Composable
fun ContactsTab(
    graph: AppGraph,
    companyId: String,
    modifier: Modifier = Modifier,
    me: Me? = null,
    onOpenContact: ((contactId: String) -> Unit)? = null,
    onComposeNew: ((contactId: String) -> Unit)? = null,
    /** #459: text a raw number — a device contact has no contact id yet. */
    onComposeTo: ((phone: String) -> Unit)? = null,
) {
    val mutations = remember(companyId) { ContactMutations(graph.api, BuildConfig.API_URL) }
    var listRefresh by remember(companyId) { mutableIntStateOf(0) }

    // Role for the import gate. Quiet resolve when the shell didn't pass me;
    // until it lands the import affordance simply isn't there yet.
    var resolvedMe by remember(companyId) { mutableStateOf(me) }
    LaunchedEffect(companyId) {
        if (resolvedMe == null) {
            runCatching { graph.meRepo.me() }.onSuccess { resolvedMe = it }
        }
    }
    val role = resolvedMe?.memberships?.firstOrNull { it.company_id == companyId }?.role
    val canImport = MemberRole.atLeast(role, MemberRole.ADMIN)

    // Contact detail is a ROUTE above the shell now (founder mandate: nothing
    // pushed shows the pill nav) — this tab is only ever the list.
    ContactListScreen(
        graph = graph,
        mutations = mutations,
        companyId = companyId,
        canImport = canImport,
        refreshKey = listRefresh,
        onRefresh = { listRefresh++ },
        onOpenContact = { onOpenContact?.invoke(it) },
        onComposeTo = { onComposeTo?.invoke(it) },
        modifier = modifier,
    )
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalMaterial3ExpressiveApi::class)
@Composable
private fun ContactListScreen(
    graph: AppGraph,
    mutations: ContactMutations,
    companyId: String,
    canImport: Boolean,
    refreshKey: Int,
    onRefresh: () -> Unit,
    onOpenContact: (String) -> Unit,
    onComposeTo: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    // #228: the export/import callbacks below run outside composition.
    val locale = LocalAppLocale.current
    val haptics = rememberHaptics()

    var query by rememberSaveable(companyId) { mutableStateOf("") }
    var debouncedQ by remember(companyId) { mutableStateOf("") }
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    var refreshing by remember(companyId) { mutableStateOf(false) }

    var createOpen by remember { mutableStateOf(false) }
    // #459: the phone's own address book, shown as its own group below the
    // crew's. Loaded ONCE into memory when access is granted; the filter runs
    // locally because these rows never leave the phone.
    var deviceGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var deviceRows by remember { mutableStateOf<List<DeviceContactListRow>>(emptyList()) }
    var deviceExpanded by rememberSaveable { mutableStateOf(false) }
    var addFromDevice by remember { mutableStateOf<DeviceContactListRow?>(null) }
    val deviceContactsPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> deviceGranted = granted }
    LaunchedEffect(deviceGranted) {
        if (!deviceGranted) {
            deviceRows = emptyList()
            return@LaunchedEffect
        }
        deviceRows = runCatching {
            withContext(Dispatchers.IO) {
                deviceContactRows(ContentResolverDeviceContacts(context).loadContacts())
            }
        }.getOrDefault(emptyList())
    }
    var importMenuOpen by remember { mutableStateOf(false) }
    // #248: the kind chosen from the menu, held while the attestation sheet is
    // up, then handed to the document picker. Two states rather than one
    // because the claim is made about a FILE — a sheet answered for a CSV must
    // not follow the user into a vCard pick.
    var attestingImport by remember { mutableStateOf<ContactImportKind?>(null) }
    var pendingImport by remember { mutableStateOf<ContactImportKind?>(null) }
    var importing by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var importReport by remember { mutableStateOf<ImportReport?>(null) }
    // #248 B1 — a whole file the server refused, held so the refusal can be READ
    // rather than glimpsed. Plain `remember`, never `rememberSaveable`: this
    // carries up to two megabytes of CSV, and a saveable would put that through
    // a Bundle and end the process on a TransactionTooLargeException. Losing the
    // sheet to a rotation is the correct trade — the file is still on the phone.
    var importRefusal by remember { mutableStateOf<ImportRefusal?>(null) }
    // #248 round 3 — a picked file waiting to be declared. Nothing reaches the
    // wire until one of these is answered, which is why they sit between the
    // picker and `upload` rather than beside it. Same `remember` reasoning as
    // above: both hold the file's bytes.
    var columnStep by remember { mutableStateOf<ColumnStep?>(null) }
    var propertyStep by remember { mutableStateOf<PropertyStep?>(null) }

    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(250)
        debouncedQ = query.trim()
    }

    // #291: the active field filter, and the definitions the chips are built
    // from. Read once per workspace — they are the same for every list, and an
    // empty list is the honest state both for a workspace that defined none
    // and for a read that failed: the chips simply do not appear.
    var fieldFilter by remember(companyId) { mutableStateOf<Pair<String, String>?>(null) }
    var fieldDefs by remember(companyId) { mutableStateOf<List<ContactFieldDef>>(emptyList()) }
    LaunchedEffect(companyId) {
        runCatching { graph.contactsRepo.contactFields(companyId) }
            .onSuccess { fieldDefs = it.data }
    }

    // #176 cache-first: the default (empty-query) list renders instantly from
    // StoreCache on every revisit; refreshKey bumps revalidate silently. The
    // revalidate re-walks cursors to the depth already cached so a background
    // refresh never truncates pages the user has loaded.
    val defaultKey = CacheKeys.contacts(companyId)

    // One fetch body shared by the cache-first revalidate and pull-to-refresh
    // so both re-walk cursors to the depth already cached.
    suspend fun fetchDefaultSnapshot(): ContactsSnapshot {
        val target = graph.storeCache.flowOf<ContactsSnapshot>(defaultKey).value?.rows?.size ?: 0
        var page = graph.contactsRepo.contacts(companyId, limit = 50)
        var all = page.data
        while (page.next_cursor != null && all.size < target) {
            page = graph.contactsRepo.contacts(companyId, cursor = page.next_cursor, limit = 50)
            all = all + page.data
        }
        return ContactsSnapshot(all, page.next_cursor)
    }

    val defaultState = rememberCacheFirst(
        cache = graph.storeCache,
        key = defaultKey,
        refreshKey = refreshKey,
    ) { fetchDefaultSnapshot() }

    // Typed searches stay live (never cached): results replace in place, and
    // the previously shown rows hold while a new query is in flight — same
    // semantics as before #176.
    var searchSnapshot by remember(companyId) { mutableStateOf<ContactsSnapshot?>(null) }
    var searchState by remember(companyId) { mutableStateOf<LoadState<Unit>>(LoadState.Loading) }
    LaunchedEffect(companyId, debouncedQ, fieldFilter, refreshKey) {
        // #291: a FILTER is live too. The cached list is everybody, so serving
        // it under an active filter would show every contact as though they
        // matched — the same failure the search path guards against below.
        if (debouncedQ.isEmpty() && fieldFilter == null) {
            searchSnapshot = null
            searchState = LoadState.Loading
            return@LaunchedEffect
        }
        try {
            val page = graph.contactsRepo.contacts(
                companyId,
                q = debouncedQ.ifEmpty { null },
                limit = 50,
                field = fieldFilter?.first,
                value = fieldFilter?.second,
            )
            searchSnapshot = ContactsSnapshot(page.data, page.next_cursor)
            searchState = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (searchSnapshot == null) {
                searchState = LoadState.Failed(cause.userMessage(locale))
            } else {
                snackbar.showSnackbar(cause.userMessage(locale))
            }
        }
    }

    val defaultSnapshot = (defaultState as? LoadState.Ready)?.value
    // A FAILED search must never fall through to the unfiltered list: that
    // rendered every contact in the workspace as though they matched the query
    // (and `snapshot != null` below reported it as Ready, so the failure was
    // invisible). Falling back while a search is merely IN FLIGHT is still
    // correct — that is the "hold the previous rows while typing" behaviour.
    val searchFailed =
        (debouncedQ.isNotEmpty() || fieldFilter != null) &&
            searchSnapshot == null &&
            searchState is LoadState.Failed
    val snapshot = when {
        debouncedQ.isEmpty() && fieldFilter == null -> defaultSnapshot
        searchFailed -> null
        // #291: a FILTERED list never falls through to the unfiltered one,
        // even mid-flight. Holding the previous rows is right while somebody
        // types — the rows shown were a real answer a moment ago — but under a
        // new filter the previous rows are precisely what was excluded.
        fieldFilter != null -> searchSnapshot
        else -> searchSnapshot ?: defaultSnapshot
    }
    val rows = snapshot?.rows ?: emptyList()
    val nextCursor = snapshot?.nextCursor
    val state: LoadState<Unit> = when {
        snapshot != null -> LoadState.Ready(Unit)
        debouncedQ.isNotEmpty() -> searchState
        defaultState is LoadState.Failed -> LoadState.Failed(defaultState.message)
        else -> LoadState.Loading
    }

    // Load-more appends into the cached snapshot (or the live search one) so
    // a return visit restores every loaded page.
    fun appendPage(q: String, page: Page<Contact>) {
        if (q.isEmpty()) {
            val base = graph.storeCache.flowOf<ContactsSnapshot>(defaultKey).value?.rows.orEmpty()
            graph.storeCache.put(defaultKey, ContactsSnapshot(base + page.data, page.next_cursor))
        } else {
            searchSnapshot = ContactsSnapshot(
                searchSnapshot?.rows.orEmpty() + page.data,
                page.next_cursor,
            )
        }
    }

    // Pull-to-refresh: the same silent write-through revalidate a refreshKey
    // bump performs, awaited here only so the indicator is honest about when
    // the refetch actually settles. Data on screen never blanks.
    fun manualRefresh() {
        if (refreshing) return
        refreshing = true
        scope.launch {
            try {
                if (debouncedQ.isEmpty()) {
                    graph.storeCache.put(defaultKey, fetchDefaultSnapshot())
                } else {
                    val page = graph.contactsRepo.contacts(companyId, q = debouncedQ, limit = 50)
                    searchSnapshot = ContactsSnapshot(page.data, page.next_cursor)
                    searchState = LoadState.Ready(Unit)
                }
            } catch (cause: Exception) {
                snackbar.showSnackbar(cause.userMessage(locale))
            } finally {
                refreshing = false
            }
        }
    }

    fun describe(uri: Uri): Pair<String, Long> = describeDocument(context, uri)

    // Export lands where the user chooses (SAF) — a 50k-row CSV through a
    // share-sheet intent would blow the binder transaction limit, so 'save
    // as file' is the honest mobile equivalent of the web download.
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/csv"),
    ) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        exporting = true
        scope.launch {
            try {
                val csv = mutations.exportCsv(companyId, debouncedQ.ifEmpty { null })
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri, "wt")?.use { stream ->
                        stream.write(csvExportBytes(csv))
                    } ?: throw IllegalStateException("no stream")
                }
                snackbar.showSnackbar(
                    AppStrings.translate(locale, "contactsTasks.contactsExported"),
                )
            } catch (cause: Exception) {
                snackbar.showSnackbar(
                    (cause as? com.loonext.android.core.net.ApiException)?.message
                        ?: AppStrings.translate(locale, "contactsTasks.exportFailed"),
                )
            } finally {
                exporting = false
            }
        }
    }

    /**
     * THE one place a bulk import is posted, for both doors and for the retry
     * after a refusal.
     *
     * The claim is written once per door and nowhere else in this screen. It is
     * only reachable from a file the attestation sheet let through the picker,
     * or from a retry of that same file, so it is always somebody's deliberate
     * tick — and a literal outside this function would be another way to make
     * somebody else's consent claim, which is the whole of #226 and #248.
     */
    suspend fun upload(
        kind: ContactImportKind,
        fileName: String,
        bytes: ByteArray,
        /**
         * What this file's columns (CSV) or properties (.vcf) were declared to
         * be, already in the shared wire form. One list rather than two because
         * the KIND already decides which field name it travels under, and a
         * second parameter would be a second thing to get wrong.
         */
        declarations: List<String>,
    ) {
        importing = true
        try {
            val result = when (kind) {
                ContactImportKind.CSV -> mutations.importCsv(
                    companyId,
                    fileName,
                    bytes,
                    attested = true,
                    columns = declarations,
                )
                ContactImportKind.VCARD -> mutations.importVcard(
                    companyId,
                    fileName,
                    bytes,
                    attested = true,
                    properties = declarations,
                )
            }
            importReport = ImportReport(kind, result)
            haptics.confirm()
            onRefresh()
        } catch (cause: Exception) {
            // #248 B1 — `validation_failed` is the server having READ this file
            // and found something a person has to change, and it answers in
            // paragraphs: which column, why it stopped, and the three ways out.
            // A Snackbar truncates that to a line and takes it away again, so
            // the one refusal in the product somebody MUST read in full was the
            // one they could not. Branching on the CODE, never on the sentence.
            // Everything else — no network, signed out, too many imports — is
            // weather or permissions, and a Snackbar carries those fine.
            val api = cause as? ApiException
            if (api?.code == ApiErrorCode.VALIDATION_FAILED) {
                importRefusal = ImportRefusal(
                    kind = kind,
                    fileName = fileName,
                    bytes = bytes,
                    message = api.message,
                    // Read from the FILE, not from the message. Parsing column
                    // names back out of the server's prose would make this
                    // screen break the day somebody rewords a sentence, and the
                    // file is right here. Off the main thread: this walks every
                    // cell of a file that may be two megabytes.
                    plan = if (kind == ContactImportKind.CSV) {
                        withContext(Dispatchers.Default) { ImportColumns.plan(bytes) }
                    } else {
                        null
                    },
                )
            } else {
                snackbar.showSnackbar(cause.userMessage(locale))
            }
        } finally {
            importing = false
        }
    }

    val importLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        val kind = pendingImport
        pendingImport = null
        if (uri == null || kind == null) return@rememberLauncherForActivityResult
        importing = true
        scope.launch {
            val picked = try {
                val (name, size) = describe(uri)
                // Both figures come from the ported contract, so the phone can
                // never promise a file the server would refuse (#248).
                val maxBytes = kind.maxBytes
                val sizeMessage = ContactImport.tooLargeMessage(kind, locale)
                if (size > maxBytes) {
                    snackbar.showSnackbar(sizeMessage)
                    null
                } else {
                    val bytes = withContext(Dispatchers.IO) {
                        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    } ?: throw IllegalStateException("no stream")
                    if (bytes.size > maxBytes) { // providers may not report a size
                        snackbar.showSnackbar(sizeMessage)
                        null
                    } else {
                        name to bytes
                    }
                }
            } catch (cause: Exception) {
                snackbar.showSnackbar(cause.userMessage(locale))
                null
            }
            importing = false
            if (picked == null) return@launch
            val (name, bytes) = picked
            // #248 round 3 — THE DECLARATION STEP. A picked file does not upload;
            // it becomes a question. Off the main thread, because both of these
            // walk a file that may be megabytes.
            when (kind) {
                ContactImportKind.CSV -> {
                    val plan = withContext(Dispatchers.Default) { ImportColumns.plan(bytes) }
                    // THE ROW CAP IS CHECKED BEFORE THE COLUMNS, which mirrors the
                    // server's own ordering and is a courtesy rather than a gate:
                    // the server refuses an over-cap file on its row count before
                    // it looks at a single column, so asking about twelve columns
                    // first would collect twelve answers and throw them away. This
                    // can only ever end in the server's refusal — it never lets a
                    // file through — and a file that will not parse (`plan` null)
                    // takes the same road, because the sentence explaining it is
                    // the server's to write.
                    if (plan == null || plan.rowCount > ContactImport.MAX_ROWS) {
                        upload(kind, name, bytes, emptyList())
                    } else {
                        columnStep = ColumnStep(name, bytes, plan)
                    }
                }
                ContactImportKind.VCARD -> {
                    val properties =
                        withContext(Dispatchers.Default) { VCardProperties.undeclared(bytes) }
                    // A plain FN/N/TEL export carries nothing we do not read, and
                    // there is no question to ask about it. Anything else — the
                    // CATEGORIES and NOTE that Apple and Google actually write —
                    // stops here until somebody says what it means.
                    if (properties.isEmpty()) {
                        upload(kind, name, bytes, emptyList())
                    } else {
                        propertyStep = PropertyStep(name, bytes, properties)
                    }
                }
            }
        }
    }

    /**
     * Open the picker for a kind the user has just attested for. Private to
     * the attestation sheet's confirm — the menu items set [attestingImport]
     * instead, so there is no path from a tap to a file that skips the claim.
     */
    fun pickFileFor(kind: ContactImportKind) {
        pendingImport = kind
        importLauncher.launch(
            when (kind) {
                ContactImportKind.CSV ->
                    arrayOf("text/*", "application/csv", "application/vnd.ms-excel")
                ContactImportKind.VCARD -> arrayOf("text/*", "text/vcard", "text/x-vcard")
            },
        )
    }

    Box(modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(horizontal = 18.dp),
        ) {
            // Title row: Bricolage heading + muted count, ink "+" circle.
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(Modifier.weight(1f)) {
                    ScreenTitle(t("contactsTasks.contactsTitle"), Modifier.alignByBaseline())
                    if (state is LoadState.Ready && nextCursor == null && rows.isNotEmpty()) {
                        AnimatedContent(
                            targetState = rows.size,
                            label = "contactCount",
                            modifier = Modifier
                                .alignByBaseline()
                                .padding(start = 9.dp),
                        ) { count ->
                            Text(
                                "$count",
                                style = MaterialTheme.typography.labelMedium.copy(
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                ),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
                val addInteraction = remember { MutableInteractionSource() }
                Surface(
                    onClick = {
                        haptics.tap()
                        createOpen = true
                    },
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    interactionSource = addInteraction,
                    modifier = Modifier
                        .size(44.dp)
                        .pressScale(addInteraction),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            Icons.Outlined.Add,
                            contentDescription = t("contactsTasks.newContact"),
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            SearchPill(query, onValueChange = { query = it.take(200) })
            // #291: under the search box, because both answer "show me less".
            // Absent entirely unless the workspace defined a field with a
            // closed set of answers, so most lists look exactly as they did.
            if (fieldDefs.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                ContactFilter(
                    defs = fieldDefs,
                    active = fieldFilter,
                    onChange = { fieldFilter = it },
                )
            }
            Spacer(Modifier.height(14.dp))

            when (val current = state) {
                is LoadState.Loading ->
                    // First-fetch stand-in in the real row grammar: one shared
                    // paper card of avatar rows, same outer radius as the list.
                    Surface(
                        color = MaterialTheme.colorScheme.surface,
                        shape = RoundedCornerShape(22.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        SkeletonList(rows = 8, avatar = true)
                    }

                is LoadState.Failed ->
                    CenteredError(current.message, onRetry = onRefresh)

                is LoadState.Ready -> {
                    if (rows.isEmpty()) {
                        Column(
                            Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                when {
                                    debouncedQ.isNotBlank() ->
                                        t("contactsTasks.noMatchesFor", "query" to debouncedQ)
                                    // #291: NOT the no-contacts-yet line. Under
                                    // an active filter those customers are
                                    // excluded, not missing, and "they're added
                                    // automatically" reads as having none.
                                    fieldFilter != null ->
                                        "${t(CONTACT_FILTER_EMPTY_TITLE)}. " +
                                            t(CONTACT_FILTER_EMPTY_BODY)
                                    else -> t("contactsTasks.noContactsYet")
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(horizontal = 14.dp),
                            )
                            Spacer(Modifier.height(14.dp))
                            ListFooter(
                                canImport = canImport,
                                importing = importing,
                                exporting = exporting,
                                importMenuOpen = importMenuOpen,
                                onImportMenuOpenChange = { importMenuOpen = it },
                                onImport = { attestingImport = it },
                                onExport = { exportLauncher.launch("contacts.csv") },
                            )
                        }
                    } else {
                        RefreshBox(
                            isRefreshing = refreshing,
                            onRefresh = ::manualRefresh,
                            modifier = Modifier.fillMaxSize(),
                        ) {
                            LazyColumn(
                                Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(bottom = 24.dp),
                            ) {
                                // #246: above the list, and only when there is
                                // something to act on. Somebody who does not
                                // know they have duplicates will not go looking
                                // for a screen about them.
                                item(key = "duplicates") {
                                    DuplicateContactsCard(
                                        repo = mutations,
                                        companyId = companyId,
                                        canMerge = canImport,
                                        onMerged = { result ->
                                            onRefresh()
                                            // The opt-out union is said out
                                            // loud: a merge can leave the
                                            // survivor opted out when the
                                            // record the user kept was not,
                                            // and nothing else on screen
                                            // would tell them.
                                            scope.launch {
                                                snackbar.showSnackbar(
                                                    AppStrings.translate(
                                                        locale,
                                                        if (result.opted_out) {
                                                            "contactsTasks.mergedOptedOut"
                                                        } else {
                                                            "contactsTasks.merged"
                                                        },
                                                    ),
                                                )
                                            }
                                        },
                                    )
                                }
                                itemsIndexed(rows, key = { _, contact -> contact.id }) { index, contact ->
                                    // Rows share one paper card: round only the
                                    // outer corners so dividers read as hairlines.
                                    val top = if (index == 0) 22.dp else 0.dp
                                    val bottom = if (index == rows.lastIndex) 22.dp else 0.dp
                                    Surface(
                                        color = MaterialTheme.colorScheme.surface,
                                        shape = RoundedCornerShape(
                                            topStart = top,
                                            topEnd = top,
                                            bottomStart = bottom,
                                            bottomEnd = bottom,
                                        ),
                                        modifier = Modifier.animateItem(),
                                    ) {
                                        Column {
                                            ContactRow(contact, onClick = { onOpenContact(contact.id) })
                                            if (index != rows.lastIndex) {
                                                RowDivider(Modifier.padding(horizontal = 15.dp))
                                            }
                                        }
                                    }
                                }
                                if (nextCursor != null) {
                                    item(key = "load-more") {
                                        Box(
                                            Modifier
                                                .animateItem()
                                                .fillMaxWidth()
                                                .padding(vertical = 8.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            TextButton(
                                                enabled = !loadingMore,
                                                colors = ButtonDefaults.textButtonColors(
                                                    contentColor =
                                                    MaterialTheme.colorScheme.onSurfaceVariant,
                                                ),
                                                onClick = {
                                                    loadingMore = true
                                                    val q = debouncedQ
                                                    scope.launch {
                                                        try {
                                                            val page =
                                                                graph.contactsRepo.contacts(
                                                                    companyId,
                                                                    q = q.ifEmpty { null },
                                                                    cursor = nextCursor,
                                                                    limit = 50,
                                                                )
                                                            appendPage(q, page)
                                                        } catch (cause: Exception) {
                                                            snackbar.showSnackbar(
                                                                cause.userMessage(locale),
                                                            )
                                                        } finally {
                                                            loadingMore = false
                                                        }
                                                    }
                                                },
                                            ) {
                                                Text(
                                                    if (loadingMore) {
                                                        t("contactsTasks.loading")
                                                    } else {
                                                        t("contactsTasks.loadMore")
                                                    },
                                                )
                                            }
                                        }
                                    }
                                }
                                // #459 — the phone's own address book, its
                                // own group below the crew's. Never merged:
                                // four hundred personal numbers above forty
                                // shared ones would bury the thing the product
                                // is for.
                                // #547: every match, not the first fifty. The
                                // preview cap below is this layout's decision
                                // and applies only while the group is collapsed.
                                val deviceMatches = filterDeviceContacts(deviceRows, debouncedQ)
                                val deviceVisible =
                                    if (deviceExpanded || debouncedQ.isNotEmpty()) {
                                        deviceMatches
                                    } else {
                                        deviceMatches.take(DEVICE_PREVIEW_ROWS)
                                    }
                                item(key = "device-header") {
                                    DeviceContactsHeader(
                                        granted = deviceGranted,
                                        matchCount = deviceMatches.size,
                                        onGrant = {
                                            haptics.tap()
                                            deviceContactsPermission.launch(
                                                Manifest.permission.READ_CONTACTS,
                                            )
                                        },
                                        modifier = Modifier.animateItem(),
                                    )
                                }
                                itemsIndexed(
                                    deviceVisible,
                                    key = { _, row -> "device-" + row.id },
                                ) { index, row ->
                                    val top = if (index == 0) 22.dp else 0.dp
                                    val bottom =
                                        if (index == deviceVisible.lastIndex) 22.dp else 0.dp
                                    Surface(
                                        color = MaterialTheme.colorScheme.surface,
                                        shape = RoundedCornerShape(
                                            topStart = top,
                                            topEnd = top,
                                            bottomStart = bottom,
                                            bottomEnd = bottom,
                                        ),
                                        modifier = Modifier.animateItem(),
                                    ) {
                                        Column {
                                            DeviceContactRowItem(
                                                row = row,
                                                onText = {
                                                    haptics.tap()
                                                    onComposeTo(row.number)
                                                },
                                                onAdd = {
                                                    haptics.tap()
                                                    addFromDevice = row
                                                },
                                            )
                                            if (index != deviceVisible.lastIndex) {
                                                RowDivider(Modifier.padding(horizontal = 15.dp))
                                            }
                                        }
                                    }
                                }
                                if (
                                    deviceGranted &&
                                    debouncedQ.isEmpty() &&
                                    !deviceExpanded &&
                                    deviceMatches.size > DEVICE_PREVIEW_ROWS
                                ) {
                                    item(key = "device-more") {
                                        Box(
                                            Modifier
                                                .animateItem()
                                                .fillMaxWidth()
                                                .padding(vertical = 8.dp),
                                            contentAlignment = Alignment.Center,
                                        ) {
                                            TextButton(onClick = { deviceExpanded = true }) {
                                                Text(t("contactsTasks.showAllFromPhone"))
                                            }
                                        }
                                    }
                                }
                                item(key = "footer") {
                                    Column(
                                        Modifier
                                            .animateItem()
                                            .fillMaxWidth()
                                            .padding(top = 14.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                    ) {
                                        ListFooter(
                                            canImport = canImport,
                                            importing = importing,
                                            exporting = exporting,
                                            importMenuOpen = importMenuOpen,
                                            onImportMenuOpenChange = { importMenuOpen = it },
                                            onImport = { attestingImport = it },
                                            onExport = { exportLauncher.launch("contacts.csv") },
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        SnackbarHost(snackbar, Modifier.align(Alignment.BottomCenter))
    }

    if (createOpen) {
        CreateContactSheet(
            mutations = mutations,
            companyId = companyId,
            onCreated = { contact ->
                createOpen = false
                // Seed the detail cache so the new contact opens instantly.
                graph.storeCache.put(CacheKeys.contact(companyId, contact.id), contact)
                onRefresh()
                onOpenContact(contact.id)
            },
            onDismiss = { createOpen = false },
        )
    }

    addFromDevice?.let { row ->
        CreateContactSheet(
            mutations = mutations,
            companyId = companyId,
            onCreated = { contact ->
                addFromDevice = null
                graph.storeCache.put(CacheKeys.contact(companyId, contact.id), contact)
                onRefresh()
                onOpenContact(contact.id)
            },
            onDismiss = { addFromDevice = null },
            prefillPhone = row.number,
            prefillName = row.name,
        )
    }

    attestingImport?.let { kind ->
        ImportConsentSheet(
            kind = kind,
            onDismiss = { attestingImport = null },
            onAttested = {
                attestingImport = null
                pickFileFor(kind)
            },
        )
    }

    val report = importReport
    if (report != null) {
        ImportReportSheet(report = report, onDismiss = { importReport = null })
    }

    columnStep?.let { step ->
        ImportColumnsSheet(
            step = step,
            onDismiss = { columnStep = null },
            onConfirm = { declarations ->
                columnStep = null
                scope.launch {
                    upload(ContactImportKind.CSV, step.fileName, step.bytes, declarations)
                }
            },
        )
    }

    propertyStep?.let { step ->
        ImportPropertiesSheet(
            step = step,
            onDismiss = { propertyStep = null },
            onConfirm = { declarations ->
                propertyStep = null
                scope.launch {
                    upload(ContactImportKind.VCARD, step.fileName, step.bytes, declarations)
                }
            },
        )
    }

    importRefusal?.let { refusal ->
        ImportRefusedSheet(
            refusal = refusal,
            onDismiss = { importRefusal = null },
            // Back to the same question, never a resend of the same answer: the
            // refusal is dropped and the per-column sheet opens on the file's
            // own default guess again, so every retry is a complete declaration
            // made by a person.
            onEditColumns = refusal.plan?.let { plan ->
                {
                    importRefusal = null
                    columnStep = ColumnStep(refusal.fileName, refusal.bytes, plan)
                }
            },
        )
    }
}

/** How many device rows show before "Show all from this phone". */
private const val DEVICE_PREVIEW_ROWS = 5

/**
 * The header over the phone's own contacts — or the ask, when access has not
 * been granted.
 *
 * The permission is requested HERE, at the point of use, with a plain sentence
 * about what it buys. Never at launch: a permission prompt before the person
 * has seen why is one they decline, and a declined contacts permission is
 * declined for good.
 */
@Composable
private fun DeviceContactsHeader(
    granted: Boolean,
    matchCount: Int,
    onGrant: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier
            .fillMaxWidth()
            .padding(top = 26.dp, bottom = 10.dp),
    ) {
        Text(
            t("contactsTasks.onThisPhone"),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )
        if (granted) {
            Text(
                if (matchCount == 0) {
                    t("contactsTasks.devicePhoneNoMatch")
                } else {
                    t("contactsTasks.devicePhoneOwn")
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 3.dp),
            )
        } else {
            Text(
                t("contactsTasks.devicePhoneAsk"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 3.dp),
            )
            TextButton(onClick = onGrant, modifier = Modifier.padding(top = 2.dp)) {
                Text(t("contactsTasks.showMyPhoneContacts"))
            }
        }
    }
}

/**
 * One row of the phone's own address book.
 *
 * Tapping it TEXTS them, because that is what this product does and because a
 * device contact has no detail screen here to open — it is not ours. The
 * trailing action pulls them into the crew's shared book, carrying the name the
 * phone already had, which is the whole difference between adding a contact and
 * retyping one.
 */
@Composable
private fun DeviceContactRowItem(
    row: DeviceContactListRow,
    onText: () -> Unit,
    onAdd: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onText)
            .padding(start = 15.dp, end = 6.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                row.name,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
            )
            Text(
                formatPhone(row.number),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
        IconButton(onClick = onAdd) {
            Icon(
                Icons.Outlined.PersonAdd,
                contentDescription = t("contactsTasks.addToContacts", "name" to row.name),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(19.dp),
            )
        }
    }
}

/** The paper search pill: 16dp muted glass icon + 13.5sp field. */
@Composable
private fun SearchPill(value: String, onValueChange: (String) -> Unit) {
    val hint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.62f)
    // Read outside the semantics lambda, which is not composition.
    val searchLabel = t("contactsTasks.searchNameOrNumber")
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surface,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 11.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(9.dp),
        ) {
            Icon(
                Icons.Outlined.Search,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = hint,
            )
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) {
                    Text(
                        t("contactsTasks.searchNameOrNumberHint"),
                        style = MaterialTheme.typography.bodyMedium.copy(fontSize = 13.5.sp),
                        color = hint,
                    )
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 13.5.sp,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    cursorBrush = SolidColor(MaterialTheme.colorScheme.secondary),
                    modifier = Modifier
                        .fillMaxWidth()
                        .semantics { contentDescription = searchLabel },
                )
            }
        }
    }
}

@Composable
private fun ContactRow(contact: Contact, onClick: () -> Unit) {
    val name = contact.name?.ifBlank { null } ?: formatPhone(contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 15.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(11.dp),
    ) {
        InitialsAvatar(name, 40.dp, shape = RoundedCornerShape(14.dp), glyph = 12.5.sp)
        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(7.dp),
            ) {
                Text(
                    name,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        fontSize = 13.5.sp,
                        fontWeight = FontWeight.SemiBold,
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (contact.opted_out) {
                    DsChip(
                        t("contactsTasks.optedOut"),
                        container = MaterialTheme.colorScheme.errorContainer,
                        content = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }
            Text(
                listOfNotNull(
                    formatPhone(contact.phone_e164),
                    contact.last_activity_at?.let { relativeTime(it) },
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall.copy(fontSize = 11.5.sp),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
        Box(
            Modifier
                .size(34.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                Icons.AutoMirrored.Outlined.Chat,
                contentDescription = null,
                modifier = Modifier.size(15.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Quiet footer under the list: the inset import pill (admin-gated, opens the
 * CSV/vCard menu) and the export-CSV text affordance.
 *
 * [onImport] carries the chosen kind rather than opening a picker: every import
 * goes through the attestation sheet first (#248), and the footer must not know
 * a shortcut past it.
 */
@Composable
private fun ListFooter(
    canImport: Boolean,
    importing: Boolean,
    exporting: Boolean,
    importMenuOpen: Boolean,
    onImportMenuOpenChange: (Boolean) -> Unit,
    onImport: (ContactImportKind) -> Unit,
    onExport: () -> Unit,
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        if (canImport) {
            Box {
                Surface(
                    onClick = { onImportMenuOpenChange(true) },
                    enabled = !importing,
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                ) {
                    Text(
                        if (importing) {
                            t("contactsTasks.importing")
                        } else {
                            // Says what the menu below it actually offers:
                            // there is no device-address-book item here.
                            t("contactsTasks.importCsvOrVcard")
                        },
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
                DropdownMenu(
                    expanded = importMenuOpen,
                    onDismissRequest = { onImportMenuOpenChange(false) },
                ) {
                    DropdownMenuItem(
                        text = { Text(t("contactsTasks.csvFile")) },
                        onClick = {
                            onImportMenuOpenChange(false)
                            onImport(ContactImportKind.CSV)
                        },
                    )
                    DropdownMenuItem(
                        text = { Text(t("contactsTasks.vcardFile")) },
                        onClick = {
                            onImportMenuOpenChange(false)
                            onImport(ContactImportKind.VCARD)
                        },
                    )
                }
            }
        }
        TextButton(
            enabled = !exporting,
            colors = ButtonDefaults.textButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            ),
            onClick = onExport,
        ) {
            Text(
                if (exporting) {
                    t("contactsTasks.exporting")
                } else {
                    t("contactsTasks.exportCsv")
                },
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
            )
        }
    }
}

/**
 * Create a contact by hand: US/CA phone with live NANP formatting (the strict
 * shared-module port validates before the server's authoritative pass), plus
 * optional name/address/notes. POST /v1/contacts upserts on the phone, so
 * re-adding an existing number just lands on the same row.
 */
@Composable
internal fun CreateContactSheet(
    mutations: ContactMutations,
    companyId: String,
    onCreated: (Contact) -> Unit,
    onDismiss: () -> Unit,
    prefillPhone: String = "",
    /**
     * #459: the name the phone already had for this person. Filling it is the
     * whole difference between pulling a device contact into the shared book
     * and retyping it — Smart Defaults, on the one field we actually know.
     */
    prefillName: String = "",
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var phone by remember { mutableStateOf(prefillPhone) }
    var name by remember { mutableStateOf(prefillName) }
    var address by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    // #228: read in composition — the save below is a coroutine, and the
    // failure it reports is read by the person holding the phone.
    val locale = LocalAppLocale.current

    val normalized = Nanp.normalize(phone)

    AppSheet(onDismissRequest = onDismiss) {
        // Keyboard: AppSheet's pinned contentWindowInsets already ime-pad the
        // sheet (#199) - a local imePadding here would be a consumed no-op
        // and is forbidden by ImeContractLintTest.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(t("contactsTasks.newContact"), style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = phone,
                onValueChange = {
                    phone = Nanp.formatAsYouType(it)
                    error = null
                },
                label = { Text(t("contactsTasks.phoneField")) },
                placeholder = { Text("(416) 555-0123") },
                singleLine = true,
                isError = phone.isNotEmpty() && normalized == null,
                supportingText = {
                    if (phone.isNotEmpty() && normalized == null) {
                        Text(t("contactsTasks.nanpHint"))
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(CONTACT_NAME_MAX) },
                label = { Text(t("contactsTasks.nameField")) },
                placeholder = { Text(t("contactsTasks.optional")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it.take(CONTACT_ADDRESS_MAX) },
                label = { Text(t("contactsTasks.address")) },
                placeholder = { Text(t("contactsTasks.optional")) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it.take(CONTACT_NOTES_MAX) },
                label = { Text(t("contactsTasks.notesField")) },
                placeholder = { Text(t("contactsTasks.optional")) },
                minLines = 2,
                maxLines = 4,
                modifier = Modifier.fillMaxWidth(),
            )
            if (error != null) {
                Text(
                    error.orEmpty(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(t("common.cancel")) }
                Button(
                    enabled = normalized != null && !saving,
                    onClick = {
                        val phoneE164 = normalized ?: return@Button
                        saving = true
                        error = null
                        scope.launch {
                            try {
                                val created = mutations.create(
                                    companyId = companyId,
                                    phoneE164 = phoneE164,
                                    name = name.trim().ifEmpty { null },
                                    address = address.trim().ifEmpty { null },
                                    notes = notes.trim().ifEmpty { null },
                                )
                                haptics.confirm()
                                onCreated(created)
                            } catch (cause: Exception) {
                                error = cause.userMessage(locale)
                            } finally {
                                saving = false
                            }
                        }
                    },
                ) {
                    Text(
                        if (saving) {
                            t("contactsTasks.adding")
                        } else {
                            t("contactsTasks.addContact")
                        },
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #248 — the claim, made once per file, before the picker opens.
 *
 * The server has demanded `consent_attested` on CSV import since #226 and this
 * app never sent it, so the honest fix is not to start sending it: it is to
 * give somebody the control that field is supposed to represent. A crew moving
 * from another tool is uploading numbers belonging to people who agreed to hear
 * from a DIFFERENT business, and this sheet is the only moment anybody in the
 * flow is asked to think about that.
 *
 * Deliberate friction, and deliberately not a smart default: the box ships
 * unticked and [ContactImport.Copy.CONTINUE] stays disabled until it is
 * ticked. A pre-agreed consent box is not an attestation, and this is the one
 * control in the app where pre-filling would be a lie about a person who is not
 * in the room.
 */
@Composable
private fun ImportConsentSheet(
    kind: ContactImportKind,
    onDismiss: () -> Unit,
    onAttested: () -> Unit,
) {
    // Never hoisted, never remembered across sheets: each file is its own
    // claim, so re-opening this asks again.
    var attested by remember(kind) { mutableStateOf(false) }
    val locale = LocalAppLocale.current

    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so the action row stays reachable
        // on square viewports.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text(t(ContactImport.Copy.TITLE), style = MaterialTheme.typography.titleMedium)
            Text(
                t(ContactImport.Copy.LEAD),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )

            // The claim sits in its own container so it reads as a thing being
            // agreed to rather than one more line of prose. Whole row toggles:
            // a 20dp checkbox is not the hit target for a decision this size.
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
            ) {
                Row(
                    Modifier
                        // toggleable, not Surface(onClick): the whole row is one
                        // hit target AND announces as a checkbox with its state,
                        // rather than as a button that says nothing about what
                        // is currently claimed.
                        .toggleable(
                            value = attested,
                            role = Role.Checkbox,
                            onValueChange = { attested = it },
                        )
                        .padding(start = 6.dp, end = 14.dp, top = 8.dp, bottom = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // onCheckedChange = null: the row above owns the toggle, so
                    // there is one hit target and one semantics node.
                    Checkbox(checked = attested, onCheckedChange = null)
                    Text(
                        t(ContactImport.Copy.ATTESTATION),
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 6.dp),
                    )
                }
            }

            // The three facts somebody needs before choosing a file, in the
            // order they matter: what ticking records, what it cannot undo, and
            // what the file may contain. All figures come from the ported
            // contract (ContactImport), never from this sentence.
            Column(
                Modifier.padding(top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                listOf(
                    t(ContactImport.Copy.RECORDED),
                    t(kind.optOutNote),
                    ContactImport.limitsLine(kind, locale),
                ).forEach { line ->
                    Text(
                        line,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(t(ContactImport.Copy.CANCEL)) }
                Button(enabled = attested, onClick = onAttested) {
                    Text(t(ContactImport.Copy.CONTINUE))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #248 — the server refused this whole file, and this is where somebody reads
 * why.
 *
 * The server's own sentence, verbatim, and this app deliberately does not parse
 * it. Reading column names back out of English would put a compliance gate at
 * the mercy of somebody rewording a sentence.
 *
 * [onEditColumns] is offered only for a CSV this app could read. Several of these
 * refusals are answered by declaring the columns differently — nothing was
 * declared `phone`, or the wrong column was declared the do-not-text one — and it
 * re-opens the QUESTION rather than resending the answer: the per-column sheet
 * starts again from the file's own default guess, so a retry is a complete
 * declaration made by a person, exactly like the first one.
 */
@Composable
private fun ImportRefusedSheet(
    refusal: ImportRefusal,
    onDismiss: () -> Unit,
    onEditColumns: (() -> Unit)?,
) {
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so the action row stays reachable.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text(t(ContactImport.Refusal.TITLE), style = MaterialTheme.typography.titleMedium)

            // The server's words, in a quiet container rather than error red:
            // the title already said nothing imported, and four sentences of red
            // prose is a paragraph nobody finishes. This is the one thing on
            // this sheet that must actually be read.
            Surface(
                shape = RoundedCornerShape(14.dp),
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp),
            ) {
                Text(
                    refusal.message,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(14.dp),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(t(ContactImport.Refusal.CLOSE)) }
                onEditColumns?.let { edit ->
                    Button(onClick = edit) { Text(t(ContactImport.Refusal.EDIT_COLUMNS)) }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * #248 ROUND 3 — EVERY column of the picked file, in front of a person, before
 * one byte is uploaded.
 *
 * WHAT THIS REPLACED. Round two showed a person only the columns a shape test
 * had decided were suspicious, after the server had already refused the file.
 * That test had thresholds, thresholds have an outside, and three verifiers got
 * messages delivered to people who had said stop by standing just outside them —
 * four distinct answers, a value of 25 characters, the same answer on all sixty
 * rows. There is no test here. Every column is asked about, including the ones
 * this import recognised and the ones that are empty.
 *
 * NOTHING IS PRE-ANSWERED EXCEPT WHAT WAS RECOGNISED. The columns the detector
 * claimed arrive filled in, because that is a real guess with a stated meaning
 * shown on screen beside its values, and every one of them can be changed. The
 * rest arrive blank and somebody has to say what they are — no client, this one
 * or the wizard, may answer `ignore` for a column nobody looked at, and there is
 * no "ignore the rest" control here.
 *
 * WHICH MEANS A FULLY RECOGNISED FILE IS ONE TAP, AND THAT IS ALLOWED — but only
 * because of what is under the finger when it lands. `Phone,Name,Notes` whose
 * Notes column reads "DO NOT CALL - asked us to stop" is answered by the detector
 * end to end; the tap that sends it is defensible when those words are on the
 * screen and indefensible when they are not, and the difference is the entire
 * reason the tap exists. So EVERY column is drawn, in one loop, from
 * [ImportColumns.sheetRows] — including the recognised ones, the empty ones, and
 * the cell that ran past the end of the header row.
 *
 * THE VALUES ARE THE POINT. A header alone is not enough to recognise a column
 * by — "Status" means nothing until you can see it holds `active` and
 * `unsubscribed`, and at that point the answer is obvious and the opposite of
 * the one somebody skimming would give.
 *
 * AND THE BUTTON IS BELOW THEM. Reaching Import on a wide file means scrolling
 * the whole list past your eyes; a confirm above the columns would be a file
 * sent by somebody who never scrolled. Pinned, because nothing else pins it.
 */
@Composable
private fun ImportColumnsSheet(
    step: ColumnStep,
    onDismiss: () -> Unit,
    onConfirm: (List<String>) -> Unit,
) {
    val columns = step.plan.columns
    // Keyed on the step: a different file starts from its own guess, and nothing
    // about one file's answer may survive into another's.
    var answers by remember(step) {
        mutableStateOf(columns.associate { it.index to it.guess })
    }
    val answered = columns.count { answers[it.index] != null }
    // The one mistake a person can make here that the server will certainly
    // refuse: two columns declared the same field, and a contact has one address.
    // Caught before the upload rather than after it. This can only ever PREVENT a
    // refusal — it can never let a file through — so it is a form check and not a
    // gate, and the gate it stands in front of is still the server's.
    val duplicated = answers.values
        .filterNotNull()
        .filter { it != ImportColumns.ACTION_IGNORE }
        .groupingBy { it }
        .eachCount()
        .entries
        .firstOrNull { it.value > 1 }
        ?.key
    val complete = answered == columns.size && duplicated == null
    val locale = LocalAppLocale.current

    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so the action row stays reachable.
        // The column list rides inside THIS scroll rather than owning one — two
        // nested vertical scrollers fight each other for the same drag.
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text(t(ContactImport.Columns.TITLE), style = MaterialTheme.typography.titleMedium)
            Text(
                t(ContactImport.Columns.LEAD),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
            // Opens at whatever the detector recognised rather than at zero: it
            // is telling the truth about work already done, and a progress line
            // that reads 0 of 7 on a screen that is four-sevenths finished is
            // the reason people abandon a flow.
            Text(
                ContactImport.Columns.progressLine(answered, columns.size, locale),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )

            // ONE LOOP, OVER THE WHOLE FILE. Not two calls over two groups: the
            // groups partitioned the file only for as long as both calls existed,
            // and deleting the second one drew nothing at all for a file whose
            // every column was recognised while every test in this app stayed
            // green. `sheetRows` is a function a test can run, and it is the only
            // thing standing between a picked file and these cards — nothing may
            // filter, slice or re-sort `columns` between here and the screen.
            Column(
                Modifier.padding(top = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                for (row in ImportColumns.sheetRows(columns)) {
                    // Non-null on the first column of a group, and only when both
                    // groups exist — the rule lives beside the ordering it labels.
                    row.heading?.let { heading ->
                        Text(
                            // #228: the heading travels as a catalogue key, so
                            // the group labels are resolved where they are drawn.
                            t(heading),
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(top = 10.dp),
                        )
                    }
                    ColumnDeclarationCard(
                        column = row.column,
                        action = answers[row.column.index],
                        onAction = { answers = answers + (row.column.index to it) },
                    )
                }
            }

            // The consequence of a wrong answer, on the path to the button rather
            // than above the list: this is the last thing read before committing,
            // and it is the sentence that matters.
            Text(
                ContactImport.Columns.wrongColumn(locale),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
            // A disabled button with no reason beside it is a dead end. Says which
            // of the two things is wrong, never both at once.
            if (!complete) {
                Text(
                    duplicated
                        ?.let { ContactImport.Columns.duplicateHint(it, locale) }
                        ?: t(ContactImport.Columns.UNANSWERED_HINT),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(t(ContactImport.Columns.CANCEL)) }
                Button(
                    enabled = complete,
                    onClick = {
                        onConfirm(
                            // mapNotNull, never an `?: ignore` default. An
                            // unanswered column is left OUT of the declaration and
                            // the SERVER refuses the file for it — so if the local
                            // gate above is ever wrong, the failure is a refusal
                            // rather than a column quietly dismissed on somebody's
                            // behalf. That gate did silently break once during
                            // this change (a lint matched the other sheet's copy
                            // of the same line), which is exactly why the fallback
                            // here must not be the permissive one.
                            columns.mapNotNull { column ->
                                answers[column.index]?.let { action ->
                                    ImportColumns.format(
                                        ImportColumns.Declaration(
                                            index = column.index,
                                            action = action,
                                            header = column.header,
                                        ),
                                    )
                                }
                            },
                        )
                    },
                ) {
                    Text(t(ContactImport.Columns.CONFIRM))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * One column, put in front of a person: where it is, what their file calls it,
 * what it actually holds, and one control saying what it is.
 *
 * The position is shown as well as the name because the server names a column at
 * fault by position ("column 3"), and because two columns in one file are
 * allowed to share a header — a name on its own cannot always say which.
 */
@Composable
private fun ColumnDeclarationCard(
    column: ImportColumns.Column,
    action: String?,
    onAction: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    // Whether this column has been asked to show everything it holds. Bounded by
    // default because thirty columns of full value lists is a sheet nobody reads;
    // complete on request because that is the reading this whole flow claims
    // happened before somebody dismissed a column.
    var showAll by remember { mutableStateOf(false) }
    val locale = LocalAppLocale.current
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 12.dp)) {
            Text(
                ContactImport.Columns.positionLabel(column.index, locale),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                // Verbatim and quoted, never tidied: they have to find this exact
                // string in their own spreadsheet.
                ContactImport.Columns.headerLabel(column.header, locale),
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                modifier = Modifier.padding(top = 1.dp),
            )
            Text(
                // Expanded, the line reports the length of what it actually
                // listed, so it does not end in ", and 40 more" while the note
                // below says the same thing a second way.
                if (showAll) {
                    ContactImport.Columns.valuesLine(column.values, column.values.size, locale)
                } else {
                    ContactImport.Columns.valuesLine(column.samples, column.total, locale)
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 3.dp),
            )
            if (showAll && column.total > column.values.size) {
                Text(
                    ContactImport.Columns.valueCeilingNote(
                        column.values.size,
                        column.total,
                        locale,
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }
            if (column.total > column.samples.size) {
                // A TextButton rather than a clickable Text: this is the control
                // that decides whether somebody sees the value that says stop, and
                // it gets a real touch target like every other control on the card.
                TextButton(
                    onClick = { showAll = !showAll },
                    contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
                ) {
                    Text(
                        if (showAll) {
                            t(ContactImport.Columns.SHOW_FEWER_VALUES_LABEL)
                        } else {
                            ContactImport.Columns.showAllValuesLabel(column.total, locale)
                        },
                        style = MaterialTheme.typography.labelLarge,
                    )
                }
            }
            Box(Modifier.padding(top = 8.dp)) {
                // An unanswered control is outlined and reads "Choose…", so the
                // work left on the screen is visible without reading a word.
                Surface(
                    onClick = { open = true },
                    shape = RoundedCornerShape(10.dp),
                    color = if (action == null) {
                        MaterialTheme.colorScheme.surface
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHighest
                    },
                ) {
                    Row(
                        Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            action?.let { ContactImport.Columns.actionLabel(it, locale) }
                                ?: t(ContactImport.Columns.CHOOSE),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (action == null) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        Icon(
                            Icons.Outlined.ExpandMore,
                            contentDescription = null,
                            modifier = Modifier.padding(start = 4.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    // ImportColumns.ACTIONS, in ITS order: `ignore` is last and
                    // `opted_out` sits immediately above it, so somebody reaching
                    // for "this says nothing" passes their eye over "do not text"
                    // on the way. The two answers are one tap apart and one of
                    // them texts everybody the column was protecting.
                    for (option in ImportColumns.ACTIONS) {
                        DropdownMenuItem(
                            text = { Text(ContactImport.Columns.actionLabel(option, locale)) },
                            onClick = {
                                open = false
                                onAction(option)
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * #248 ROUND 3 — the same question at the vCard door, which had no gate at all.
 *
 * `CATEGORIES:DNC`, a `NOTE` saying they asked us to stop, and a label like
 * `X-ABLabel=DO NOT CALL` beside a number are where a .vcf says do-not-text.
 * They are what Apple and Google actually export, and this app uploaded all
 * three without a word while the file's consent attestation was written over
 * the top.
 *
 * Only the properties these cards actually carry are listed, and only the ones
 * the importer does not read. Two answers, because a property is present or it
 * is not: there is no field to route it into.
 *
 * THIS SHEET IS NO LONGER RARE, and the docblock here used to say it was — "a
 * plain FN/N/TEL export never sees this sheet at all", which stopped being true
 * the day a PARAMETER became something to declare. `TEL;TYPE=CELL` is what every
 * phone on earth exports, so the ordinary card now asks one question, and the
 * ordinary answer is "says nothing about texting". That cost is argued in
 * `CONTACT_IMPORT_VCARD_PROPERTY_FIELD`: a parameter is free text, `TYPE=DNC` is
 * a real export, and Apple writes "DO NOT CALL" into `X-ABLabel` on the TEL line
 * itself — so any rule exempting the common parameters would be a vocabulary,
 * and a vocabulary is what two rounds of this issue died to.
 */
@Composable
private fun ImportPropertiesSheet(
    step: PropertyStep,
    onDismiss: () -> Unit,
    onConfirm: (List<String>) -> Unit,
) {
    var answers by remember(step) { mutableStateOf(emptyMap<String, String>()) }
    val complete = answers.size == step.properties.size
    val locale = LocalAppLocale.current

    AppSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text(t(ContactImport.Properties.TITLE), style = MaterialTheme.typography.titleMedium)
            Text(
                t(ContactImport.Properties.LEAD),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 6.dp),
            )
            // Only when one is actually on the list. `TEL;TYPE` is not a word, and
            // somebody meeting it cold cannot answer it — but a file carrying only
            // CATEGORIES and NOTE needs no lesson about a punctuation mark that is
            // not on their screen.
            if (step.properties.any { it.contains(';') }) {
                Text(
                    t(ContactImport.Properties.PARAMETER_NOTE),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
            Text(
                ContactImport.Columns.progressLine(answers.size, step.properties.size, locale),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 10.dp),
            )
            Column(
                Modifier.padding(top = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                step.properties.forEach { property ->
                    PropertyDeclarationCard(
                        property = property,
                        action = answers[property],
                        onAction = { answers = answers + (property to it) },
                    )
                }
            }
            // How blunt the blocking answer is, said before it is chosen rather
            // than discovered afterwards.
            Text(
                ContactImport.Properties.coarse(locale),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 16.dp),
            )
            if (!complete) {
                Text(
                    t(ContactImport.Properties.UNANSWERED_HINT),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text(t(ContactImport.Properties.CANCEL)) }
                Button(
                    enabled = complete,
                    onClick = {
                        onConfirm(
                            // mapNotNull for the same reason as the column sheet:
                            // an unanswered property is left OUT, and the server
                            // refuses the file rather than this app deciding a
                            // `CATEGORIES` nobody looked at means nothing.
                            step.properties.mapNotNull { property ->
                                answers[property]?.let { VCardProperties.format(property, it) }
                            },
                        )
                    },
                ) {
                    Text(t(ContactImport.Properties.CONFIRM))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/** One vCard property and the two things it can be said to mean. */
@Composable
private fun PropertyDeclarationCard(
    property: String,
    action: String?,
    onAction: (String) -> Unit,
) {
    var open by remember { mutableStateOf(false) }
    val locale = LocalAppLocale.current
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 12.dp)) {
            Text(
                // The property name as the file spells it — `CATEGORIES`, `NOTE`
                // — because that is what they will find if they open the .vcf.
                property,
                style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            )
            Box(Modifier.padding(top = 8.dp)) {
                Surface(
                    onClick = { open = true },
                    shape = RoundedCornerShape(10.dp),
                    color = if (action == null) {
                        MaterialTheme.colorScheme.surface
                    } else {
                        MaterialTheme.colorScheme.surfaceContainerHighest
                    },
                ) {
                    Row(
                        Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            action?.let { ContactImport.Properties.actionLabel(it, locale) }
                                ?: t(ContactImport.Properties.CHOOSE),
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (action == null) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.onSurface
                            },
                        )
                        Icon(
                            Icons.Outlined.ExpandMore,
                            contentDescription = null,
                            modifier = Modifier.padding(start = 4.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
                    for (option in VCardProperties.ACTIONS) {
                        DropdownMenuItem(
                            text = { Text(ContactImport.Properties.actionLabel(option, locale)) },
                            onClick = {
                                open = false
                                onAction(option)
                            },
                        )
                    }
                }
            }
        }
    }
}

/**
 * The import's authoritative outcome — imported/updated/skipped counts, the
 * rows whose consent attestation was refused (#248), and the per-row reasons
 * for everything skipped, labeled 'Row N' (CSV) or 'Card N' (vCard) exactly as
 * the server reported them.
 *
 * This sheet is the only moment anybody learns what the file actually did. It
 * opens once and is dismissed for good, so anything the server bothered to
 * report has to be readable here or it is not reported at all.
 */
@Composable
private fun ImportReportSheet(report: ImportReport, onDismiss: () -> Unit) {
    val result = report.result
    val locale = LocalAppLocale.current
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so the Done row stays reachable
        // on square viewports (inert on tall screens).
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text(t("contactsTasks.importFinished"), style = MaterialTheme.typography.titleMedium)
            Text(
                // Three dispositions, and only three. The refused rows are
                // already inside `imported`/`updated` — adding a fourth figure
                // here would invite the reader to add it to the total and would
                // put a compliance fact in the same breath as a tally.
                listOf(
                    t("contactsTasks.importImported", "count" to "${result.imported}"),
                    t("contactsTasks.importUpdated", "count" to "${result.updated}"),
                    t("contactsTasks.importSkipped", "count" to "${result.skipped}"),
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
            // #248 — the rows the file was WRONG about. These people arrived,
            // and the workspace's attestation was not recorded against them
            // because they had already asked this business to stop.
            //
            // Above the skipped list on purpose: a skipped row is one that never
            // landed and can be fixed by editing the file, while this is a
            // standing carrier fact about somebody now in the crew's contact
            // list. Ranked by consequence, not by the order the server happened
            // to send them.
            if (result.consent_refused > 0) {
                Surface(
                    shape = RoundedCornerShape(14.dp),
                    // The app already has ONE colour for "this person is
                    // blocked" — the errorContainer chip on every contact row
                    // and on the detail header. Reusing it makes this sheet and
                    // the contact list tell a single story, which matters more
                    // than the token's Material name: nothing here failed, and
                    // the heading above already said the import finished.
                    color = MaterialTheme.colorScheme.errorContainer,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(bottom = 10.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Text(
                            ContactImport.consentRefusedHeadline(
                                result.consent_refused,
                                locale,
                            ),
                            style = MaterialTheme.typography.bodyMedium.copy(
                                fontSize = 12.5.sp,
                                fontWeight = FontWeight.SemiBold,
                            ),
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                        // The server's sentence, verbatim. It is the one place
                        // the consequence is spelled out — that they were
                        // imported, that the opt-out stands, and that the
                        // attestation was not recorded — and paraphrasing it on
                        // three clients is how the record starts disagreeing
                        // with itself.
                        result.consent_refused_note?.let { note ->
                            Text(
                                note,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer,
                                modifier = Modifier.padding(top = 5.dp),
                            )
                        }
                        ImportRowList(
                            rows = result.consent_refusals,
                            rowWord = report.kind.rowWord,
                            // The SERVER's count, not the list's length: the
                            // headline above quotes that number, and the two
                            // must never be able to disagree on one screen.
                            total = result.consent_refused,
                            reasonColor = MaterialTheme.colorScheme.onErrorContainer,
                            overflowColor = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
            }
            if (result.errors.isNotEmpty()) {
                Text(
                    t("contactsTasks.importSkippedRows"),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
                ImportRowList(rows = result.errors, rowWord = report.kind.rowWord)
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                TextButton(onClick = onDismiss) { Text(t("contactsTasks.done")) }
            }
            Spacer(Modifier.height(16.dp))
        }
    }
}

/**
 * A bounded list of the server's own per-row reasons, rendered verbatim and
 * labelled with the word the door this import came through uses — 'Row 12' for
 * a CSV, 'Card 12' for a .vcf, because a vCard has no line 12 to look at.
 *
 * Shared by the skipped rows and the refused ones (#248) so the two cannot
 * drift on the only thing that is easy to get wrong here: what happens past
 * [IMPORT_ERRORS_SHOWN]. A list that silently stops at fifty under-reports
 * exactly when there is the most to report, so the remainder is always counted
 * out loud.
 *
 * [total] is how many rows there ARE, which is a different fact from how many
 * arrived in [rows] — and until #248 round 2 it was never different, because the
 * refusal count was always zero. Now that a carrier STOP produces one, the two
 * numbers can disagree, and the screen that would print "40 refused" over five
 * rows with nothing saying the rest existed is this one. Defaults to the list's
 * own length, which is the honest answer for the skipped rows: the server sends
 * no separate count for those.
 */
@Composable
private fun ImportRowList(
    rows: List<ImportResult.ImportRowError>,
    rowWord: String,
    modifier: Modifier = Modifier,
    total: Int = rows.size,
    reasonColor: Color = Color.Unspecified,
    overflowColor: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    val locale = LocalAppLocale.current
    Column(
        modifier
            .fillMaxWidth()
            .heightIn(max = 280.dp)
            .verticalScroll(rememberScrollState()),
    ) {
        val shown = rows.take(IMPORT_ERRORS_SHOWN)
        shown.forEach { rowError ->
            Text(
                t(
                    // #228: `rowWord` travels as a catalogue key attached to the
                    // KIND, so a .vcf still says "Card" — in whichever language.
                    "contactsTasks.importRowLine",
                    "word" to t(rowWord),
                    "row" to "${rowError.row}",
                    "reason" to rowError.reason,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = reasonColor,
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }
        ContactImport.overflowLine(total, shown.size, locale)?.let { line ->
            Text(
                line,
                style = MaterialTheme.typography.bodySmall,
                color = overflowColor,
                modifier = Modifier.padding(vertical = 2.dp),
            )
        }
    }
}

/** Resolve a picked document's display name and size via the resolver. */
private fun describeDocument(context: Context, uri: Uri): Pair<String, Long> {
    var name = "import"
    var size = -1L
    runCatching {
        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)
                if (nameIndex >= 0) name = cursor.getString(nameIndex) ?: name
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) {
                    size = cursor.getLong(sizeIndex)
                }
            }
        }
    }
    return name to size
}
