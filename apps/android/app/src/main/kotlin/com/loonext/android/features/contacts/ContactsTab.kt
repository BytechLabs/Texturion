package com.loonext.android.features.contacts

import android.content.Context
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
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
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
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
import com.loonext.android.core.data.CacheKeys
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.core.model.Page
import com.loonext.android.ui.common.AppSheet
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.DsChip
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.ScreenTitle
import com.loonext.android.ui.common.SkeletonList
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.initialsOf
import com.loonext.android.ui.common.pressScale
import com.loonext.android.ui.common.relativeTime
import com.loonext.android.ui.common.rememberCacheFirst
import com.loonext.android.ui.common.rememberHaptics
import com.loonext.android.ui.common.userMessage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val CSV_IMPORT_MAX_BYTES = 2L * 1024 * 1024
private const val VCARD_IMPORT_MAX_BYTES = 5L * 1024 * 1024
private const val IMPORT_ERRORS_SHOWN = 50

/** Which import a picked document feeds. */
private enum class ImportKind(val rowWord: String) { Csv("Row"), Vcard("Card") }

/** One finished import, kept with its kind so skipped rows label honestly. */
private data class ImportReport(val kind: ImportKind, val result: ImportResult)

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
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }
    val haptics = rememberHaptics()

    var query by rememberSaveable(companyId) { mutableStateOf("") }
    var debouncedQ by remember(companyId) { mutableStateOf("") }
    var loadingMore by remember(companyId) { mutableStateOf(false) }
    var refreshing by remember(companyId) { mutableStateOf(false) }
    val pullState = rememberPullToRefreshState()

    var createOpen by remember { mutableStateOf(false) }
    var importMenuOpen by remember { mutableStateOf(false) }
    var pendingImport by remember { mutableStateOf<ImportKind?>(null) }
    var importing by remember { mutableStateOf(false) }
    var exporting by remember { mutableStateOf(false) }
    var importReport by remember { mutableStateOf<ImportReport?>(null) }

    LaunchedEffect(query) {
        if (query.isNotEmpty()) delay(250)
        debouncedQ = query.trim()
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
    LaunchedEffect(companyId, debouncedQ, refreshKey) {
        if (debouncedQ.isEmpty()) {
            searchSnapshot = null
            searchState = LoadState.Loading
            return@LaunchedEffect
        }
        try {
            val page = graph.contactsRepo.contacts(companyId, q = debouncedQ, limit = 50)
            searchSnapshot = ContactsSnapshot(page.data, page.next_cursor)
            searchState = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (searchSnapshot == null) searchState = LoadState.Failed(cause.userMessage())
            else snackbar.showSnackbar(cause.userMessage())
        }
    }

    val defaultSnapshot = (defaultState as? LoadState.Ready)?.value
    val snapshot = if (debouncedQ.isEmpty()) defaultSnapshot else searchSnapshot ?: defaultSnapshot
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
                snackbar.showSnackbar(cause.userMessage())
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
                        // Re-attach the UTF-8 BOM the exporter emits (OkHttp
                        // strips it) so Excel round-trips accents correctly.
                        stream.write(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()))
                        stream.write(csv.removePrefix("\uFEFF").toByteArray(Charsets.UTF_8))
                    } ?: throw IllegalStateException("no stream")
                }
                snackbar.showSnackbar("Contacts exported.")
            } catch (cause: Exception) {
                snackbar.showSnackbar(
                    (cause as? com.loonext.android.core.net.ApiException)?.message
                        ?: "The export didn't go through. Try again.",
                )
            } finally {
                exporting = false
            }
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
            try {
                val (name, size) = describe(uri)
                val maxBytes = when (kind) {
                    ImportKind.Csv -> CSV_IMPORT_MAX_BYTES
                    ImportKind.Vcard -> VCARD_IMPORT_MAX_BYTES
                }
                val sizeMessage = when (kind) {
                    ImportKind.Csv -> "CSV files must be 2 MB or less."
                    ImportKind.Vcard -> "vCard files must be 5 MB or less."
                }
                if (size > maxBytes) {
                    snackbar.showSnackbar(sizeMessage)
                    return@launch
                }
                val bytes = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                } ?: throw IllegalStateException("no stream")
                if (bytes.size > maxBytes) { // providers may not report a size
                    snackbar.showSnackbar(sizeMessage)
                    return@launch
                }
                val result = when (kind) {
                    ImportKind.Csv -> mutations.importCsv(companyId, name, bytes)
                    ImportKind.Vcard -> mutations.importVcard(companyId, name, bytes)
                }
                importReport = ImportReport(kind, result)
                haptics.confirm()
                onRefresh()
            } catch (cause: Exception) {
                snackbar.showSnackbar(cause.userMessage())
            } finally {
                importing = false
            }
        }
    }

    fun pickCsv() {
        pendingImport = ImportKind.Csv
        importLauncher.launch(
            arrayOf("text/*", "application/csv", "application/vnd.ms-excel"),
        )
    }

    fun pickVcard() {
        pendingImport = ImportKind.Vcard
        importLauncher.launch(arrayOf("text/*", "text/vcard", "text/x-vcard"))
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
                    ScreenTitle("Contacts", Modifier.alignByBaseline())
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
                            contentDescription = "New contact",
                            modifier = Modifier.size(18.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(14.dp))
            SearchPill(query, onValueChange = { query = it.take(200) })
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
                                if (debouncedQ.isBlank()) {
                                    "No contacts yet. They're added automatically when " +
                                        "someone texts you, or add one yourself."
                                } else {
                                    "No matches for \"$debouncedQ\"."
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
                                onPickCsv = ::pickCsv,
                                onPickVcard = ::pickVcard,
                                onExport = { exportLauncher.launch("contacts.csv") },
                            )
                        }
                    } else {
                        PullToRefreshBox(
                            isRefreshing = refreshing,
                            onRefresh = ::manualRefresh,
                            state = pullState,
                            modifier = Modifier.fillMaxSize(),
                            indicator = {
                                PullToRefreshDefaults.LoadingIndicator(
                                    state = pullState,
                                    isRefreshing = refreshing,
                                    modifier = Modifier.align(Alignment.TopCenter),
                                )
                            },
                        ) {
                            LazyColumn(
                                Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(bottom = 24.dp),
                            ) {
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
                                                                cause.userMessage(),
                                                            )
                                                        } finally {
                                                            loadingMore = false
                                                        }
                                                    }
                                                },
                                            ) {
                                                Text(
                                                    if (loadingMore) "Loading…" else "Load more",
                                                )
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
                                            onPickCsv = ::pickCsv,
                                            onPickVcard = ::pickVcard,
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

    val report = importReport
    if (report != null) {
        ImportReportSheet(report = report, onDismiss = { importReport = null })
    }
}

/** The paper search pill: 16dp muted glass icon + 13.5sp field. */
@Composable
private fun SearchPill(value: String, onValueChange: (String) -> Unit) {
    val hint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.62f)
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
                        "Search name or number…",
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
                        .semantics { contentDescription = "Search name or number" },
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
        Box(
            Modifier
                .size(40.dp)
                .background(
                    MaterialTheme.colorScheme.secondaryContainer,
                    RoundedCornerShape(14.dp),
                ),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                initialsOf(name),
                style = MaterialTheme.typography.labelMedium.copy(
                    fontSize = 12.5.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
        }
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
                        "Opted out",
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
 */
@Composable
private fun ListFooter(
    canImport: Boolean,
    importing: Boolean,
    exporting: Boolean,
    importMenuOpen: Boolean,
    onImportMenuOpenChange: (Boolean) -> Unit,
    onPickCsv: () -> Unit,
    onPickVcard: () -> Unit,
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
                            "Importing…"
                        } else {
                            "Import from CSV or your phone's contacts"
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
                        text = { Text("CSV file") },
                        onClick = {
                            onImportMenuOpenChange(false)
                            onPickCsv()
                        },
                    )
                    DropdownMenuItem(
                        text = { Text("vCard file (.vcf)") },
                        onClick = {
                            onImportMenuOpenChange(false)
                            onPickVcard()
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
                if (exporting) "Exporting…" else "Export CSV",
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
) {
    val scope = rememberCoroutineScope()
    val haptics = rememberHaptics()
    var phone by remember { mutableStateOf(prefillPhone) }
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

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
            Text("New contact", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = phone,
                onValueChange = {
                    phone = Nanp.formatAsYouType(it)
                    error = null
                },
                label = { Text("Phone") },
                placeholder = { Text("(416) 555-0123") },
                singleLine = true,
                isError = phone.isNotEmpty() && normalized == null,
                supportingText = {
                    if (phone.isNotEmpty() && normalized == null) {
                        Text("Enter a 10-digit US or Canada number.")
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = name,
                onValueChange = { name = it.take(CONTACT_NAME_MAX) },
                label = { Text("Name") },
                placeholder = { Text("Optional") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = address,
                onValueChange = { address = it.take(CONTACT_ADDRESS_MAX) },
                label = { Text("Address") },
                placeholder = { Text("Optional") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = notes,
                onValueChange = { notes = it.take(CONTACT_NOTES_MAX) },
                label = { Text("Notes") },
                placeholder = { Text("Optional") },
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
                TextButton(onClick = onDismiss) { Text("Cancel") }
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
                                error = cause.userMessage()
                            } finally {
                                saving = false
                            }
                        }
                    },
                ) { Text(if (saving) "Adding…" else "Add contact") }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

/**
 * The import's authoritative outcome — imported/updated/skipped counts plus
 * the per-row reasons for everything skipped, labeled 'Row N' (CSV) or
 * 'Card N' (vCard) exactly as the server reported them.
 */
@Composable
private fun ImportReportSheet(report: ImportReport, onDismiss: () -> Unit) {
    val result = report.result
    AppSheet(onDismissRequest = onDismiss) {
        // #180 contract: sheet roots scroll so the Done row stays reachable
        // on square viewports (inert on tall screens).
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 18.dp),
        ) {
            Text("Import finished", style = MaterialTheme.typography.titleMedium)
            Text(
                listOf(
                    "${result.imported} imported",
                    "${result.updated} updated",
                    "${result.skipped} skipped",
                ).joinToString(" · "),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp, bottom = 8.dp),
            )
            if (result.errors.isNotEmpty()) {
                Text(
                    "Skipped rows:",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(bottom = 4.dp),
                )
                Column(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(max = 280.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    result.errors.take(IMPORT_ERRORS_SHOWN).forEach { rowError ->
                        Text(
                            "${report.kind.rowWord} ${rowError.row} · ${rowError.reason}",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                    val hidden = result.errors.size - IMPORT_ERRORS_SHOWN
                    if (hidden > 0) {
                        Text(
                            "…and $hidden more.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(vertical = 2.dp),
                        )
                    }
                }
            }
            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                contentAlignment = Alignment.CenterEnd,
            ) {
                TextButton(onClick = onDismiss) { Text("Done") }
            }
            Spacer(Modifier.height(16.dp))
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
