package com.loonext.android.core.contacts

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #248 ROUND 3 — the Kotlin port of the declaration contract, checked against
 * the TypeScript itself.
 *
 * Every rule in this repo that a phone needs exists three times, and nothing
 * about Kotlin tells you the TypeScript moved. The house answer is to read the
 * source of truth out of the repo rather than to pin the values a second time
 * here: a test asserting `ACTIONS == listOf("phone", …)` proves the copy has not
 * changed, never that it is right, and on the day the shared list gains a value
 * it becomes a ceiling holding the port at last month's answer.
 *
 * The behaviour tests below it are the other half. Parity proves the port says
 * the same words; those prove it does the same thing — which is where a
 * hand-port actually dies, because `RegExp.test` is a SEARCH and Kotlin's
 * `matches` is not.
 *
 * WHAT IS NOT TESTED HERE, DELIBERATELY: that the header patterns match the
 * right columns is a test of a GUESS. No assertion in this file may treat a
 * match as permission to import anything, because two rounds of this issue died
 * exactly there.
 */
class ImportColumnsTest {

    /** Walk UP to the repo root: Gradle's cwd is a property of the runner. */
    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found walking up from ${File("").absolutePath}")
    }

    private fun headersSource(): String =
        repoFile("packages/shared/src/contact-import-headers.ts")

    private fun contractSource(): String = repoFile("packages/shared/src/contact-import.ts")

    /** Drop `//` comment lines so a comment's punctuation is never read as code. */
    private fun withoutComments(block: String): String = block
        .lines()
        .filterNot { it.trim().startsWith("//") }
        .joinToString("\n")

    /** `export const NAME = "literal";` */
    private fun stringConst(source: String, name: String): String =
        Regex("""const $name\s*=\s*\n?\s*"([^"]*)"""").find(source)?.groupValues?.get(1)
            ?: throw AssertionError("$name is not a string constant in the shared module")

    /**
     * `const NAME = new Set<string>([A, "b"]);` → {resolved A, "b"}.
     *
     * Bare identifiers are resolved through [stringConst] rather than skipped:
     * `COLUMN_ACTIONS` lists `CONTACT_IMPORT_IGNORE` by reference, and a reader
     * that only saw quoted strings would silently compare seven values to eight
     * and pass while the one that matters went missing.
     */
    private fun stringSet(source: String, name: String): Set<String> {
        val body = Regex("""const $name = new Set<string>\(\[([^\]]*)\]\)""").find(source)
            ?.groupValues?.get(1)
            ?: throw AssertionError("$name is not a Set literal in the shared module")
        return withoutComments(body)
            .split(",")
            .map { it.trim() }
            .filter { it != "" }
            .map { entry ->
                if (entry.startsWith("\"")) entry.trim('"') else stringConst(source, entry)
            }
            .toSet()
    }

    /**
     * The shared `FIELD_PATTERNS` table, read back as (field, regex sources).
     *
     * Order is extracted along with the values because order IS the rule here:
     * `opted_out` is claimed before `phone` so a "do not text" column is never
     * eaten by phone's broad `number` pattern, and the split-name fields before
     * `name` so "First Name" is not read as the whole name.
     */
    private fun sharedFieldPatterns(): List<Pair<String, List<String>>> {
        val block = withoutComments(
            headersSource().substringAfter("const FIELD_PATTERNS").substringBefore("\n];"),
        )
        val groups = mutableListOf<Pair<String, MutableList<String>>>()
        // A field name, or one regex literal. No shared pattern contains a
        // slash, so "between two slashes, no slash" identifies them exactly.
        Regex("""\"([a-z_]+)\"|/([^/\n]+)/""").findAll(block).forEach { match ->
            val field = match.groupValues[1]
            if (field.isNotEmpty()) {
                groups += field to mutableListOf()
            } else {
                groups.lastOrNull()?.second?.add(match.groupValues[2])
                    ?: throw AssertionError("a regex literal appeared before any field name")
            }
        }
        return groups.map { (field, patterns) -> field to patterns.toList() }
    }

    // ------------------------------------------------------------- parity

    @Test
    fun `every answer a column may carry matches the shared module`() {
        // The server validates the action against its own set, so a token this
        // app offers and the server does not know is a control that produces a
        // 422 whichever way it is answered.
        assertEquals(stringSet(contractSource(), "COLUMN_ACTIONS"), ImportColumns.ACTIONS.toSet())
        assertEquals(
            stringConst(contractSource(), "CONTACT_IMPORT_IGNORE"),
            ImportColumns.ACTION_IGNORE,
        )
        // A list, not a set, on this side: the ORDER is a UI decision with a
        // reason. `ignore` is offered last and `opted_out` immediately above it,
        // so somebody reaching for "this says nothing" passes their eye over "do
        // not text" on the way — the two answers are one tap apart and one of
        // them texts everybody the column was protecting.
        assertEquals(ImportColumns.ACTION_IGNORE, ImportColumns.ACTIONS.last())
        assertEquals(
            ImportColumns.FIELD_OPTED_OUT,
            ImportColumns.ACTIONS[ImportColumns.ACTIONS.size - 2],
        )
        assertEquals(
            "no answer may be offered twice",
            ImportColumns.ACTIONS.size,
            ImportColumns.ACTIONS.toSet().size,
        )
    }

    @Test
    fun `the wire form is the one the server parses, index first`() {
        // Built by SUBSTITUTING into the shared template rather than by retyping
        // its shape here, so a reordering to `<header>:<action>:<index>` fails
        // this instead of quietly making every declaration unreadable.
        val template = Regex("""return `([^`]+)`;""")
            .find(contractSource().substringAfter("export function formatContactImportColumn"))
            ?.groupValues?.get(1)
            ?: throw AssertionError("formatContactImportColumn does not return a template")
        val expected = template
            .replace("\${declaration.index}", "7")
            .replace("\${declaration.action}", ImportColumns.ACTION_IGNORE)
            .replace("\${declaration.header}", "Do: Not Call")
        assertEquals(
            expected,
            ImportColumns.format(
                ImportColumns.Declaration(7, ImportColumns.ACTION_IGNORE, "Do: Not Call"),
            ),
        )
        // And nothing was left unsubstituted — a template that gained a fourth
        // part would otherwise compare two strings that both contain `${`.
        assertFalse(expected, expected.contains("\${"))
    }

    @Test
    fun `the header patterns match the shared module, in order`() {
        // The DEFAULT GUESS, and only that. A phone guessing differently from the
        // server would pre-fill a column with a field the server did not expect
        // to see there, and the person would be confirming a mapping that is not
        // the one the file gets.
        assertEquals(sharedFieldPatterns(), ImportColumns.FIELD_PATTERNS)
    }

    @Test
    fun `the name catch-all matches the shared module`() {
        val literal = Regex("""const NAME_LAST_RESORT = /([^/\n]+)/;""").find(headersSource())
            ?.groupValues?.get(1)
            ?: throw AssertionError("NAME_LAST_RESORT is not a regex literal")
        assertEquals(literal, ImportColumns.NAME_LAST_RESORT)
    }

    @Test
    fun `the shape classifier and its thresholds are gone from both sides`() {
        // #248 round 3 deleted it rather than tuning it. A threshold that can be
        // tuned is a threshold the next export is outside of, and three verifiers
        // got messages delivered by standing just outside these three.
        val ours = repoFile(
            "apps/android/app/src/main/kotlin/com/loonext/android/core/contacts/ImportColumns.kt",
        )
        for (dead in listOf("FLAG_MAX_DISTINCT", "FLAG_MAX_LENGTH", "FLAG_MIN_REPEAT")) {
            assertFalse(
                "$dead survives in the shared module",
                headersSource().contains("const $dead"),
            )
            // Named in this file's docblock as history; never as code.
            assertFalse("$dead survives on the phone", ours.contains("val $dead"))
        }
        assertFalse(
            "unmappedFlagColumns survives on the phone",
            ours.contains("fun unmappedFlagColumns"),
        )
    }

    // -------------------------------------------------- detection behaviour

    @Test
    fun `a header pattern searches the header, it does not have to be the whole of it`() {
        // THE hand-port trap in one assertion. These patterns are written for
        // JavaScript's `RegExp.test`, which searches; Kotlin's `Regex.matches`
        // anchors to the entire string. `/phone/` against "phonenumber" is the
        // difference between pre-filling a third-party export and pre-filling
        // nothing, and the wrong choice compiles, type-checks and says nothing.
        assertEquals(0, ImportColumns.detectColumns(listOf("Phone Number"))["phone"])
        assertEquals(0, ImportColumns.detectColumns(listOf("Mobile Number"))["phone"])
        assertEquals(0, ImportColumns.detectColumns(listOf("Site Address"))["address"])
    }

    @Test
    fun `the opt-out column is guessed before phone can eat it`() {
        // Field ORDER is a rule, not a coincidence: "Do Not Call Number" matches
        // the opt-out list AND phone's broad `/number/`. Guessing phone first
        // would pre-fill the do-not-call column as the phone column, and a person
        // confirming a screen full of plausible answers would ship it.
        val mapping = ImportColumns.detectColumns(listOf("Do Not Call Number", "Mobile"))
        assertEquals(0, mapping[ImportColumns.FIELD_OPTED_OUT])
        assertEquals(1, mapping[ImportColumns.FIELD_PHONE])
    }

    @Test
    fun `a company name column does not become the customer's name`() {
        // The `/name/` catch-all is held back whenever the file carries split
        // names, or a crew ends up with a book of company names.
        val mapping =
            ImportColumns.detectColumns(listOf("First Name", "Last Name", "Company Name", "Phone"))
        assertEquals(0, mapping["first_name"])
        assertEquals(1, mapping["last_name"])
        assertNull(mapping["name"])
        // And it IS used when there is nothing else, which is why it exists.
        assertEquals(0, ImportColumns.detectColumns(listOf("Customer Name", "Phone"))["name"])
    }

    // ------------------------------------------------- the column count

    @Test
    fun `a cell past the end of the header row is a column`() {
        // THE round-3 defect, in one fixture. Every loop in round two was bounded
        // by `headers.size`, so this third cell was not misread — it was never
        // looked at by any rule at all, and the file imported attested with a
        // message delivered. Hand-edited files do this constantly: somebody adds
        // a note to one row and does not touch the header.
        //
        // A MIX: the first row is short, the second is exactly the header's
        // width, the third overruns it. Only the widest may decide the count.
        val plan = ImportColumns.plan(
            (
                "Phone,Name\n" +
                    "+14165550100\n" +
                    "+14165550101,Bob\n" +
                    "+14165550102,Ann,DO NOT CALL\n"
                ).toByteArray(),
        )!!
        assertEquals(3, plan.columns.size)
        val past = plan.columns[2]
        assertEquals("", past.header)
        assertNull("a nameless column cannot be recognised, so it must be asked", past.guess)
        assertEquals(
            "the person has to SEE what is in it, or the question is unanswerable",
            listOf("DO NOT CALL"),
            past.samples,
        )
    }

    @Test
    fun `an empty column is counted like any other`() {
        // The temptation is real — a stray trailing comma adds a column nobody
        // meant, with nothing in it — but "a column with nothing in it decides
        // nothing" is a rule about which columns may be skipped, and a rule about
        // which columns may be skipped is exactly what two rounds lost to.
        val plan = ImportColumns.plan("Phone,Name,,\n+14165550100,Ann,,\n".toByteArray())!!
        assertEquals(4, plan.columns.size)
        assertEquals(2, plan.columns.count { it.samples.isEmpty() })
        for (index in listOf(2, 3)) {
            assertNull("column $index must still be asked about", plan.columns[index].guess)
        }
    }

    @Test
    fun `two columns with no ASCII name are still two questions`() {
        // Round two matched its field on the normalised header, which strips
        // everything but [a-z0-9] — so "", "—", "#" and "★" all collapsed to the
        // SAME EMPTY STRING and two of them could not be told apart. The
        // declaration is by INDEX, and a position cannot collide with a position.
        assertEquals(
            ImportColumns.normalizeHeader("—"),
            ImportColumns.normalizeHeader("★"),
        )
        val declarations = ImportColumns
            .plan("Phone,—,★\n+14165550100,y,DO NOT CALL\n".toByteArray())!!
            .columns
            .map { ImportColumns.format(ImportColumns.Declaration(it.index, "ignore", it.header)) }
        assertEquals(
            "three columns, three distinct declarations",
            3,
            declarations.toSet().size,
        )
        assertEquals(listOf("1:ignore:—", "2:ignore:★"), declarations.drop(1))
    }

    // ------------------------------------------------------------- samples

    @Test
    fun `the samples are distinct, in file order, and skip blanks`() {
        // A MIX: a repeat, a blank, a case-variant of an earlier value, and a new
        // one — four rows taking four different branches of the same loop.
        val rows = listOf(
            listOf("a", "Subscribed"),
            listOf("b", ""),
            listOf("c", "UNSUBSCRIBED"),
            listOf("d", "  Unsubscribed  "),
            listOf("e", "Pending"),
        )
        assertEquals(
            listOf("Subscribed", "UNSUBSCRIBED", "Pending"),
            ImportColumns.samples(rows, 1),
        )
        // Case folds for DISTINCTNESS but the file's own spelling is what shows —
        // they have to recognise it in their spreadsheet.
        assertFalse(ImportColumns.samples(rows, 1).contains("Unsubscribed"))
    }

    @Test
    fun `the sample stops at the limit and says so in the copy`() {
        val rows = (1..20).map { listOf("v$it") }
        assertEquals(ImportColumns.SAMPLE_LIMIT, ImportColumns.samples(rows, 0).size)
        // The line must not claim to have listed the column. "Holds:" over five
        // of forty values is a claim nobody checked.
        val line = ContactImport.Columns.valuesLine(ImportColumns.samples(rows, 0))
        assertTrue(line, line.startsWith("Values include:"))
    }

    // -------------------------------------------------------- the guess

    @Test
    fun `the guess fills what it recognised and leaves the rest unanswered`() {
        // THE mechanism. A guess is a FIELD or nothing: `ignore` is an ANSWER —
        // "I looked at these values and they decide nothing" — and a detector has
        // not looked at a value. The shared module used to fill unrecognised
        // columns with `ignore` and every client posted the result without asking
        // anybody, which is how `Phone,Name,Notes` shipped a message to somebody
        // whose Notes column said DO NOT CALL. Neither side does it now.
        //
        // A MIX: one column the detector claims, one it does not, one whose
        // header is a decision it happens to recognise, one that is empty.
        val plan = ImportColumns.plan(
            (
                "Phone,Marketing Status,Do Not Call,Spare\n" +
                    "+14165550100,Subscribed,n,\n" +
                    "+14165550101,Unsubscribed,y,\n"
                ).toByteArray(),
        )!!
        assertEquals(ImportColumns.FIELD_PHONE, plan.columns[0].guess)
        assertNull(
            "\"Marketing Status\" is in no vocabulary, and no vocabulary will ever " +
                "have it — so it is asked, not assumed",
            plan.columns[1].guess,
        )
        assertEquals(ImportColumns.FIELD_OPTED_OUT, plan.columns[2].guess)
        assertNull(plan.columns[3].guess)
        assertEquals(listOf("Subscribed", "Unsubscribed"), plan.columns[1].samples)
    }

    @Test
    fun `the guess is never permission`() {
        // A file whose every column the detector recognises still produces one
        // declaration per column, and every one of them still has to be posted.
        // Nothing in this port may return "no declaration needed".
        val plan = ImportColumns.plan("phone,name,address\n+14165550100,Ann,1 Elm\n".toByteArray())!!
        assertEquals(3, plan.columns.size)
        assertTrue("the whole file is recognised", plan.columns.all { it.guess != null })
    }

    // ------------------------------------------------ the sheet's own list

    @Test
    fun `the file that shipped a message is entirely on screen`() {
        // THE SHIP BLOCKER, as a fixture. `Phone,Name,Notes` with a Notes column
        // reading "DO NOT CALL - asked us to stop": the detector answers all
        // three, so the sheet opens complete and Import is one tap away with no
        // interaction at all. That tap is defensible ONLY because those words are
        // on the screen under the finger — so this asserts they are there.
        //
        // The web wizard rendered its unanswered columns and nothing else. For
        // this file that is an empty screen and `2:notes:Notes` posted by a
        // machine, which is what was proved live.
        val plan = ImportColumns.plan(
            (
                "Phone,Name,Notes\n" +
                    "+14165550100,Ann,DO NOT CALL - asked us to stop\n" +
                    "+14165550101,Bob,gate code 4821\n"
                ).toByteArray(),
        )!!
        assertTrue("the detector answers this file end to end", plan.columns.all { it.guess != null })

        val rows = ImportColumns.sheetRows(plan.columns)
        assertEquals(
            "every column of the file reaches the sheet, recognised or not",
            plan.columns,
            rows.map { it.column },
        )
        val notes = rows.single { it.column.header == "Notes" }
        assertEquals(
            "the words that make the tap defensible have to be ON the card",
            listOf("DO NOT CALL - asked us to stop", "gate code 4821"),
            notes.column.samples,
        )
        assertTrue(
            "and the card says them",
            ContactImport.Columns.valuesLine(notes.column.samples).contains("DO NOT CALL"),
        )
        // One group, so no heading: "Recognised" over the only list on the screen
        // says nothing the list does not.
        assertTrue(rows.all { it.heading == null })
    }

    @Test
    fun `the sheet draws the whole file, unanswered first`() {
        // A MIX, because this is the loop that decides what is seen: one column
        // the detector claims, one it will never claim, one it claims as the
        // opt-out, one that is empty, and one that ran past the end of the header
        // row. Five columns, both groups, four different branches of the split.
        val plan = ImportColumns.plan(
            (
                "Phone,Marketing Status,Do Not Call,Spare\n" +
                    "+14165550100,Subscribed,n,\n" +
                    "+14165550101,Unsubscribed,y,,DO NOT CALL\n"
                ).toByteArray(),
        )!!
        assertEquals(5, plan.columns.size)

        val rows = ImportColumns.sheetRows(plan.columns)
        assertEquals(
            "no column may be dropped on the way to the screen",
            plan.columns.toSet(),
            rows.map { it.column }.toSet(),
        )
        assertEquals("and none drawn twice", plan.columns.size, rows.size)
        // Unanswered first — that is where the work is. Recognised after, and
        // every bit as much on the screen.
        val guesses = rows.map { it.column.guess }
        assertEquals(
            "the unrecognised columns must come first, as a block",
            guesses.count { it == null },
            guesses.takeWhile { it == null }.size,
        )
        // Headings mark the two groups, once each, from the shipped copy.
        assertEquals(
            listOf(ContactImport.Columns.NEEDS_ANSWER, ContactImport.Columns.RECOGNISED),
            rows.mapNotNull { it.heading },
        )
        assertEquals(ContactImport.Columns.NEEDS_ANSWER, rows.first().heading)
        assertEquals(
            "a heading starts a group, so it lands on the first column that has a guess",
            ContactImport.Columns.RECOGNISED,
            rows.first { it.column.guess != null }.heading,
        )
    }

    @Test
    fun `a file nobody recognised gets no heading either`() {
        // The other single-group file. Both ends of this rule are asserted
        // because the honest version of it is "label a group only when there is
        // another group to tell it apart from".
        val rows = ImportColumns.sheetRows(
            ImportColumns.plan("Spare,Marketing Status\nx,Subscribed\ny,Unsubscribed\n".toByteArray())!!
                .columns,
        )
        assertEquals(2, rows.size)
        assertTrue("nothing was recognised, so there is one list", rows.all { it.heading == null })
    }

    // ------------------------------------------------- format and parse

    @Test
    fun `a declaration survives a header carrying the separator itself`() {
        // The header goes LAST for exactly this reason: it may contain anything,
        // colons and commas included, and the two splits before it are on fixed
        // tokens. A format that split the header out first would read this file's
        // third column as a malformed field and drop the answer.
        val declaration = ImportColumns.Declaration(2, "notes", "Site: Notes, misc")
        val wire = ImportColumns.format(declaration)
        assertEquals("2:notes:Site: Notes, misc", wire)
        assertEquals(declaration, ImportColumns.parse(wire))
    }

    @Test
    fun `a malformed declaration is not read as a confident answer about column zero`() {
        // The server parses the index with `/^\d+$/` because `Number("")` is 0 and
        // `Number(" 1 ")` is 1 — a lenient parse turns a broken field into a
        // statement about the first column of the file, which is usually the
        // phone number.
        assertNull(ImportColumns.parse(":ignore:x"))
        assertNull(ImportColumns.parse(" 1:ignore:x"))
        assertNull(ImportColumns.parse("+1:ignore:x"))
        assertNull(ImportColumns.parse("1"))
        assertNull(ImportColumns.parse("1:ignore"))
        assertNull("an action nobody knows is not an answer", ImportColumns.parse("1:maybe:x"))
        // And a legitimate one still reads, including the empty header.
        assertEquals(ImportColumns.Declaration(1, "ignore", ""), ImportColumns.parse("1:ignore:"))
    }

    // ---------------------------------------------------------- the plan

    @Test
    fun `a file with no data row has no per-column question`() {
        // Refused by the server for its own reason, before it looks at a single
        // column. Deciding that here would be this app inventing a refusal, which
        // is the one thing a client must not do with a gate the server owns — so
        // it returns null and the caller uploads it undeclared.
        assertNull(ImportColumns.plan("Phone,Status".toByteArray()))
        assertNull(ImportColumns.plan("".toByteArray()))
        assertNull(ImportColumns.plan("\n\n".toByteArray()))
        assertNotNull(ImportColumns.plan("Phone\n+14165550100\n".toByteArray()))
    }

    @Test
    fun `the plan counts the rows the server will count`() {
        // The screen decides whether to ask about columns at all from this
        // number, and the server refuses an over-cap file before it looks at one
        // — so a count that disagreed would collect a dozen answers and throw
        // them away. Blank rows are dropped on both sides.
        val plan = ImportColumns.plan("Phone\n+14165550100\n\n+14165550101\n".toByteArray())!!
        assertEquals(2, plan.rowCount)
    }

    @Test
    fun `a file over the row cap is still planned, because the cap is not this file's job`() {
        // Built from the shipped cap, never a typed 2000.
        val body = buildString {
            append("Phone,Marketing Status\n")
            for (i in 1..ContactImport.MAX_ROWS + 1) {
                append("+1416555").append(String.format("%04d", i % 10000)).append(',')
                append(if (i % 2 == 0) "Subscribed" else "Unsubscribed").append('\n')
            }
        }
        val plan = ImportColumns.plan(body.toByteArray())!!
        assertEquals(ContactImport.MAX_ROWS + 1, plan.rowCount)
        assertTrue("the caller compares this against the cap", plan.rowCount > ContactImport.MAX_ROWS)
    }

    // ------------------------------------------------- the export round trip

    @Test
    fun `a book this product exported comes back through a door somebody can use`() {
        // D20 §3.1: Export CSV then Import CSV is the crew's ordinary next move,
        // and round two broke it — the server refused our own header, naming
        // `tags` and `consent_source`. Under round 3's design our own header has
        // to be fully accounted for, and this reads the SHIPPED header out of the
        // route rather than a copy of it retyped here.
        val header = Regex("""export const EXPORT_HEADER = \[([^\]]*)\]""")
            .find(repoFile("apps/api/src/routes/contacts.ts"))
            ?.groupValues?.get(1)
            ?: throw AssertionError("EXPORT_HEADER is not a list literal in the contacts route")
        val columns = Regex("\"([^\"]*)\"").findAll(header).map { it.groupValues[1] }.toList()
        assertTrue("EXPORT_HEADER looks empty", columns.size >= 5)

        val plan = ImportColumns.plan(
            (
                columns.joinToString(",") + "\n" +
                    "Ann,+14165550100,roof,inbound_sms,2026-01-02T10:00:00Z,2026-01-01T10:00:00Z\n" +
                    "Bob,+14165550101,,attested,2026-02-02T10:00:00Z,2026-02-01T10:00:00Z\n"
                ).toByteArray(),
        )!!
        assertEquals(columns.size, plan.columns.size)
        assertEquals(columns, plan.columns.map { it.header })
        // Every column reaches the sheet with a real identity, so every one of
        // them can be answered. The two the importer reads are pre-filled; the
        // bookkeeping ones are asked about, which is the correct question — they
        // ARE ignorable, and somebody says so.
        assertEquals(ImportColumns.FIELD_PHONE, plan.columns[columns.indexOf("phone")].guess)
        assertEquals("name", plan.columns[columns.indexOf("name")].guess)
        for (column in plan.columns) {
            assertTrue(
                "column ${column.index} has no identity to declare",
                ImportColumns.parse(
                    ImportColumns.format(
                        ImportColumns.Declaration(column.index, "ignore", column.header),
                    ),
                ) != null,
            )
        }
    }

    // ---------------------------------------------------------- CSV parsing

    @Test
    fun `the parser keeps quoted commas in one cell`() {
        // A misparsed row shifts every column after it, and a "Do Not Call"
        // column read one place to the left is a column of phone numbers.
        val rows = ImportColumns.parseRows("phone,address\n+1416,\"144 Bloor St W, Toronto\"\n")
        assertEquals(listOf("phone", "address"), rows[0])
        assertEquals(listOf("+1416", "144 Bloor St W, Toronto"), rows[1])
    }

    @Test
    fun `the parser handles doubled quotes, CRLF and a BOM`() {
        val rows = ImportColumns.parseRows("﻿name\r\n\"Bob \"\"Big\"\" Smith\"\r\n")
        assertEquals(listOf("name"), rows[0])
        assertEquals(listOf("Bob \"Big\" Smith"), rows[1])
    }

    @Test
    fun `the parser drops blank rows, exactly as the server does`() {
        // The server drops them before taking rows[0] as the header, so a file
        // starting with a blank line has its header on line 2 there and would
        // have it on line 1 here — every column index off by a file.
        val rows = ImportColumns.parseRows("\n\nphone,status\n\n+1416,y\n\n")
        assertEquals(2, rows.size)
        assertEquals(listOf("phone", "status"), rows[0])
        assertEquals(listOf("+1416", "y"), rows[1])
    }

    @Test
    fun `a plan survives a file whose columns are quoted`() {
        val plan = ImportColumns.plan(
            (
                "\"Phone\",\"Marketing Status\"\n" +
                    "\"+14165550100\",\"Subscribed\"\n" +
                    "\"+14165550101\",\"Unsubscribed\"\n"
                ).toByteArray(),
        )!!
        assertEquals(listOf("Phone", "Marketing Status"), plan.columns.map { it.header })
        assertFalse(
            "the header must not carry its quotes into the declaration",
            plan.columns.any { it.header.contains('"') },
        )
    }
}
