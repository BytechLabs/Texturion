package com.loonext.android.ui.common

import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle

/**
 * The Loonext wordmark rule (#206): "Loonext" in Golos SemiBold with exactly
 * the SECOND o in the accent — olive on light surfaces, lime on dark. Always
 * spans in code, never an image. `colorScheme.secondary` maps to precisely
 * that pair (Olive #66801F light / DarkLime #B9CF57 dark), so the accent is
 * theme-aware for free. Golos comes from the caller's text style (the app's
 * typography is Golos everywhere outside display sizes).
 */
fun AnnotatedString.Builder.appendLoonextWordmark(accent: Color) {
    withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
        append("Lo")
        withStyle(SpanStyle(color = accent)) { append("o") }
        append("next")
    }
}

/** The wordmark, optionally followed by plain trailing text (version rows). */
@Composable
fun loonextWordmark(suffix: String = ""): AnnotatedString {
    val accent = MaterialTheme.colorScheme.secondary
    return remember(accent, suffix) {
        buildAnnotatedString {
            appendLoonextWordmark(accent)
            if (suffix.isNotEmpty()) append(suffix)
        }
    }
}
