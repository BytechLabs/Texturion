package com.loonext.android.features.settings

import android.content.Context
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t
import com.loonext.android.ui.common.PaperCard

/**
 * #321 — what shipped, in the app.
 *
 * # A hand port of `packages/shared/src/whats-new.ts`
 *
 * The entries and the marker rule are shared because three clients show them,
 * and a badge that lights on one client and not another is worse than no badge.
 * `WhatsNewPortTest` pins the rule; the entries are checked by eye against the
 * TypeScript because prose cannot be asserted.
 *
 * # The two rules that make the marker worth having
 *
 * It does NOT light for a workspace that just arrived. Somebody who signed up
 * today has no memory of missing anything, and a badge advertising six months
 * of changes is one they learn to ignore immediately.
 *
 * The seen-stamp happens when the section OPENS, not when the app launches.
 * Stamping on launch would clear the marker for somebody who never looked,
 * which is the one way to make the feature actively misleading.
 */

data class WhatsNewEntry(
    /** ISO date the change reached customers. */
    val date: String,
    /**
     * #228: the CATALOGUE KEYS, not the words.
     *
     * The list is a top-level `val` built at class-init, before anybody has a
     * locale, so an entry that stored its own sentence could only ever store
     * one language's. Everything that reads these — the marker, the tests —
     * works on the date and on identity, never on the prose.
     */
    val title: String,
    val body: String,
)

/**
 * Newest first. Mirrors `WHATS_NEW` in packages/shared.
 *
 * No `href`: the phone's settings detail cannot deep-link into a tab without a
 * router this screen does not have, and a link that goes nowhere is worse than
 * a sentence that tells you where to look. The web page carries the links.
 */
val WHATS_NEW: List<WhatsNewEntry> = listOf(
    WhatsNewEntry(
        "2026-08-01",
        "settingsMore.whatsNewSavedViewsTitle",
        "settingsMore.whatsNewSavedViewsBody",
    ),
    WhatsNewEntry(
        "2026-08-01",
        "settingsMore.whatsNewQuotesTitle",
        "settingsMore.whatsNewQuotesBody",
    ),
    WhatsNewEntry(
        "2026-07-25",
        "settingsMore.whatsNewVoicemailTitle",
        "settingsMore.whatsNewVoicemailBody",
    ),
    WhatsNewEntry(
        "2026-07-24",
        "settingsMore.whatsNewDraftsTitle",
        "settingsMore.whatsNewDraftsBody",
    ),
    WhatsNewEntry(
        "2026-07-12",
        "settingsMore.whatsNewCallsTitle",
        "settingsMore.whatsNewCallsBody",
    ),
)

/** The newest entry's date, which is what the marker compares against. */
fun latestWhatsNewDate(entries: List<WhatsNewEntry> = WHATS_NEW): String =
    entries.fold("") { newest, entry -> if (entry.date > newest) entry.date else newest }

/**
 * Is there something this member has not seen?
 *
 * `lastSeen` is null until they open the section. The fallback is when the
 * WORKSPACE arrived, and where neither is known the answer is NO — a wrong
 * badge costs trust in every later one.
 */
fun hasUnseenWhatsNew(
    lastSeen: String?,
    joinedAt: String?,
    entries: List<WhatsNewEntry> = WHATS_NEW,
): Boolean {
    val latest = latestWhatsNewDate(entries)
    if (latest.isEmpty()) return false
    val floor = lastSeen ?: joinedAt ?: return false
    return latest > floor.take(10)
}

/** Entries newer than the floor, for the list to mark as new. */
fun unseenEntries(
    lastSeen: String?,
    joinedAt: String?,
    entries: List<WhatsNewEntry> = WHATS_NEW,
): List<WhatsNewEntry> {
    val floor = lastSeen ?: joinedAt ?: return emptyList()
    return entries.filter { it.date > floor.take(10) }
}

private const val PREFS = "loonext.whats-new"
private const val KEY_SEEN = "seen_at"

/** The stored instant, or null when they have never opened it on this device. */
fun readWhatsNewSeen(context: Context): String? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_SEEN, null)
    // Anything that is not ISO-ish is treated as never seen: a corrupted value
    // must not silently suppress the marker forever.
    return if (raw != null && Regex("^\\d{4}-\\d{2}-\\d{2}").containsMatchIn(raw)) raw else null
}

/** Stamp now. Called when the section opens, never when the app launches. */
fun markWhatsNewSeen(context: Context, now: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_SEEN, now)
        .apply()
}

/**
 * The section body.
 *
 * Applying: Zen of Clarity (a dated list, one line and two sentences each),
 * Chunking (the new ones are MARKED rather than split into a second list, which
 * would be a decision the reader has to make for no reason), and the design
 * grammar this settings screen already uses.
 */
@Composable
fun WhatsNewSection(scope: SettingsScope, joinedAt: String?) {
    val context = LocalContext.current
    // Captured before the stamp below, so entries stay marked while they read.
    val seenAtOpen = remember { readWhatsNewSeen(context) }
    val unseen = remember(seenAtOpen, joinedAt) {
        unseenEntries(seenAtOpen, joinedAt).map { it.title }.toSet()
    }
    remember {
        markWhatsNewSeen(context, java.time.Instant.now().toString())
        true
    }

    Column(Modifier.fillMaxWidth()) {
        Text(
            t("settingsMore.whatsNewIntro"),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(14.dp))
        WHATS_NEW.forEach { entry ->
            PaperCard(Modifier.fillMaxWidth().padding(bottom = 10.dp)) {
                Column(Modifier.padding(16.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(entry.date, style = MaterialTheme.typography.labelSmall)
                        if (unseen.contains(entry.title)) {
                            Spacer(Modifier.width(8.dp))
                            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primary) {
                                Text(
                                    t("settingsMore.whatsNewBadge"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onPrimary,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(t(entry.title), style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.height(4.dp))
                    Text(t(entry.body), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            t("settingsMore.whatsNewFooter"),
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

/** The dot on the settings row. Two dp of ink, and never anything more. */
@Composable
fun WhatsNewDot(modifier: Modifier = Modifier) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primary,
        modifier = modifier.size(8.dp),
    ) {}
}
