package com.loonext.android.core.i18n

import android.app.LocaleManager
import android.content.Context
import android.content.res.Resources
import android.os.Build
import android.os.LocaleList
import com.loonext.android.core.model.MessageLocale
import java.util.Locale

private const val PLATFORM_LOCALE_PREFS = "platform_locale"
private const val APPLIED_LOCALE = "applied_locale"
private const val PREVIOUS_LOCALES = "previous_locales"

/**
 * #228 Phase 1 — WHICH language this app draws itself in, hand-ported from
 * `resolveUiLocale` / `normalizeDeviceLocale` in packages/shared/src/locale.ts.
 *
 * ## Why it is not the same question as [MessageLocale]'s
 *
 * `resolveLocale` on the send path answers "what does this CUSTOMER receive".
 * This answers "what does this CREW MEMBER read", and the two deliberately do
 * not share an order, because the people are different and so is the evidence:
 *
 *   1. THEIR OWN SETTING. Somebody who has said what they read has said it.
 *   2. THE DEVICE. A phone's language is a choice its owner already made, once,
 *      for everything on it. It is better evidence about what a person reads
 *      than a setting their employer made — which is exactly why it outranks
 *      the workspace here and does not exist at all in the send path.
 *   3. THE WORKSPACE. The business's own language, as a last guess.
 *   4. English.
 *
 * A bilingual shop is the case this ordering exists for: the owner runs the
 * business in French and employs a tech whose phone is in English, and neither
 * of them should have to argue with the other's setting to read the app.
 *
 * ## Why it is hand-ported rather than shared
 *
 * There is no shared Kotlin, the same way `MessageLocale` in `Core.kt` has none.
 * A hand-port is where this drifts, so it is tested against the same vectors the
 * TypeScript is (`UiLocaleTest`) rather than trusted — this repo has already
 * recorded a hand-ported rule that compiled, ran, and matched nothing.
 */
object UiLocale {
    /**
     * The language this reader gets, given everything we know.
     *
     * [deviceTag] arrives in whatever shape the platform hands over —
     * `fr-CA`, `fr_CA`, `fr`, `en-US` — so it is normalised rather than matched.
     */
    fun resolve(
        userLocale: String?,
        deviceTag: String?,
        companyLocale: String?,
    ): String {
        if (isKnown(userLocale)) return userLocale!!
        normalizeDevice(deviceTag)?.let { return it }
        if (isKnown(companyLocale)) return companyLocale!!
        return MessageLocale.DEFAULT
    }

    /**
     * A platform's locale tag, read as one of ours — or null when it is neither.
     *
     * Null rather than English on purpose: "this device says nothing we
     * recognise" has to fall through to the workspace, and returning English
     * here would stop that and quietly override a French business's own setting
     * with a default.
     *
     * `fr` alone resolves to fr-CA because fr-CA is the only French this product
     * has; a French speaker in France reading Quebec French is a far better
     * outcome than one reading English.
     */
    fun normalizeDevice(tag: String?): String? {
        if (tag == null) return null
        // `lowercase(Locale.ROOT)`, not the default locale: a Turkish phone
        // lowercases `I` to a dotless `ı`, so a device reporting `EN-GB` on one
        // would stop being recognised as English by the app it is running.
        val primary = tag.replace('_', '-').substringBefore('-').lowercase(Locale.ROOT)
        return when (primary) {
            "fr" -> MessageLocale.FR_CA
            "en" -> MessageLocale.EN
            else -> null
        }
    }

    /** This device's own language, in the shape [normalizeDevice] expects. */
    fun deviceTag(): String {
        val systemLocale = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            Resources.getSystem().configuration.locales[0]
        } else {
            null
        }
        return (systemLocale ?: Locale.getDefault()).toLanguageTag()
    }

    /** The locale Android would use for Loonext without a member's preference. */
    fun deviceTag(context: Context): String {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return deviceTag()
        val manager = context.getSystemService(LocaleManager::class.java) ?: return deviceTag()
        val prefs = context.getSharedPreferences(PLATFORM_LOCALE_PREFS, Context.MODE_PRIVATE)
        val native = manager.applicationLocales
        val inherited = if (native.toLanguageTags() == prefs.getString(APPLIED_LOCALE, null)) {
            LocaleList.forLanguageTags(prefs.getString(PREVIOUS_LOCALES, ""))
        } else {
            native
        }
        return inherited[0]?.toLanguageTag() ?: deviceTag()
    }

    /** TalkBack uses Android's app locale when it chooses the voice for a view. */
    fun applyPlatformPreference(context: Context, userLocale: String?) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val manager = context.getSystemService(LocaleManager::class.java) ?: return
        val prefs = context.getSharedPreferences(PLATFORM_LOCALE_PREFS, Context.MODE_PRIVATE)
        val current = manager.applicationLocales.toLanguageTags()
        val applied = prefs.getString(APPLIED_LOCALE, null)
        if (isKnown(userLocale)) {
            if (current == userLocale) return
            val previous = if (current == applied) prefs.getString(PREVIOUS_LOCALES, "") else current
            prefs.edit()
                .putString(PREVIOUS_LOCALES, previous)
                .putString(APPLIED_LOCALE, userLocale)
                .apply()
            manager.applicationLocales = LocaleList.forLanguageTags(userLocale)
        } else if (applied != null) {
            val previous = prefs.getString(PREVIOUS_LOCALES, "")
            prefs.edit().clear().apply()
            if (current == applied) manager.applicationLocales = LocaleList.forLanguageTags(previous)
        }
    }

    private fun isKnown(value: String?): Boolean =
        value == MessageLocale.EN || value == MessageLocale.FR_CA
}
