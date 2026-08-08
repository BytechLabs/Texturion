package com.loonext.android.core.contacts

/**
 * #248 ROUND 3 — THERE IS NO CLASSIFIER. This is what replaced it.
 *
 * A hand-port of the column half of `packages/shared/src/contact-import.ts` and
 * `contact-import-headers.ts`, plus the CSV reader from
 * `apps/api/src/routes/core/csv.ts`. `ImportColumnsTest` reads those TypeScript
 * files out of the repo and fails if the port drifts, because the usual
 * alternative — pinning the same values a second time in a test — proves only
 * that the copy has not changed, never that it is right.
 *
 * WHAT WAS HERE BEFORE, AND WHY IT IS GONE. Round one asked "does this dropped
 * column mean do-not-contact" of WORDS, and a file headed "Do Not Call" imported
 * attested while a real text reached somebody who had said stop. Round two asked
 * it of SHAPE — few distinct values, short values, repeated across rows — which
 * is a vocabulary of numbers, and it lost the same way: four distinct answers
 * walked through, a 25-character value walked through, the same answer on all
 * sixty rows walked through, and a cell past the end of the header row was never
 * looked at at all. This file held that shape test. It is deleted rather than
 * tuned, along with its three thresholds, because a threshold that can be tuned
 * is a threshold the next export is outside of.
 *
 * WHAT REPLACED IT. Nothing is ever silently dropped: every column of the file is
 * either MAPPED to a contact field or EXPLICITLY DISMISSED by somebody who could
 * see its values, and the server refuses the upload until it has been told which,
 * by index, for every column. So this file no longer decides anything. It reads
 * the file, guesses what it can, and hands the whole thing to a person.
 *
 * WHAT IT STILL DOES NOT GUARANTEE. [defaultColumns] is a GUESS and the header
 * patterns behind it are a convenience — they are never a gate, and no test here
 * may treat a match as permission. The declaration is a claim made by whoever
 * tapped Import, exactly like the consent attestation beside it.
 */
object ImportColumns {

    /** The declaration for a column that says nothing about who may be texted. */
    const val ACTION_IGNORE = "ignore"

    /** The fields a CSV column can be claimed by, as the shared module names them. */
    const val FIELD_OPTED_OUT = "opted_out"
    const val FIELD_PHONE = "phone"

    /**
     * Every answer a column may carry, in the order they are offered.
     *
     * The SET is what the server validates against (`COLUMN_ACTIONS`) and the
     * parity test compares as a set. The ORDER is this app's, and it is a UI
     * decision with a reason: [ACTION_IGNORE] is last and [FIELD_OPTED_OUT] sits
     * immediately above it, so somebody reaching for "this says nothing" passes
     * their eye over "do not text" on the way. The two answers are one tap apart
     * and one of them texts everybody the column was protecting.
     */
    val ACTIONS: List<String> = listOf(
        FIELD_PHONE,
        "name",
        "first_name",
        "last_name",
        "address",
        "notes",
        FIELD_OPTED_OUT,
        ACTION_IGNORE,
    )

    /**
     * Header patterns per target field, most specific first — the ported
     * `FIELD_PATTERNS`, held as SOURCE strings so the parity test can compare
     * them against the TypeScript character for character. Order is load-bearing
     * and is part of what that test pins.
     */
    val FIELD_PATTERNS: List<Pair<String, List<String>>> = listOf(
        FIELD_OPTED_OUT to listOf(
            "^optedout$",
            "optout",
            "unsubscribe",
            "donottext|donotcontact|donotcall|donotmail",
            "suppress",
            "^dnc$|^dncflag$|^dnclist$",
            "^stop$|^stopped$",
            "blocked",
        ),
        // #248: `^phone\d*value$` outranks the loose `phone` on purpose. A Google
        // Contacts export writes every repeatable field as a PAIR — `Phone 1 -
        // Type` holding "Mobile", then `Phone 1 - Value` holding the number — and
        // the label comes FIRST. Patterns are tried in order and each scans the
        // columns left to right, so the loose one claimed the labels: every row's
        // number read "Mobile" and every row was unusable.
        FIELD_PHONE to listOf(
            "^phone$",
            "^phone[0-9]*value$",
            "phone",
            "mobile",
            "^cell",
            "^tel",
            "number",
        ),
        "first_name" to listOf(
            "^firstname$",
            "^givenname$",
            "^first$",
            "^fname$",
            "firstname|givenname",
        ),
        "last_name" to listOf(
            "^lastname$",
            "^surname$",
            "^familyname$",
            "^last$",
            "^lname$",
            "lastname|surname|familyname",
        ),
        "name" to listOf(
            "^name$",
            "^fullname$",
            "^contactname$|^customername$|^clientname$",
            "^contact$|^customer$|^client$",
        ),
        "address" to listOf("^address$", "address", "^addr", "street"),
        "notes" to listOf("^notes?$", "comment", "memo", "description"),
    )

    /**
     * `name`'s last resort — any header merely CONTAINING "name", and only when
     * the file carries no split-name columns. In a `First Name, Last Name,
     * Company Name, Phone` export it would otherwise claim "Company Name".
     */
    const val NAME_LAST_RESORT = "name"

    /**
     * How many of a column's values are read off the file to show somebody.
     *
     * A SAMPLE, not an inventory, and the copy says so — a column of four hundred
     * `Subscribed`s says one thing and printing it four hundred times says it
     * worse. Five is what the shared module shows the web wizard; the phone shows
     * the same five so the two screens do not disagree about what a column holds.
     */
    const val SAMPLE_LIMIT = 5

        /**
         * The most distinct values kept per column for showing on request.
         *
         * A do-not-text column holds a handful. A name column holds one per row,
         * and laying out 50,000 of them is how a declaration sheet stops opening.
         * Past this, [ColumnValues.total] still reports the truth, so the count on
         * screen is right even when the list is cut.
         *
         * This bounds what is DRAWN. Counting distinct values means remembering
         * every one seen, so what a column costs in memory is set by the file.
         */
        const val VALUE_CEILING = 200

    // `containsMatchIn`, never `matches`: the shared patterns are used with
    // JavaScript's `RegExp.test`, which is a SEARCH. `/phone/` is meant to match
    // "phonenumber", and Kotlin's `matches` would anchor it to the whole string
    // and quietly claim nothing.
    private val compiled: List<Pair<String, List<Regex>>> by lazy {
        FIELD_PATTERNS.map { (field, sources) -> field to sources.map { Regex(it) } }
    }

    private val lastResort by lazy { Regex(NAME_LAST_RESORT) }

    /** Case, spaces, and punctuation are noise: "Phone Number" → "phonenumber". */
    fun normalizeHeader(header: String): String =
        header.lowercase().replace(Regex("[^a-z0-9]"), "")

    /**
     * One column's answer on the wire: where it is, what it is, what it is called.
     *
     * [index] IS the identity. Round two matched its field on the normalised
     * header, which strips everything but `[a-z0-9]` — so every header with no
     * ASCII alphanumerics ("", "—", "#", "★") collapsed to the SAME EMPTY STRING
     * and two of them could not be told apart. A position cannot collide with
     * another position.
     *
     * [header] is carried anyway and the server checks it: it is what catches a
     * declaration describing some OTHER file — yesterday's export, the wrong
     * branch of an integration — rather than the one actually attached.
     */
    data class Declaration(val index: Int, val action: String, val header: String)

    /**
     * The wire form of one declaration: `<index>:<action>:<header>`.
     *
     * The header goes LAST because it may contain anything at all, colons
     * included; the two splits before it are on fixed, safe tokens. It goes up
     * exactly as the file spelled it (trimmed, which is what the server trims
     * too) — a client that tidied it further would be describing a column name
     * that is in nobody's file.
     */
    fun format(declaration: Declaration): String =
        "${declaration.index}:${declaration.action}:${declaration.header}"

    /**
     * Read one declaration back off the wire, or null when it is not one.
     *
     * Only exists so the tests can prove [format] round-trips through the rules
     * the SERVER parses by — digits only for the index (`Number("")` is 0 and
     * `Number(" 1 ")` is 1, so a lenient parse reads a malformed field as a
     * confident answer about column zero), a known action, and everything after
     * the second colon is the header however many colons it contains.
     */
    fun parse(raw: String): Declaration? {
        val firstColon = raw.indexOf(':')
        if (firstColon == -1) return null
        val secondColon = raw.indexOf(':', firstColon + 1)
        if (secondColon == -1) return null
        val rawIndex = raw.substring(0, firstColon)
        if (!rawIndex.all { it in '0'..'9' } || rawIndex.isEmpty()) return null
        val action = raw.substring(firstColon + 1, secondColon)
        if (action !in ACTIONS) return null
        return Declaration(rawIndex.toInt(), action, raw.substring(secondColon + 1))
    }

    /**
     * One column, ready to be put in front of a person.
     *
     * [guess] is null for "nobody has answered this yet" — see [defaultColumns]
     * for why the guess deliberately stops short of filling every one in.
     */
    data class Column(
        /** 0-based position in the row. */
        val index: Int,
        /** The header exactly as the file spelled it, `""` for a nameless column. */
        val header: String,
        /** What the detector recognised this as, or null if it recognised nothing. */
        val guess: String?,
        /** Up to [SAMPLE_LIMIT] distinct values, so the question can be answered. */
        val samples: List<String>,
        /**
         * Every distinct value held for this column, for somebody who asks to see
         * them. [samples] is its first few; this is bounded only by [VALUE_CEILING].
         */
        val values: List<String>,
        /** How many distinct values the column really has, counted past the ceiling. */
        val total: Int,
    )

    /** A parsed file: how big it is, and every column it turned out to have. */
    data class Plan(val rowCount: Int, val columns: List<Column>)

    /**
     * Detect a column mapping from the header row. Each column is claimed by at
     * most one field; per field the most specific pattern wins, scanning columns
     * left to right.
     */
    fun detectColumns(headers: List<String>): Map<String, Int> {
        val normalized = headers.map { normalizeHeader(it) }
        val claimed = mutableSetOf<Int>()
        val mapping = mutableMapOf<String, Int>()

        fun claim(field: String, patterns: List<Regex>) {
            for (pattern in patterns) {
                for (i in normalized.indices) {
                    if (i in claimed) continue
                    if (pattern.containsMatchIn(normalized[i])) {
                        mapping[field] = i
                        claimed += i
                        return
                    }
                }
            }
        }

        for ((field, patterns) in compiled) claim(field, patterns)
        if (
            mapping["name"] == null &&
            mapping["first_name"] == null &&
            mapping["last_name"] == null
        ) {
            claim("name", listOf(lastResort))
        }
        return mapping
    }

    /**
     * HOW MANY COLUMNS THIS FILE HAS — which is not `headers.size`.
     *
     * Every loop in round two was bounded by the header row, so a cell PAST the
     * end of it was not merely misread: it was never looked at. `Phone,Name` over
     * a row reading `+1206…,Ann,DO NOT CALL` dropped the third cell before any
     * rule could see it, and hand-edited files do this constantly — somebody adds
     * a note to one row and does not touch the header.
     *
     * So the count comes from the DATA. A cell past the header is a column with a
     * blank name and it is answered for like any other. NO EXEMPTION FOR AN EMPTY
     * COLUMN either: a stray trailing comma adds a column nobody meant with
     * nothing in it, and making somebody answer for it feels like noise — but
     * "a column with nothing in it decides nothing" is a rule about which columns
     * may be skipped, and a rule about which columns may be skipped is exactly
     * what two rounds of this issue lost to.
     */
    fun columnCount(headers: List<String>, dataRows: List<List<String>>): Int {
        var count = headers.size
        for (row in dataRows) if (row.size > count) count = row.size
        return count
    }

    /**
     * The distinct values one column carries, for showing somebody what they are
     * being asked about.
     *
     * The whole design rests on a person SEEING "DO NOT CALL" before they dismiss
     * the column that holds it, so this is part of the contract rather than a
     * detail of one screen: an app that showed only header names would be asking
     * the question without showing the answer.
     *
     * Distinct and in file order, blanks dropped, stopping at [SAMPLE_LIMIT].
     */
    fun samples(dataRows: List<List<String>>, index: Int, limit: Int = SAMPLE_LIMIT): List<String> {
        val seen = LinkedHashMap<String, String>()
        for (row in dataRows) {
            val value = (row.getOrNull(index) ?: "").trim()
            if (value == "") continue
            seen.putIfAbsent(value.lowercase(), value)
            if (seen.size >= limit) break
        }
        return seen.values.toList()
    }

    /** What one column holds, and how much of it is being shown. */
    data class ColumnValues(
        /** Distinct non-blank values in file order, at most [VALUE_CEILING]. */
        val values: List<String>,
        /**
         * How many distinct values the column really has.
         *
         * Counted past the ceiling on purpose: "and 12 more" tells somebody they
         * have not seen everything, and "and more" could as easily stand for one
         * value as four hundred.
         */
        val total: Int,
    )

    /**
     * What every column of a file holds, from one pass over the rows.
     *
     * One pass rather than one per column because knowing how many distinct values
     * a column REALLY has means reading every row of it — there is no early exit
     * from a count. Answering for all columns at once costs what the old
     * per-column [samples] loop cost, and answers honestly.
     */
    fun allColumnValues(dataRows: List<List<String>>, columnCount: Int): List<ColumnValues> {
        val seen = List(columnCount) { mutableSetOf<String>() }
        val kept = List(columnCount) { mutableListOf<String>() }
        for (row in dataRows) {
            for (index in 0 until columnCount) {
                val value = (row.getOrNull(index) ?: "").trim()
                if (value == "") continue
                // The set counts, the list shows. Only the second one is bounded,
                // and it keeps the file's own spelling rather than the key.
                if (!seen[index].add(value.lowercase())) continue
                if (kept[index].size < VALUE_CEILING) kept[index].add(value)
            }
        }
        return List(columnCount) { index -> ColumnValues(kept[index].toList(), seen[index].size) }
    }

    /**
     * THE DEFAULT GUESS — and it deliberately stops short of a complete answer.
     *
     * [Column.guess] is a FIELD or null, and [ACTION_IGNORE] is not one of the
     * things it can be. That is the whole rule: a dismissal is an ANSWER — it
     * says "I looked at these values and they decide nothing" — and a detector
     * has not looked at a single value. A function that can only say "phone" or
     * "I have nothing" cannot manufacture one.
     *
     * THE SHARED MODULE USED TO DO EXACTLY THAT, and this port used to explain
     * itself by the contrast. `defaultContactImportColumns` filled every
     * unrecognised column with `ignore`, which read as honest for a wizard that
     * puts all of them on one screen — and it was not: `Phone,Name,Notes` with a
     * Notes column reading "DO NOT CALL - asked us to stop" came back a COMPLETE
     * declaration, every client posted it with no interaction at all, and the
     * message went out. It now guesses a field or nothing, on every client, and
     * the only `ignore` that ever reaches the server is one a person chose.
     *
     * The columns the detector DID recognise are pre-filled, because that is a
     * real guess with a stated meaning shown on screen next to its values — and
     * it is still only a guess, changeable on every one of them. Being recognised
     * is not being answered for: a recognised column is on the screen with its
     * values like every other, which is what [sheetRows] exists to hold true.
     */
    fun defaultColumns(headers: List<String>, dataRows: List<List<String>>): List<Column> {
        val trimmed = headers.map { it.trim() }
        val mapping = detectColumns(trimmed)
        val byIndex = mapping.entries.associate { (field, index) -> index to field }
        val count = columnCount(trimmed, dataRows)
        val held = allColumnValues(dataRows, count)
        return (0 until count).map { index ->
            Column(
                index = index,
                header = trimmed.getOrNull(index) ?: "",
                guess = byIndex[index],
                samples = held[index].values.take(SAMPLE_LIMIT),
                values = held[index].values,
                total = held[index].total,
            )
        }
    }

    /**
     * One line of the declaration sheet: a column, and the heading that starts
     * its group when there is one to start.
     */
    data class SheetRow(
        val column: Column,
        /**
         * [ContactImport.Columns.NEEDS_ANSWER] or
         * [ContactImport.Columns.RECOGNISED] on the first column of its group,
         * null on every other row and on every row of a single-group file — one
         * heading over the only list on the screen is furniture.
         */
        val heading: String?,
    )

    /**
     * EVERY COLUMN OF THE FILE, IN THE ORDER THE SHEET DRAWS THEM.
     *
     * This exists as a value rather than as two calls inside the Compose file
     * because of what it is holding up. The one thing that makes a single tap on
     * Import defensible for a file whose every column was recognised is that the
     * words "DO NOT CALL" were on the screen under the finger — so "the sheet
     * renders the whole file" is the load-bearing claim of this feature, and
     * Compose is not unit-testable in this module. Rendering from two calls left
     * that claim resting on the second one existing: deleting
     * `section(RECOGNISED, known)` turned this screen into the exact defect the
     * web wizard shipped — only the unanswered columns drawn, `Phone,Name,Notes`
     * drawing nothing at all, `2:notes:Notes` posted with nobody having seen the
     * column — and it survived all 1407 tests in this app.
     *
     * So the screen has ONE loop and it is over this, and this is a function a
     * test can run.
     *
     * THE ORDER IS THE POINT AND IT IS NOT ALPHABETICAL. Unanswered first,
     * because that is where the work is; recognised after, because they are right
     * more often than not but are still every bit as much on the screen. The
     * split is on what the DETECTOR recognised and never on what is answered
     * right now — grouping by the live answer would make cards jump between
     * groups under the finger that just answered them.
     */
    fun sheetRows(columns: List<Column>): List<SheetRow> {
        val unknown = columns.filter { it.guess == null }
        val known = columns.filter { it.guess != null }
        // Headings only when BOTH groups exist. A file nobody recognised, and a
        // file recognised entirely, are each one list — and "Not recognised" over
        // the only list on the screen says nothing the list does not.
        val labelled = unknown.isNotEmpty() && known.isNotEmpty()
        return buildList {
            unknown.forEachIndexed { position, column ->
                add(
                    SheetRow(
                        column,
                        if (labelled && position == 0) ContactImport.Columns.NEEDS_ANSWER else null,
                    ),
                )
            }
            known.forEachIndexed { position, column ->
                add(
                    SheetRow(
                        column,
                        if (labelled && position == 0) ContactImport.Columns.RECOGNISED else null,
                    ),
                )
            }
        }
    }

    /**
     * Everything above, run over the bytes somebody just picked.
     *
     * Returns NULL for a file that has no header row and at least one data row.
     * That file is refused by the server for its own reason, before it looks at a
     * single column, and there is no per-column question to ask about it — so the
     * caller uploads it undeclared and shows whatever the server says. Deciding
     * that here would be this app inventing a refusal, which is the one thing a
     * client must not do with a gate the server owns.
     */
    fun plan(csv: ByteArray): Plan? {
        val rows = parseRows(String(csv, Charsets.UTF_8))
        if (rows.size < 2) return null
        val dataRows = rows.drop(1)
        return Plan(rowCount = dataRows.size, columns = defaultColumns(rows[0], dataRows))
    }

    /**
     * Minimal RFC 4180 parse — the port of `parseCsvRows`. Quoted fields,
     * embedded commas and newlines, doubled quotes, CRLF or LF, and a UTF-8 BOM.
     * Entirely blank rows are dropped, exactly as the server drops them, so the
     * first row here is the header the server will read.
     */
    fun parseRows(text: String): List<List<String>> {
        val input = if (text.startsWith("﻿")) text.substring(1) else text
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val field = StringBuilder()
        var inQuotes = false
        var i = 0

        fun endField() {
            row.add(field.toString())
            field.setLength(0)
        }

        fun endRow() {
            endField()
            rows.add(row)
            row = mutableListOf()
        }

        while (i < input.length) {
            val char = input[i]
            if (inQuotes) {
                if (char == '"') {
                    if (input.getOrNull(i + 1) == '"') {
                        field.append('"')
                        i += 2
                    } else {
                        inQuotes = false
                        i += 1
                    }
                } else {
                    field.append(char)
                    i += 1
                }
                continue
            }
            when {
                char == '"' && field.isEmpty() -> {
                    inQuotes = true
                    i += 1
                }
                char == ',' -> {
                    endField()
                    i += 1
                }
                char == '\n' -> {
                    endRow()
                    i += 1
                }
                char == '\r' -> {
                    endRow()
                    i += if (input.getOrNull(i + 1) == '\n') 2 else 1
                }
                else -> {
                    field.append(char)
                    i += 1
                }
            }
        }
        if (field.isNotEmpty() || row.isNotEmpty()) endRow()

        return rows.filter { cells -> cells.any { it.trim() != "" } }
    }
}
