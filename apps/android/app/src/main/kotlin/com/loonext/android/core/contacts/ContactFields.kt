package com.loonext.android.core.contacts

/**
 * #291 — the fields a workspace defines for itself.
 *
 * A hand-port of `packages/shared/src/contact-fields.ts`. The equipment fields
 * an HVAC company needs are not the ones a plumber needs, and there is no set
 * we could ship that would be right for both.
 *
 * THE PRIVACY LINE IS PRODUCT COPY, NOT A DISCLAIMER. Custom fields let a
 * workspace store data classes we have not declared to the stores (#254) and
 * could not honour under our retention policy (#284). A text column cannot
 * enforce that, so the product says it at the one moment somebody is thinking
 * about what goes in a field: when they are defining it.
 *
 * `ContactFieldsParityTest` keeps the rules and the words identical to the web
 * and iOS copies.
 */
object ContactFields {
    /** How many fields a workspace may define. Mirrors `CONTACT_FIELDS_CAP`. */
    const val CAP = 10

    /** How many choices a dropdown may hold before it is a list nobody reads. */
    const val OPTIONS_CAP = 40

    /** The longest a stored value may be. */
    const val VALUE_MAX = 200

    /**
     * The types, deliberately few.
     *
     * Every one is something a crew can fill in from a van without thinking. A
     * formula or a lookup is a spreadsheet feature that arrives with its own
     * support burden and its own way of being wrong.
     */
    val KINDS = listOf("text", "number", "date", "select", "checkbox")

    /** What each type is called on screen. */
    fun kindLabel(kind: String): String = when (kind) {
        "number" -> "Number"
        "date" -> "Date"
        "select" -> "Dropdown"
        "checkbox" -> "Yes / no"
        else -> "Text"
    }

    /**
     * A label, turned into the key it will be stored under.
     *
     * The same string becomes a JSON key AND a CSV header for import mapping
     * (#248) and export (#227), so it has to survive both: lower case, no
     * spaces, no punctuation. Returns null when nothing usable is left — "???"
     * is not a field name, and inventing one would produce a column nobody can
     * map back to anything.
     */
    fun key(label: String): String? {
        val key = label
            .trim()
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "_")
            .replace(Regex("^_+|_+$"), "")
            .take(40)
            .replace(Regex("_+$"), "")
        // Must start with a letter: a key beginning with a digit is legal JSON
        // and an awkward column head, and the database refuses it anyway.
        return if (Regex("^[a-z][a-z0-9_]*$").matches(key)) key else null
    }

    /**
     * Is this value acceptable for this kind?
     *
     * Returns the reason it is not, or null when it is. A REASON rather than a
     * boolean because the caller shows it to somebody who typed the value, and
     * "invalid" tells them nothing they did not already suspect.
     */
    fun valueError(
        kind: String,
        options: List<String>?,
        label: String,
        value: String,
    ): String? {
        // Empty is always allowed, and it is not the same as absent: "we asked
        // and there is no gate code" is a fact worth recording.
        if (value.isEmpty()) return null
        if (value.length > VALUE_MAX) return "$label is too long"

        return when (kind) {
            "number" -> if (value.toDoubleOrNull() != null) null else "$label should be a number"
            // ISO date only. A crew typing "next Tuesday" into a date field is
            // a value nothing downstream can sort, filter or remind on.
            "date" ->
                if (Regex("""^\d{4}-\d{2}-\d{2}$""").matches(value)) null
                else "$label should be a date"
            "select" ->
                if (options.orEmpty().contains(value)) null
                else "$label is not one of the choices"
            "checkbox" ->
                if (value == "yes" || value == "no") null else "$label should be yes or no"
            else -> null
        }
    }

    /**
     * What the settings screen says, in one place — catalogue KEYS since #228.
     *
     * CAP_REACHED names {count} rather than baking $CAP in, and that fixed a
     * real mismatch: the card gates on the cap the SERVER sent, while this
     * sentence always said the client's constant.
     */
    object Copy {
        const val HEADING = "settings.contactFieldsHeading"
        const val INTRO = "settings.contactFieldsIntro"

        /**
         * THE LINE THAT MATTERS. Said where fields are defined, because that
         * is the only moment somebody is deciding what goes in one.
         */
        const val PRIVACY = "settings.contactFieldsPrivacy"

        const val CAP_REACHED = "settings.contactFieldsCapReached"

        /** Deleting a definition does not delete what people typed into it. */
        const val DELETE_WARNING = "settings.contactFieldsDeleteWarning"
    }
}
