package com.loonext.android.ui.common

/**
 * #717: a picker with a "use the default" choice does not also offer the
 * default's own value as a second explicit choice, which would be two ways to
 * say one thing. The exception is a record already set explicitly to that
 * value: hiding it there would hide the state in force.
 *
 * An unknown default (still loading, or an older server) hides nothing.
 *
 * Hand-port of `apps/web/src/lib/default-choice.ts`.
 */
fun <T> offeredBesideDefault(value: T, defaultValue: T?, stored: T?): Boolean =
    value != defaultValue || value == stored

/** [choices] with the default's own value dropped, unless it is [stored]. */
fun <T> choicesBesideDefault(choices: List<T>, defaultValue: T?, stored: T?): List<T> =
    choices.filter { offeredBesideDefault(it, defaultValue, stored) }
