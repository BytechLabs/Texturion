package com.loonext.android.ui.common

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.DpSize
import com.loonext.android.core.model.CompanyView
import com.loonext.android.core.model.Me
import com.loonext.android.core.model.Membership
import com.loonext.android.core.model.PhoneNumberSummary
import com.loonext.android.core.model.SubscriptionStatus
import com.loonext.android.core.model.Usage
import com.loonext.android.ui.theme.LoonextTheme

/**
 * #180 — the responsive proof matrix. Every core surface carries a
 * [ResponsivePreviews]-annotated preview so the layout is COMPILE-CHECKED at
 * the five viewport ratios the founder named (square cover display, small
 * phone, tall 21:9, landscape, tablet). A surface that stopped laying out at a
 * ratio would fail to render here.
 *
 * The five sizes fan out from one multipreview annotation. Wrap the surface in
 * [PreviewHarness], which recreates the shell's environment: the app theme AND
 * a [WindowSizeClass] derived from the actual preview canvas, so a preview
 * exercises the SAME compact-height / max-width branches the real shell drives
 * (previews get no Activity, so [LocalWindowSizeClass] would otherwise be null).
 */
@Preview(name = "1:1 square 720", widthDp = 720, heightDp = 720, showBackground = true)
@Preview(name = "small phone 320x640", widthDp = 320, heightDp = 640, showBackground = true)
@Preview(name = "tall 21:9 412x915", widthDp = 412, heightDp = 915, showBackground = true)
@Preview(name = "landscape 915x412", widthDp = 915, heightDp = 412, showBackground = true)
@Preview(name = "tablet 840x1000", widthDp = 840, heightDp = 1000, showBackground = true)
annotation class ResponsivePreviews

/**
 * The preview counterpart to MainActivity's shell setup: theme + a
 * [WindowSizeClass] computed from the canvas the preview renders at, so the
 * responsive branches under test actually fire.
 */
@Composable
fun PreviewHarness(content: @Composable () -> Unit) {
    LoonextTheme {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val windowSizeClass = WindowSizeClass.calculateFromSize(DpSize(maxWidth, maxHeight))
            CompositionLocalProvider(LocalWindowSizeClass provides windowSizeClass) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    content()
                }
            }
        }
    }
}

// --- Static fixtures for the previews (wire models are plain data classes) ---

fun previewNumbers(): List<PhoneNumberSummary> = listOf(
    PhoneNumberSummary(
        id = "num_1",
        status = "active",
        country = "US",
        number_e164 = "+14155550134",
        created_at = "2026-01-01T00:00:00Z",
        voice_enabled = true,
    ),
)

fun previewCompany(): CompanyView = CompanyView(
    id = "co_1",
    name = "Northside Plumbing",
    country = "US",
    us_texting_enabled = true,
    requested_area_code = "415",
    timezone = "America/Los_Angeles",
    plan = "pro",
    subscription_status = SubscriptionStatus.ACTIVE,
    created_at = "2026-01-01T00:00:00Z",
    updated_at = "2026-07-01T00:00:00Z",
    numbers = previewNumbers(),
)

fun previewMe(): Me = Me(
    user_id = "usr_1",
    display_name = "Jordan Lee",
    memberships = listOf(
        Membership(
            company_id = "co_1",
            name = "Northside Plumbing",
            role = "owner",
            subscription_status = SubscriptionStatus.ACTIVE,
        ),
    ),
    company = previewCompany(),
)

fun previewUsage(): Usage = Usage(
    status = "quiet",
    period_end = "2026-08-01T00:00:00Z",
    included_segments = 2500,
    used_segments = 640,
)
