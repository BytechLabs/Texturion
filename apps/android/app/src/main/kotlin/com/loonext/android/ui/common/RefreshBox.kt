package com.loonext.android.ui.common

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.material3.pulltorefresh.PullToRefreshDefaults
import androidx.compose.material3.pulltorefresh.rememberPullToRefreshState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/**
 * #511 — pulling down looks the same everywhere.
 *
 * Reported as: "pulling down to refresh shows different indicators, sometimes a
 * round arrow, sometimes a squigly circle". Exactly right, and it was a coin
 * flip decided per screen: six screens called `PullToRefreshBox`, and three of
 * them passed `PullToRefreshDefaults.LoadingIndicator` while three took the
 * platform default. Calls, Contacts and Notifications drew one thing; For You,
 * Inbox and Tasks drew another.
 *
 * Nobody chose that. It is what happens when the same gesture is wired six
 * times and the `indicator` parameter is optional — three authors reached for
 * the newer M3 Expressive indicator and three did not, and no single screen
 * ever showed both, so it took using the app across tabs to notice.
 *
 * # Why a component rather than a convention
 *
 * A convention is a thing to remember on the seventh screen. This takes the
 * parameter away: there is no `indicator` argument to pass, so a new tab cannot
 * disagree with the existing ones by accident. That is the same shape as the
 * headline-price resolver and the settings-visibility model — the correctness
 * is structural rather than remembered.
 *
 * # Which indicator
 *
 * The Expressive one, matching the three screens that already used it and the
 * rest of the app's Material 3 Expressive treatment. Applying: the *Safety*
 * Principle — a gesture that behaves identically everywhere is one the user
 * stops having to think about, and a refresh that looks different per tab
 * reads as three different apps stitched together.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RefreshBox(
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val pullState = rememberPullToRefreshState()
    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        state = pullState,
        indicator = {
            PullToRefreshDefaults.LoadingIndicator(
                state = pullState,
                isRefreshing = isRefreshing,
                modifier = Modifier.align(Alignment.TopCenter),
            )
        },
        modifier = modifier,
        content = content,
    )
}
