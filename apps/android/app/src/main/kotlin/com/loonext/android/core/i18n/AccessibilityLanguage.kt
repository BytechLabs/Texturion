package com.loonext.android.core.i18n

import android.os.Bundle
import android.text.Spannable
import android.text.SpannableString
import android.text.Spanned
import android.text.style.LocaleSpan
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityEvent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import androidx.core.view.accessibility.AccessibilityNodeProviderCompat
import java.util.Locale

/**
 * Attaches the reader's resolved in-app language to the Android accessibility
 * text exposed by the Compose host.
 *
 * Compose has no language semantics property. Its accessibility bridge does,
 * however, expose each virtual node's text as a [CharSequence], and Android's
 * multilingual TTS contract is a [LocaleSpan]. Wrapping the bridge lets us add
 * that span to text, labels, values and hints without merging the semantics
 * tree or replacing any node's name, role, state, actions or traversal order.
 *
 * Existing locale spans win. That matters for future mixed-language content:
 * an English customer name or a deliberately annotated phone number must not
 * be relabelled French merely because the surrounding app is French.
 *
 * This is mechanical language metadata, not a claim that TalkBack pronounces
 * every primary flow correctly. That still needs the physical-device pass in
 * `docs/ACCESSIBILITY.md`.
 */
@Composable
fun AppAccessibilityLanguage(
    locale: String,
    content: @Composable () -> Unit,
) {
    val host = LocalView.current
    DisposableEffect(host, locale) {
        val previous = ViewCompat.getAccessibilityDelegate(host)
            ?: AccessibilityDelegateCompat()
        val languageDelegate = LanguageAccessibilityDelegate(previous, locale)
        ViewCompat.setAccessibilityDelegate(host, languageDelegate)
        host.sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)

        onDispose {
            ViewCompat.setAccessibilityDelegate(host, previous)
        }
    }

    content()
}

/** Delegates every behaviour to Compose and changes only returned speech text. */
internal class LanguageAccessibilityDelegate(
    private val delegate: AccessibilityDelegateCompat,
    languageTag: String,
) : AccessibilityDelegateCompat() {
    private val locale = Locale.forLanguageTag(languageTag)

    override fun getAccessibilityNodeProvider(host: View): AccessibilityNodeProviderCompat? =
        delegate.getAccessibilityNodeProvider(host)?.let {
            LanguageAccessibilityNodeProvider(it, locale)
        }

    override fun onInitializeAccessibilityNodeInfo(
        host: View,
        info: AccessibilityNodeInfoCompat,
    ) {
        delegate.onInitializeAccessibilityNodeInfo(host, info)
        info.attachLanguage(locale)
    }

    override fun performAccessibilityAction(host: View, action: Int, args: Bundle?): Boolean =
        delegate.performAccessibilityAction(host, action, args)

    override fun dispatchPopulateAccessibilityEvent(host: View, event: AccessibilityEvent): Boolean {
        val populated = delegate.dispatchPopulateAccessibilityEvent(host, event)
        event.attachLanguage(locale)
        return populated
    }

    override fun onInitializeAccessibilityEvent(host: View, event: AccessibilityEvent) {
        delegate.onInitializeAccessibilityEvent(host, event)
        event.attachLanguage(locale)
    }

    override fun onPopulateAccessibilityEvent(host: View, event: AccessibilityEvent) {
        delegate.onPopulateAccessibilityEvent(host, event)
        event.attachLanguage(locale)
    }

    override fun onRequestSendAccessibilityEvent(
        host: ViewGroup,
        child: View,
        event: AccessibilityEvent,
    ): Boolean {
        event.attachLanguage(locale)
        return delegate.onRequestSendAccessibilityEvent(host, child, event)
    }

    override fun sendAccessibilityEvent(host: View, eventType: Int) {
        delegate.sendAccessibilityEvent(host, eventType)
    }

    override fun sendAccessibilityEventUnchecked(host: View, event: AccessibilityEvent) {
        event.attachLanguage(locale)
        delegate.sendAccessibilityEventUnchecked(host, event)
    }
}

/** A transparent provider: virtual node ids and every action stay Compose's. */
internal class LanguageAccessibilityNodeProvider(
    private val provider: AccessibilityNodeProviderCompat,
    private val locale: Locale,
) : AccessibilityNodeProviderCompat() {

    override fun createAccessibilityNodeInfo(virtualViewId: Int): AccessibilityNodeInfoCompat? =
        provider.createAccessibilityNodeInfo(virtualViewId)?.also { it.attachLanguage(locale) }

    override fun findAccessibilityNodeInfosByText(
        text: String,
        virtualViewId: Int,
    ): List<AccessibilityNodeInfoCompat> =
        provider.findAccessibilityNodeInfosByText(text, virtualViewId)
            .orEmpty()
            .onEach { it.attachLanguage(locale) }

    override fun findFocus(focus: Int): AccessibilityNodeInfoCompat? =
        provider.findFocus(focus)?.also { it.attachLanguage(locale) }

    override fun performAction(
        virtualViewId: Int,
        action: Int,
        arguments: Bundle?,
    ): Boolean = provider.performAction(virtualViewId, action, arguments)

    override fun addExtraDataToAccessibilityNodeInfo(
        virtualViewId: Int,
        info: AccessibilityNodeInfoCompat,
        extraDataKey: String,
        arguments: Bundle?,
    ) {
        provider.addExtraDataToAccessibilityNodeInfo(
            virtualViewId,
            info,
            extraDataKey,
            arguments,
        )
        info.attachLanguage(locale)
    }
}

private fun AccessibilityNodeInfoCompat.attachLanguage(locale: Locale) {
    text = text.withAccessibilityLanguage(locale)
    contentDescription = contentDescription.withAccessibilityLanguage(locale)
    stateDescription = stateDescription.withAccessibilityLanguage(locale)
    hintText = hintText.withAccessibilityLanguage(locale)
    error = error.withAccessibilityLanguage(locale)
    paneTitle = paneTitle.withAccessibilityLanguage(locale)
    tooltipText = tooltipText.withAccessibilityLanguage(locale)
    roleDescription = roleDescription.withAccessibilityLanguage(locale)
    containerTitle = containerTitle.withAccessibilityLanguage(locale)
    supplementalDescription = supplementalDescription.withAccessibilityLanguage(locale)
}

private fun AccessibilityEvent.attachLanguage(locale: Locale) {
    for (index in text.indices) {
        text[index] = text[index].withAccessibilityLanguage(locale)
    }
    contentDescription = contentDescription.withAccessibilityLanguage(locale)
    beforeText = beforeText.withAccessibilityLanguage(locale)
}

/**
 * Adds [LocaleSpan] only to ranges which do not already name a language.
 * Other spans are copied by [SpannableString], so links, TTS annotations and
 * per-content language overrides survive byte-for-byte.
 */
internal fun CharSequence?.withAccessibilityLanguage(locale: Locale): CharSequence? {
    if (this == null || isEmpty()) return this

    val out = SpannableString(this)
    val covered = BooleanArray(length)
    if (this is Spanned) {
        for (span in getSpans(0, length, LocaleSpan::class.java)) {
            val start = getSpanStart(span).coerceIn(0, length)
            val end = getSpanEnd(span).coerceIn(start, length)
            for (index in start until end) covered[index] = true
        }
    }

    var start = 0
    while (start < length) {
        while (start < length && covered[start]) start += 1
        if (start == length) break
        var end = start + 1
        while (end < length && !covered[end]) end += 1
        out.setSpan(
            LocaleSpan(locale),
            start,
            end,
            Spannable.SPAN_EXCLUSIVE_EXCLUSIVE,
        )
        start = end
    }
    return out
}
