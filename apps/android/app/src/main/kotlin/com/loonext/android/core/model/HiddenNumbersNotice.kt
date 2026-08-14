package com.loonext.android.core.model

import com.loonext.android.core.i18n.AppStrings

/**
 * #286 — saying that a number is missing, rather than letting it be missing.
 *
 * Hand-port of `packages/shared/src/hidden-numbers-notice.ts`. Per-number
 * access (#106) filters the numbers list server-side, and the filter is
 * silent. A tech who knows the shop runs two lines, opens the list and finds
 * one, cannot tell a permission from a bug — and the person they ask is the
 * owner, who then has to work out they configured it deliberately.
 *
 * A COUNT and nothing else: naming the number would undo the rule this
 * sentence exists to explain.
 *
 * The wording lives in shared and is ported rather than reinvented, because
 * three clients describing one access rule three different ways is the #437
 * failure on the surface where a new member forms their first impression.
 *
 * #228: [locale] is last and defaulted. A member who cannot see a number is the
 * member most likely to be the newest one on the crew, and the newest one is the
 * likeliest to be reading in the other language.
 */
fun hiddenNumbersNotice(hiddenCount: Int, locale: String? = null): String? {
    if (hiddenCount <= 0) return null
    return if (hiddenCount == 1) {
        AppStrings.translate(locale, "domain.hiddenNumbersOne")
    } else {
        AppStrings.translate(
            locale,
            "domain.hiddenNumbersMany",
            mapOf("count" to hiddenCount.toString()),
        )
    }
}
