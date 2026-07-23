package com.loonext.android.features.diagnostics

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationManagerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.loonext.android.AppGraph
import com.loonext.android.BuildConfig
import com.loonext.android.core.diag.CallFlowLog
import com.loonext.android.core.diag.CrashReportLog
import com.loonext.android.push.PushPrefs
import com.loonext.android.telephony.SoftphoneManager
import com.loonext.android.telephony.SoftphoneStatus
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.RowDivider
import com.loonext.android.ui.common.SectionHeader
import com.loonext.android.ui.common.rememberHaptics
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The developer Diagnostics surface (#198) — a pushed route reached from the
 * settings hub's easter-egg row (seven taps on the version line, #198). Four
 * sections, all read-only except the explicit crash-report delete:
 *  - Call flow: the live [CallFlowLog] tail (the #195 evidence channel),
 *    shareable as the whole on-disk file.
 *  - Crash reports: every entry [com.loonext.android.core.diag.CrashReportStore]
 *    kept (#197 — declining the post-crash prompt no longer buries reports),
 *    expandable, individually shareable and deletable.
 *  - Device: the facts a bug report always needs.
 *  - Export everything: one combined text bundle through the share sheet.
 */
@Composable
fun DiagnosticsScreen(
    graph: AppGraph,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val scope = rememberCoroutineScope()

    // Crash log text, reloaded after a delete.
    var crashReloadKey by remember { mutableIntStateOf(0) }
    var crashText by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(crashReloadKey) {
        crashText = withContext(Dispatchers.IO) { graph.diagnostics.store.readAll() }
    }
    val crashEntries = remember(crashText) {
        CrashReportLog.entries(crashText.orEmpty()).asReversed()
    }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp)
            .padding(bottom = 24.dp),
        verticalArrangement = Arrangement.spacedBy(13.dp),
    ) {
        // ------------------------------------------------------------ call flow
        SectionRow(
            label = "Call flow",
            action = "Share",
            onAction = {
                haptics.tap()
                scope.launch {
                    val text = withContext(Dispatchers.IO) { CallFlowLog.readAll() }
                    shareText(
                        context, "Loonext call flow log",
                        text.ifBlank { "No call events recorded." },
                    )
                }
            },
        )
        CallFlowCard()

        // -------------------------------------------------------- crash reports
        SectionRow(
            label = "Crash reports",
            count = crashEntries.size,
            action = if (crashEntries.isEmpty()) null else "Share all",
            onAction = {
                haptics.tap()
                shareText(
                    context, "Loonext Android crash reports",
                    crashText.orEmpty(),
                )
            },
        )
        PaperCard(Modifier.fillMaxWidth()) {
            if (crashEntries.isEmpty()) {
                QuietCaption(
                    "No crash reports on this device.",
                    Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
                )
            } else {
                crashEntries.forEachIndexed { index, entry ->
                    if (index > 0) RowDivider()
                    CrashReportRow(
                        entry = entry,
                        onShare = {
                            haptics.tap()
                            shareText(context, "Loonext Android crash report", entry)
                        },
                        onDelete = {
                            haptics.reject()
                            scope.launch {
                                withContext(Dispatchers.IO) {
                                    graph.diagnostics.store.delete(entry)
                                }
                                crashReloadKey++
                            }
                        },
                    )
                }
            }
        }

        // --------------------------------------------------------------- device
        SectionHeader("Device")
        DeviceCard()

        // --------------------------------------------------------------- export
        val exportLabel = "Export everything"
        PaperCard(Modifier.fillMaxWidth()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clickable {
                        haptics.tap()
                        scope.launch {
                            val bundle = withContext(Dispatchers.IO) {
                                buildExportBundle(context, crashText)
                            }
                            shareText(context, "Loonext Android diagnostics", bundle)
                        }
                    }
                    .padding(horizontal = 15.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    Icons.Outlined.Share,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        exportLabel,
                        style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.5.sp),
                    )
                    QuietCaption(
                        "Device facts, call flow, and crash reports in one share",
                        Modifier.padding(top = 1.dp),
                    )
                }
            }
        }
    }
}

/** Section micro-label with an optional quiet trailing action. */
@Composable
private fun SectionRow(
    label: String,
    count: Int? = null,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        SectionHeader(label, Modifier.weight(1f), count = count)
        if (action != null) {
            Text(
                action,
                style = MaterialTheme.typography.labelSmall.copy(
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                ),
                color = MaterialTheme.colorScheme.secondary,
                modifier = Modifier
                    .clickable { onAction() }
                    .padding(horizontal = 6.dp, vertical = 4.dp),
            )
        }
    }
}

/** The live call-flow tail: monospace micro-rows, newest last, auto-follow. */
@Composable
private fun CallFlowCard() {
    val lines by CallFlowLog.entries.collectAsStateWithLifecycle()
    PaperCard(Modifier.fillMaxWidth()) {
        if (lines.isEmpty()) {
            QuietCaption(
                "No call events yet this session.",
                Modifier.padding(horizontal = 15.dp, vertical = 13.dp),
            )
        } else {
            val listState = rememberLazyListState()
            // Auto-follow: keep the newest line in view as events stream in.
            LaunchedEffect(lines.size) {
                if (lines.isNotEmpty()) listState.scrollToItem(lines.size - 1)
            }
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(280.dp)
                    .padding(horizontal = 15.dp, vertical = 10.dp),
            ) {
                items(lines) { line ->
                    Text(
                        line,
                        style = MaterialTheme.typography.bodySmall.copy(
                            fontFamily = FontFamily.Monospace,
                            fontSize = 10.5.sp,
                            lineHeight = 15.sp,
                        ),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

/** One crash entry: quiet summary row; tap expands the full report + actions. */
@Composable
private fun CrashReportRow(
    entry: String,
    onShare: () -> Unit,
    onDelete: () -> Unit,
) {
    val haptics = rememberHaptics()
    var expanded by remember(entry) { mutableStateOf(false) }
    var confirmingDelete by remember(entry) { mutableStateOf(false) }
    val meta = remember(entry) { CrashReportLog.entryMeta(entry) }

    Column(
        Modifier
            .fillMaxWidth()
            .clickable {
                haptics.tap()
                expanded = !expanded
            }
            .padding(horizontal = 15.dp, vertical = 11.dp)
            .animateContentSize(),
    ) {
        Text(
            formatCrashTime(meta.timeMs),
            style = MaterialTheme.typography.titleSmall.copy(fontSize = 13.sp),
        )
        QuietCaption(
            listOfNotNull(
                meta.threadName?.let { "on $it" },
                meta.appVersion?.let { "v$it" },
            ).joinToString(" · ").ifBlank { "Details inside" },
            Modifier.padding(top = 1.dp),
        )
        meta.firstStackLine?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodySmall.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.5.sp,
                ),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = if (expanded) 3 else 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        if (expanded) {
            Surface(
                shape = MaterialTheme.shapes.medium,
                color = MaterialTheme.colorScheme.surfaceContainer,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
            ) {
                Text(
                    entry,
                    style = MaterialTheme.typography.bodySmall.copy(
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        lineHeight = 14.sp,
                    ),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(10.dp),
                )
            }
            Row(Modifier.padding(top = 2.dp)) {
                TextButton(onClick = onShare) { Text("Share") }
                TextButton(onClick = { confirmingDelete = true }) {
                    Text("Delete", color = MaterialTheme.colorScheme.error)
                }
            }
        }
    }

    if (confirmingDelete) {
        AlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text("Delete this crash report?") },
            text = { Text("It is removed from this device only and cannot be recovered.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    onDelete()
                }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDelete = false }) { Text("Keep") }
            },
        )
    }
}

@Composable
private fun DeviceCard() {
    val context = LocalContext.current
    val softphone = remember { SoftphoneManager.peek() }
    val socketLabel = if (softphone != null) {
        val snapshot by softphone.state.collectAsStateWithLifecycle()
        when (snapshot.status) {
            SoftphoneStatus.READY -> "Ready"
            SoftphoneStatus.CONNECTING -> "Connecting"
            SoftphoneStatus.DISCONNECTED -> "Disconnected"
        }
    } else {
        "Not running"
    }
    val pushRegistered = remember { PushPrefs.token(context) != null }
    val notificationsAllowed = remember {
        runCatching { NotificationManagerCompat.from(context).areNotificationsEnabled() }
            .getOrDefault(false)
    }
    PaperCard(Modifier.fillMaxWidth()) {
        DeviceRow("App version", BuildConfig.VERSION_NAME)
        RowDivider()
        DeviceRow("Android", "SDK ${Build.VERSION.SDK_INT} (Android ${Build.VERSION.RELEASE})")
        RowDivider()
        DeviceRow("Device", "${Build.MANUFACTURER} ${Build.MODEL}")
        RowDivider()
        DeviceRow("Push token", if (pushRegistered) "Registered" else "Not registered")
        RowDivider()
        DeviceRow("Notifications", if (notificationsAllowed) "Allowed" else "Blocked")
        RowDivider()
        DeviceRow("Softphone socket", socketLabel)
    }
}

@Composable
private fun DeviceRow(label: String, value: String) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 15.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
            color = MaterialTheme.colorScheme.outline,
            modifier = Modifier.weight(1f),
        )
        Text(
            value,
            style = MaterialTheme.typography.bodySmall.copy(fontSize = 12.sp),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun QuietCaption(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
        color = MaterialTheme.colorScheme.outline,
        modifier = modifier,
    )
}

/** The one combined bundle "Export everything" shares. */
private fun buildExportBundle(context: Context, crashText: String?): String = buildString {
    appendLine("Loonext Android diagnostics")
    appendLine("app_version=${BuildConfig.VERSION_NAME}")
    appendLine("sdk=${Build.VERSION.SDK_INT}")
    appendLine("device=${Build.MANUFACTURER} ${Build.MODEL}")
    appendLine(
        "notifications=" + runCatching {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }.getOrDefault(false),
    )
    appendLine("push_token_registered=${PushPrefs.token(context) != null}")
    appendLine()
    appendLine("=== CALL FLOW ===")
    appendLine(CallFlowLog.readAll().ifBlank { "(empty)" })
    appendLine()
    appendLine("=== CRASH REPORTS ===")
    appendLine(crashText?.ifBlank { null } ?: "(none)")
}

private fun formatCrashTime(timeMs: Long?): String {
    if (timeMs == null) return "Unknown time"
    return SimpleDateFormat("MMM d, yyyy 'at' h:mm a", Locale.getDefault()).format(Date(timeMs))
}

/** ACTION_SEND chooser — same shape as the post-crash prompt's share. */
private fun shareText(context: Context, subject: String, text: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_SUBJECT, subject)
        .putExtra(Intent.EXTRA_TEXT, text)
    runCatching { context.startActivity(Intent.createChooser(send, subject)) }
}
