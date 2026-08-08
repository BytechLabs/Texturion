package com.loonext.android.features.tasks

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.loonext.android.ui.common.absoluteTime
import com.loonext.android.core.jobs.WorkPhase

/**
 * #294 — the line above one visit's photos.
 *
 * ## Evaluation
 *
 * The task screen's file row was flat: a job with four site visits looked exactly
 * like a job with one, and nothing said which pictures were the finished work or who
 * took them. Everything needed was already in the data — each file knows the note it
 * arrived on, and a note has a time, an author and now a label.
 *
 * ## What binds it
 *
 * *Chunking* — one line per visit turns an undifferentiated strip into three or four
 * groups, which is the number a person can hold. The label, the person and the time
 * are one line rather than three, because they answer one question.
 *
 * *Zen of Clarity* — the label is a quiet pill, not a coloured banner. Before and
 * after are equally ordinary; neither is a warning.
 *
 * *Meaningful Highlights* — the customer's own photos are named as theirs rather than
 * left unattributed, because "who sent this" is the first thing anybody asks of a
 * photo they did not take.
 */
@Composable
fun PhotoGroupHeader(
    phase: String?,
    at: String,
    addedByUserId: String?,
    fromCustomer: Boolean,
    nameOf: (String?) -> String?,
) {
    val who = when {
        fromCustomer -> "From the customer"
        else -> nameOf(addedByUserId) ?: "Added by the crew"
    }
    Row(
        Modifier.padding(top = 8.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (phase != null) {
            Text(
                WorkPhase.label(phase),
                fontSize = 11.5.sp,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier
                    .background(
                        MaterialTheme.colorScheme.surfaceContainerHigh,
                        RoundedCornerShape(percent = 50),
                    )
                    .padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
        Text(who, fontSize = 12.5.sp, color = MaterialTheme.colorScheme.onSurface)
        Text(
            absoluteTime(at),
            fontSize = 12.sp,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
