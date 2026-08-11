package com.loonext.android.features.settings

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import com.loonext.android.core.referral.ReferralShare

/**
 * #288 — one tap, with a message they can edit.
 *
 * ## What this had to achieve
 *
 * Android had NO referral surface at all: the link existed on the server and on
 * the web app, and the phone — which is the device a contractor actually has in
 * their hand when they think of somebody to tell — could not reach it. #288 asks
 * for "one tap, a pre-written message they can edit, sent from the phone they are
 * already holding", and this is the phone half of that.
 *
 * ## What it does not do
 *
 * The chooser is Android's. The draft goes to the owner's own Messages, WhatsApp
 * or email, on their own number, and they pick the recipient — we never see who,
 * and nothing leaves through the carrier. That boundary is why this is not the
 * mass-texting D4 and D11 exclude: the product supplies the words, the person
 * supplies the distribution.
 *
 * ## Why the link is not in the text field
 *
 * The first owner to rewrite this in their own words would delete it, send it, and
 * get nothing for a referral they actually made. [ReferralShare.shareText] appends
 * it, so no version of this can go out without it.
 *
 * Applying: Smart Defaults — the draft is written, because an empty box is a form
 * and #288 is explicit that contractors will not fill one in. Zen of Clarity — one
 * primary action, one fallback, and no formatting controls on a text message.
 *
 * PARITY. Word-for-word identical copy to web's `referral-share.tsx` and iOS's
 * `ReferralShareBlock.swift`; `ReferralShareTest` asserts it against the shared
 * TypeScript.
 */
@Composable
fun ReferralShareBlock(link: String?, code: String) {
    var note by remember { mutableStateOf(ReferralShare.NOTE) }
    var copied by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val text = ReferralShare.shareText(note, link, code)
    // #228: the words are `ReferralShare`'s and stay there — they are asserted
    // against the shared TypeScript by `ReferralShareTest`, so a copy in the
    // Android catalogue would be a second source for one sentence. Built here
    // rather than inline so what reaches `Text` is a value, not a template.
    val linkLine = "${ReferralShare.LINK_NOTE} ${link ?: code}"

    OutlinedTextField(
        value = note,
        onValueChange = { note = it },
        label = { Text(ReferralShare.DRAFT_LABEL) },
        minLines = 3,
        modifier = Modifier.fillMaxWidth(),
    )
    Spacer(Modifier.height(6.dp))
    Text(
        linkLine,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(10.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(onClick = { shareReferral(context, text) }) {
            Text(ReferralShare.ACTION)
        }
        OutlinedButton(
            onClick = {
                clipboard.setText(AnnotatedString(text))
                copied = true
            },
        ) {
            Text(if (copied) ReferralShare.COPIED else ReferralShare.COPY)
        }
    }
}

/**
 * The chooser. Same shape as the diagnostics and crash-report shares.
 *
 * `runCatching` because a device with no app that accepts text/plain would
 * otherwise crash the settings screen — a stripped fleet tablet is rare and a
 * crash is not the honest response to it.
 */
internal fun shareReferral(context: Context, text: String) {
    val send = Intent(Intent.ACTION_SEND)
        .setType("text/plain")
        .putExtra(Intent.EXTRA_TEXT, text)
    runCatching {
        context.startActivity(Intent.createChooser(send, ReferralShare.TITLE))
    }
}
