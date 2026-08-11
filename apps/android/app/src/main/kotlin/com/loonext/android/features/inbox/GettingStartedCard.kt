package com.loonext.android.features.inbox

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import com.loonext.android.core.data.MeRepository
import com.loonext.android.core.i18n.t
import com.loonext.android.core.model.Me
import com.loonext.android.features.thread.MessagingRepository
import com.loonext.android.ui.common.PaperCard
import com.loonext.android.ui.common.rememberHaptics
import kotlinx.coroutines.CancellationException

/**
 * #476 — first-run guidance, on the client the crew actually uses.
 *
 * # Why the phone needed this more than the web did
 *
 * Plans allow 3 seats on Starter and 15 on Pro, so most people in this product
 * are members rather than owners, and a member did not choose the tool — they
 * were told to use it. That person is in a truck, not at a desk. The only
 * client that had first-run guidance was the one serving the owner who had
 * just walked a five-step wizard and picked the product deliberately.
 *
 * The derivations and the copy live in `GettingStartedLogic.kt`; this file is
 * only the surface.
 *
 * *Applying: the Goal Gradient Effect — the bar is visible and neither list
 * starts at zero for somebody who has already done something. Zen of Clarity —
 * no card at all once there is nothing left to say.*
 */

private const val PREFS = "loonext.getting-started"

/**
 * Dismissal is per company AND per card kind: dismissing one must not hide the
 * other, exactly as on web. SharedPreferences rather than DataStore on
 * purpose — the read is synchronous, so the card never paints and then
 * vanishes, and the write does not need a scope that outlives a composable
 * which removes itself the instant it is dismissed.
 */
internal fun dismissKey(companyId: String, kind: StartedAudience): String =
    when (kind) {
        StartedAudience.SETUP -> "getting-started-dismissed:$companyId"
        else -> "member-started-dismissed:$companyId"
    }

internal fun readDismissed(context: Context, companyId: String, kind: StartedAudience): Boolean =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getBoolean(dismissKey(companyId, kind), false)

internal fun markDismissed(context: Context, companyId: String, kind: StartedAudience) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(dismissKey(companyId, kind), true)
        .apply()
}

/**
 * Fetch whatever this audience's list is derived from.
 *
 * Returns an empty list for every "say nothing" case — not this audience, not
 * paid yet, company not hydrated, or any failure at all. A checklist nobody
 * asked for must never become an error somebody has to dismiss, which is the
 * same posture the duplicate-contacts card takes.
 */
suspend fun loadStartedSteps(
    audience: StartedAudience,
    companyId: String,
    me: Me,
    meRepo: MeRepository,
    repo: MessagingRepository,
    /**
     * #228: the reader's language, read from `LocalAppLocale` by the tab. No
     * default — an omitted locale would be an English checklist on a French
     * phone rather than a compile error.
     */
    locale: String,
): List<StartedStep> = try {
    when (audience) {
        StartedAudience.NONE -> emptyList()
        StartedAudience.DOING_THE_JOB -> memberSteps(meRepo.firsts(companyId), locale)
        StartedAudience.SETUP -> {
            val company = me.company
            // G7 step 7 is the POST-payment first inbox visit. Before that,
            // "Get your business number, it's on its way" would be a lie.
            if (company == null || !hasPaidStatus(company.subscription_status)) {
                emptyList()
            } else {
                // Unfiltered page 1: the controller's rows are scoped to the
                // active tab and chips, so deriving "any conversation exists"
                // from them would flip false on the Closed tab or any filter.
                val hasConversation =
                    repo.conversations(companyId, limit = 1).data.isNotEmpty()
                ownerSteps(
                    numbers = company.numbers,
                    hasConversation = hasConversation,
                    usedSegments = repo.usage(companyId).used_segments,
                    activeMemberCount = countActiveMembers(repo.members(companyId).data),
                    locale = locale,
                )
            }
        }
    }
} catch (cause: CancellationException) {
    throw cause
} catch (_: Exception) {
    emptyList()
}

/**
 * The checklist itself. Given already-derived steps, so the composable has no
 * opinion about where the data came from and the logic stays testable.
 *
 * Renders nothing when [steps] is empty or every step is done — the caller
 * decides "still loading" by passing an empty list.
 */
@Composable
fun GettingStartedCard(
    title: String,
    steps: List<StartedStep>,
    companyId: String,
    kind: StartedAudience,
    modifier: Modifier = Modifier,
    footer: String? = null,
) {
    val context = LocalContext.current
    val haptics = rememberHaptics()
    // Read once, synchronously: a suspending read would let the card paint
    // before it knows it was dismissed.
    var dismissed by remember(companyId, kind) {
        mutableStateOf(readDismissed(context, companyId, kind))
    }

    if (dismissed || steps.isEmpty() || stepsComplete(steps)) return

    val doneCount = steps.count { it.done }
    // Read out here rather than inside `semantics { }`: that lambda is not
    // composition, so the catalogue cannot be reached from inside it.
    val dismissLabel = t("inbox.startedDismissAria", "title" to title.lowercase())
    val progressAria = t(
        "inbox.startedProgressAria",
        "done" to doneCount.toString(),
        "total" to steps.size.toString(),
    )
    val stepDone = t("inbox.startedStepDone")
    val stepNotDone = t("inbox.startedStepNotDone")

    PaperCard(modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    Text(
                        t(
                            "inbox.startedProgress",
                            "done" to doneCount.toString(),
                            "total" to steps.size.toString(),
                        ),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Surface(
                    color = Color.Transparent,
                    modifier = Modifier
                        .size(32.dp)
                        .semantics { contentDescription = dismissLabel },
                    onClick = {
                        haptics.tap()
                        markDismissed(context, companyId, kind)
                        dismissed = true
                    },
                    shape = CircleShape,
                ) {
                    Icon(
                        Icons.Outlined.Close,
                        contentDescription = null,
                        modifier = Modifier.padding(8.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Progress you can see, not only count. The bar is the momentum;
            // the numbers above are the detail.
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { doneCount.toFloat() / steps.size.toFloat() },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(4.dp)
                    .clip(CircleShape)
                    .semantics { contentDescription = progressAria },
            )

            steps.forEach { step ->
                Spacer(Modifier.height(10.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    Surface(
                        color = if (step.done) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.surface,
                        border = if (step.done) null
                        else androidx.compose.foundation.BorderStroke(
                            1.dp,
                            MaterialTheme.colorScheme.outlineVariant,
                        ),
                        shape = CircleShape,
                        modifier = Modifier.size(16.dp),
                    ) {
                        if (step.done) {
                            Icon(
                                Icons.Filled.Check,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.onPrimary,
                                modifier = Modifier.padding(3.dp),
                            )
                        }
                    }
                    Column(Modifier.weight(1f)) {
                        Text(
                            step.label,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (step.done) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface,
                            textDecoration = if (step.done) TextDecoration.LineThrough else null,
                            modifier = Modifier.semantics {
                                contentDescription =
                                    step.label + if (step.done) stepDone else stepNotDone
                            },
                        )
                        if (!step.done && step.hint != null) {
                            Text(
                                step.hint,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }

            if (footer != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    footer,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
