package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.loonext.android.core.i18n.t

/** [Fill] centres in the space the content would have filled, [Card] is one card among cards, [Inline] is one line. */
enum class LoadErrorVariant { Fill, Card, Inline }

/**
 * #733: the one "couldn't load this" state. A plain sentence and an outline
 * Retry. [LoadErrorVariant.Fill] is centred in the space the content would have
 * held; [LoadErrorVariant.Card] is a paper card among other cards;
 * [LoadErrorVariant.Inline] is one line, the sentence beside a Retry, for a
 * spot inside a card with no room for a card of its own. A state retrying
 * cannot fix passes its own [action] instead of [onRetry]. The web twin is
 * `apps/web/src/components/ui/load-error.tsx`.
 *
 * `LoadErrorGuardTest` fails on a hand-rolled retry button elsewhere.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LoadError(
    message: String? = null,
    onRetry: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
    variant: LoadErrorVariant = LoadErrorVariant.Fill,
) {
    val sentence = message ?: t("common.loadFailed")
    val next: (@Composable () -> Unit)? = action ?: onRetry?.let { retry ->
        { OutlinedButton(onClick = retry) { Text(t("common.retry")) } }
    }
    val live = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
    when (variant) {
        LoadErrorVariant.Fill -> Column(
            modifier
                .fillMaxSize()
                .then(live)
                .padding(horizontal = 32.dp, vertical = 56.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        ) {
            Text(
                sentence,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            next?.invoke()
        }

        LoadErrorVariant.Card -> PaperCard(modifier.fillMaxWidth().then(live)) {
            Column(
                Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Text(
                    sentence,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                next?.invoke()
            }
        }

        LoadErrorVariant.Inline -> FlowRow(
            modifier.fillMaxWidth().then(live),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                sentence,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            next?.invoke()
        }
    }
}
