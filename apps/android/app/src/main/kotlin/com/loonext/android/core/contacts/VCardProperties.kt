package com.loonext.android.core.contacts

/**
 * #248 ROUND 3 — the same rule at the vCard door, which had no gate of any kind.
 *
 * `CATEGORIES:DNC`, `NOTE:DO NOT CONTACT - asked us to stop`, and a label like
 * `X-ABLabel=DO NOT CALL` typed beside a number are where a .vcf says
 * do-not-text. They are what Apple and Google actually export, and this app's
 * importer dropped all three without a word while the file's consent attestation
 * was written over the top.
 *
 * A .vcf has no columns to count, so the enumeration is of the PROPERTIES the
 * cards actually carry. Every one the importer does not read has to be declared
 * `ignore` or `opted_out` before the server will take the file.
 *
 * TWO ANSWERS, not the CSV's eight. A vCard property is not a column of values
 * to route into a field — it is present on a card or it is not — so the answers
 * that mean anything are "this says nothing about who may be texted" and "a card
 * carrying this must not be texted". Declaring `opted_out` blocks EVERY card that
 * carries the property at all, which is deliberately coarse: a `CATEGORIES` of
 * "Friends" is blocked alongside one of "DNC". Coarse in the direction of not
 * texting somebody is the only direction this feature is allowed to be wrong in.
 *
 * A PROPERTY IS WIDER THAN A PROPERTY NAME. It is also every PARAMETER on the
 * line, enumerated as `<PROPERTY>;<PARAM>` (see [parameterProperty]), and every
 * line carrying no colon at all. `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…` is
 * Apple's inline shape and it imported and delivered: TEL is read, so the line
 * was read, and the sentence after the second `;` was thrown away unlooked at.
 * See [contentLineProperties] for all three doors and what they cost.
 *
 * THE ENUMERATION IS A FAITHFUL PORT of `parseVCards` in
 * `apps/api/src/routes/core/vcard.ts`, and it has to be. A property this app
 * misses is a refusal the person cannot answer from the phone at all — the
 * server names something the sheet never showed, and the file becomes
 * unimportable from this device; a property this app invents is a question about
 * something that is not in their file. `VCardPropertiesTest` reads that
 * TypeScript for the mapped set and the parameter token, and runs the shapes
 * that parser handles against this one.
 */
object VCardProperties {

    /** Says nothing about who may be texted. */
    const val ACTION_IGNORE = ImportColumns.ACTION_IGNORE

    /** A card carrying this property must not be texted. */
    const val ACTION_OPTED_OUT = ImportColumns.FIELD_OPTED_OUT

    /** The two answers, in the order they are offered. */
    val ACTIONS: List<String> = listOf(ACTION_IGNORE, ACTION_OPTED_OUT)

    /**
     * The properties the importer reads. Everything else must be declared.
     *
     * `FN`, `N` and `TEL` are the name and the number. `BEGIN`, `END` and
     * `VERSION` are the format's own furniture and carry nothing about a person.
     */
    val MAPPED: List<String> = listOf("FN", "N", "TEL", "BEGIN", "END", "VERSION")

    /** The wire form of one property declaration: `<PROPERTY>:<action>`. */
    fun format(property: String, action: String): String = "$property:$action"

    /**
     * The token one PARAMETER is enumerated and declared under — the port of the
     * shared `vcardParameterProperty`.
     *
     * Qualified by its property, because the parameter alone is not the fact: a
     * `TYPE` on `TEL` and a `TYPE` on `EMAIL` are different text on different
     * lines, and one answer covering both would dismiss a value nobody saw.
     *
     * The server's enumeration and this one have to produce the same string
     * character for character or this app is refused forever — it would be asking
     * about `TEL/TYPE` while the server waits to be told about `TEL;TYPE`.
     */
    fun parameterProperty(property: String, parameter: String): String = "$property;$parameter"

    /**
     * Read one back, or null when it is not a declaration.
     *
     * Split on the LAST colon, the mirror of the column format's first: a
     * property name may be grouped or parameterised, and the action is the fixed
     * token, so the fixed end is the safe end to split from.
     */
    fun parse(raw: String): Pair<String, String>? {
        val colon = raw.lastIndexOf(':')
        if (colon == -1) return null
        val action = raw.substring(colon + 1)
        if (action !in ACTIONS) return null
        val property = raw.substring(0, colon).trim().uppercase()
        return if (property == "") null else property to action
    }

    /**
     * Every property these cards carry that the importer does not read, sorted —
     * exactly the set the server will refuse the file over.
     *
     * Sorted because the order carries no meaning and a stable list is one a
     * person can work down without it moving under them.
     */
    fun undeclared(vcf: ByteArray): List<String> =
        (present(String(vcf, Charsets.UTF_8)) - MAPPED.toSet()).sorted()

    /**
     * The port. Only content lines INSIDE a `BEGIN:VCARD` … `END:VCARD` block
     * count, exactly as the server counts them.
     */
    private fun present(text: String): Set<String> {
        val found = linkedSetOf<String>()
        var inCard = false
        for (line in unfold(text)) {
            val trimmed = line.trim()
            // BEGIN and END are matched before the property is recorded, which is
            // where the server records it too — so neither ever reaches the set
            // from here. They are in MAPPED anyway, and belt-and-braces is the
            // right posture for a list whose failure mode is an unanswerable 422.
            if (trimmed.equals("BEGIN:VCARD", ignoreCase = true)) {
                inCard = true
                continue
            }
            if (trimmed.equals("END:VCARD", ignoreCase = true)) {
                inCard = false
                continue
            }
            if (!inCard) continue
            found += contentLineProperties(line)
        }
        return found
    }

    /**
     * Unfold RFC 6350 / 2426 folded lines: a line starting with SPACE or TAB
     * continues the one before it.
     *
     * Load-bearing rather than tidiness. A `NOTE` folded across two lines whose
     * continuation happens to contain a colon reads, unfolded, as one NOTE — and
     * NOT unfolded as a second property named after whatever precedes that colon.
     * The server unfolds, so an app that did not would ask about a property that
     * does not exist and stay silent about the one that does.
     */
    private fun unfold(text: String): List<String> {
        val normalized = text.replace(Regex("\\r\\n?"), "\n")
        val lines = mutableListOf<String>()
        for (line in normalized.split("\n")) {
            if ((line.startsWith(" ") || line.startsWith("\t")) && lines.isNotEmpty()) {
                lines[lines.size - 1] = lines.last() + line.substring(1)
            } else {
                lines += line
            }
        }
        return lines
    }

    /**
     * EVERYTHING ONE CONTENT LINE HAS TO BE DECLARED UNDER: the property, and
     * then one token per PARAMETER on it. Empty for a line carrying no name.
     *
     * The property is everything before the first UNQUOTED colon, cut at the
     * first `;`, with a `group.` prefix stripped and the rest upper-cased.
     *
     * THREE WIDENINGS OVER THE OBVIOUS READING, and each of them is a door a
     * delivered message went through before round three closed it:
     *
     *   A LINE WITH NO COLON — `DO-NOT-CALL` on its own — is not a content line
     *   by the RFC, so the parse used to stop here and return nothing. That is a
     *   statement about the format and not about what the file was trying to say.
     *   The whole line is the token instead.
     *
     *   A MALFORMED PARAMETER (`CATEGORIES;TYPE="a:DNC`) leaves no unquoted colon
     *   at all, which is the same drop by a different route — and the property is
     *   CATEGORIES, one of the two places a .vcf can say stop.
     *
     *   PARAMETERS THEMSELVES. `TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+1613…` is
     *   Apple's inline shape: the property is TEL, TEL is read, and everything
     *   after the first `;` was thrown away — so the one sentence on the line
     *   saying not to text this person was the one part nobody looked at. Apple's
     *   OTHER shape, the grouped `item1.X-ABLabel:` line, was always caught, which
     *   is exactly what made this one look covered.
     *
     * The cost is that an ordinary phone export now asks about `TEL;TYPE`, whose
     * values are HOME and CELL and decide nothing. That is accepted rather than
     * exempted: a parameter is free text, `TYPE=DNC` is a real export, and a rule
     * that let the ubiquitous ones through would be a vocabulary — which is the
     * thing two rounds of this issue lost to.
     */
    fun contentLineProperties(line: String): List<String> {
        var colon = -1
        var inQuotes = false
        for (i in line.indices) {
            val char = line[i]
            if (char == '"') {
                inQuotes = !inQuotes
            } else if (char == ':' && !inQuotes) {
                colon = i
                break
            }
        }
        val namePart = if (colon == -1) line else line.substring(0, colon)
        val segments = namePart.split(';')
        var name = segments[0].trim()
        val dot = name.lastIndexOf('.')
        if (dot != -1) name = name.substring(dot + 1)
        if (name == "") return emptyList()
        val property = name.uppercase()
        val tokens = mutableListOf(property)
        for (segment in segments.drop(1)) {
            // `TYPE=CELL` is the parameter TYPE; a valueless `PREF` is its own
            // name. Everything to the RIGHT of the `=` is the free text nobody
            // read, and it is the reason the parameter has to be declared at all.
            val equals = segment.indexOf('=')
            val parameter =
                (if (equals == -1) segment else segment.substring(0, equals)).trim().uppercase()
            if (parameter == "") continue
            val token = parameterProperty(property, parameter)
            if (token !in tokens) tokens += token
        }
        return tokens
    }
}
