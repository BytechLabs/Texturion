package com.loonext.android.core.i18n

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import com.loonext.android.core.model.MessageLocale

/**
 * #228 Phase 1 — the words this app says, in both languages.
 *
 * ## Why a Kotlin catalogue rather than `res/values-fr-rCA/strings.xml`
 *
 * The obvious answer is the platform's, and it is the wrong one HERE for a
 * reason that is about this product rather than about Android:
 *
 * **The app's language is a PERSON's setting, not the device's.** #228 fixes
 * the order as user > device > company > English, so a Montreal owner running
 * the business in French can employ a tech whose phone is in English, and
 * neither has to argue with the other's setting. Resource qualifiers answer
 * only the device half. Overriding them means `AppCompatDelegate
 * .setApplicationLocales`, which needs an AppCompat dependency this app
 * deliberately does not have (`MainActivity`: "it needs no AppCompat theme"),
 * and which recreates every activity to take effect — a visible restart every
 * time somebody changes a dropdown.
 *
 * A map keyed by locale switches on recomposition, costs no dependency, and is
 * the same shape the other two clients use. That last part is not tidiness:
 * three clients that disagree about how a string is reached are three clients
 * whose translations drift, which is the whole subject of #338 and #376.
 *
 * ## The completeness guarantee
 *
 * Kotlin cannot do what web does — type the French as the English's exact
 * shape — so `AppStringsTest` asserts the two key sets are equal, per section,
 * in BOTH directions. A key in English and not in French is an English sentence
 * shown to a French reader; a key in French and not in English is a translation
 * of something that no longer exists, which is how a catalogue rots.
 *
 * ## Interpolation
 *
 * `{name}` only, exactly as on web. No plurals and no dates — dates and money
 * already go through the formatters this app has, and a second numbering system
 * here would be the drift this file exists to prevent.
 */
object AppStrings {
    /**
     * Every section, merged. Sections exist so the extraction can run in
     * parallel without every change colliding in one file, and so a translator
     * working through a screen sees its strings adjacent.
     */
    val en: Map<String, String> by lazy { SECTIONS.fold(emptyMap()) { acc, s -> acc + s.en } }
    val frCA: Map<String, String> by lazy { SECTIONS.fold(emptyMap()) { acc, s -> acc + s.frCA } }

    /**
     * One surface's words. Registered in [SECTIONS] below; a section that is
     * not registered is a section nothing can read, which the test also checks.
     */
    interface Section {
        val en: Map<String, String>
        val frCA: Map<String, String>
    }

    /** Every registered section, for the merge above and for the key test. */
    val SECTIONS: List<Section> = listOf(
        AuthStrings,
        CommonStrings,
        ContactsTasksStrings,
        DomainStrings,
        InboxStrings,
        PaymentsStrings,
        SettingsMoreStrings,
        SettingsStrings,
        ShellStrings,
        ThreadStrings,
    )

    /**
     * The words for one locale.
     *
     * Anything unrecognised falls back to English rather than throwing. This is
     * read during composition on every screen; a locale some later release adds
     * must degrade to a readable app rather than a crash.
     */
    fun table(locale: String?): Map<String, String> =
        if (locale == MessageLocale.FR_CA) frCA else en

    /**
     * Look one up, and substitute `{name}`.
     *
     * A MISSING key falls back to English and then to the key itself. The key
     * is deliberately the last resort rather than an empty string: a reader
     * meeting an English sentence has lost a translation, and a reader meeting
     * a blank has lost the product.
     */
    fun translate(
        locale: String?,
        key: String,
        vars: Map<String, String> = emptyMap(),
    ): String {
        val raw = table(locale)[key] ?: en[key] ?: key
        if (vars.isEmpty()) return raw
        return INTERPOLATION.replace(raw) { match ->
            vars[match.groupValues[1]] ?: match.value
        }
    }

    /**
     * `{name}`.
     *
     * Written as a character class rather than with `\w`, and that is not
     * style: in a Kotlin string literal a backslash-b is a BACKSPACE, not a
     * word boundary, and this repo has now lost two guards to exactly that —
     * one of them a check on a legal claim, which passed on the empty set for
     * months. A regex here that quietly matched nothing would leave `{amount}`
     * on screen in front of a customer.
     */
    private val INTERPOLATION = Regex("\\{([A-Za-z0-9_]+)\\}")
}

/**
 * The reader's language, provided once at the Compose root.
 *
 * Defaults to English OUTSIDE a provider rather than throwing, for the reason
 * the web hook does the same: a missing provider should give somebody an
 * English screen, which is what everybody had before this existed, rather than
 * a blank one.
 */
val LocalAppLocale = staticCompositionLocalOf { MessageLocale.DEFAULT }

/** `t("payments.askAction")`, and `t("payments.askFor", "amount" to "$250")`. */
@Composable
@ReadOnlyComposable
fun t(key: String, vararg vars: Pair<String, String>): String =
    AppStrings.translate(LocalAppLocale.current, key, vars.toMap())
