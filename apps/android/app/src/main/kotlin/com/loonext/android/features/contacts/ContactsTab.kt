package com.loonext.android.features.contacts

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.model.Contact
import com.loonext.android.core.model.ImportResult
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.MemberRole
import com.loonext.android.ui.common.CenteredError
import com.loonext.android.ui.common.CenteredLoading
import com.loonext.android.ui.common.InitialsAvatar
import com.loonext.android.ui.common.LoadState
import com.loonext.android.ui.common.formatPhone
import com.loonext.android.ui.common.relativeTime
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
    onOpenConversation: ((conversationId: String) -> Unit)? = null,
    onComposeNew: ((contactId: String) -> Unit)? = null,
) {
    val mutations = remember(companyId) { ContactMutations(graph.api, BuildConfig.API_URL) }
    var openContactId by rememberSaveable(companyId) { mutableStateOf<String?>(null) }
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

    val detailId = openContactId
    if (detailId != null) {
        ContactDetailScreen(
            graph = graph,
            mutations = mutations,
            companyId = companyId,
            callerIdName = resolvedMe?.display_name.orEmpty(),
            contactId = detailId,
            onBack = {
                openContactId = null
                listRefresh++ // edits/opt-outs/deletes show on return
            },
            onOpenConversation = onOpenConversation,
            onComposeNew = onComposeNew,
            modifier = modifier,
        )
    } else {
        ContactListScreen(
            graph = graph,
            mutations = mutations,
            companyId = companyId,
            canImport = canImport,
            refreshKey = listRefresh,
            onRefresh = { listRefresh++ },
            onOpenContact = { openContactId = it },
            modifier = modifier,
        )
    }
}

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

    var query by rememberSaveable(companyId) { mutableStateOf("") }
    var debouncedQ by remember(companyId) { mutableStateOf("") }
    var state by remember(companyId) { mutableStateOf<LoadState<Unit>>(LoadState.Loading) }
    var rows by remember(companyId) { mutableStateOf(listOf<Contact>()) }
    var nextCursor by remember(companyId) { mutableStateOf<String?>(null) }
    var loadingMore by remember(companyId) { mutableStateOf(false) }

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

    LaunchedEffect(companyId, debouncedQ, refreshKey) {
        if (rows.isEmpty()) state = LoadState.Loading
        try {
            val page = graph.contactsRepo.contacts(
                companyId,
                q = debouncedQ.ifEmpty { null },
                limit = 50,
            )
            rows = page.data
            nextCursor = page.next_cursor
            state = LoadState.Ready(Unit)
        } catch (cause: Exception) {
            if (rows.isEmpty()) state = LoadState.Failed(cause.userMessage())
            else snackbar.showSnackbar(cause.userMessage())
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
                onRefresh()
            } catch (cause: Exception) {
                snackbar.showSnackbar(cause.userMessage())
            } finally {
                importing = false
            }
        }
    }

    Box(modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it.take(200) },
                label = { Text("Search name or number") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            )

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilledTonalButton(
                    onClick = { createOpen = true },
                    contentPadding = PaddingValues(horizontal = 12.dp),
                ) {
                    Icon(
                        Icons.Filled.Add,
                        contentDescription = null,
                        modifier = Modifier.padding(end = 4.dp),
                    )
                    Text("New contact")
                }
                Spacer(Modifier.weight(1f))
                // Accent rationing: New contact is the region's one petrol
                // element; export/import stay quiet stone.
                val quiet = ButtonDefaults.textButtonColors(
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                TextButton(
                    enabled = !exporting,
                    colors = quiet,
                    onClick = { exportLauncher.launch("contacts.csv") },
                ) { Text(if (exporting) "Exporting…" else "Export") }
                if (canImport) {
                    Box {
                        TextButton(
                            enabled = !importing,
                            colors = quiet,
                            onClick = { importMenuOpen = true },
                        ) { Text(if (importing) "Importing…" else "Import") }
                        DropdownMenu(
                            expanded = importMenuOpen,
                            onDismissRequest = { importMenuOpen = false },
                        ) {
                            DropdownMenuItem(
                                text = { Text("CSV file") },
                                onClick = {
                                    importMenuOpen = false
                                    pendingImport = ImportKind.Csv
                                    importLauncher.launch(
                                        arrayOf(
                                            "text/*",
                                            "application/csv",
                                            "application/vnd.ms-excel",
                                        ),
                                    )
                                },
                            )
                            DropdownMenuItem(
                                text = { Text("vCard file (.vcf)") },
                                onClick = {
                                    importMenuOpen = false
                                    pendingImport = ImportKind.Vcard
                                    importLauncher.launch(
                                        arrayOf("text/*", "text/vcard", "text/x-vcard"),
                                    )
                                },
                            )
                        }
                    }
                }
            }

            when (val current = state) {
                is LoadState.Loading -> CenteredLoading()
                is LoadState.Failed ->
                    CenteredError(current.message, onRetry = onRefresh)

                is LoadState.Ready -> {
                    if (rows.isEmpty()) {
                        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                            Text(
                                if (debouncedQ.isBlank()) {
                                    "No contacts yet. They're added automatically when " +
                                        "someone texts you, or add one yourself."
                                } else {
                                    "No matches for \"$debouncedQ\"."
                                },
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(horizontal = 32.dp),
                            )
                        }
                    } else {
                        LazyColumn(Modifier.fillMaxSize()) {
                            items(rows, key = { it.id }) { contact ->
                                ContactRow(contact, onClick = { onOpenContact(contact.id) })
                            }
                            if (nextCursor != null) {
                                item(key = "load-more") {
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 8.dp),
                                        contentAlignment = Alignment.Center,
                                    ) {
                                        TextButton(
                                            enabled = !loadingMore,
                                            onClick = {
                                                loadingMore = true
                                                scope.launch {
                                                    try {
                                                        val page =
                                                            graph.contactsRepo.contacts(
                                                                companyId,
                                                                q = debouncedQ
                                                                    .ifEmpty { null },
                                                                cursor = nextCursor,
                                                                limit = 50,
                                                            )
                                                        rows = rows + page.data
                                                        nextCursor = page.next_cursor
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

@Composable
private fun ContactRow(contact: Contact, onClick: () -> Unit) {
    val name = contact.name ?: formatPhone(contact.phone_e164)
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        InitialsAvatar(name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(name, style = MaterialTheme.typography.bodyLarge)
            Text(
                formatPhone(contact.phone_e164),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Column(horizontalAlignment = Alignment.End) {
            contact.last_activity_at?.let {
                Text(
                    relativeTime(it),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (contact.opted_out) {
                Text(
                    "Opted out",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

/**
 * Create a contact by hand: US/CA phone with live NANP formatting (the strict
 * shared-module port validates before the server's authoritative pass), plus
 * optional name/address/notes. POST /v1/contacts upserts on the phone, so
 * re-adding an existing number just lands on the same row.
 */
@Composable
private fun CreateContactSheet(
    mutations: ContactMutations,
    companyId: String,
    onCreated: (Contact) -> Unit,
    onDismiss: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var phone by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var address by remember { mutableStateOf("") }
    var notes by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val normalized = Nanp.normalize(phone)

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 16.dp),
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
    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
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
                            "${report.kind.rowWord} ${rowError.row} — ${rowError.reason}",
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
