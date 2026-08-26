package com.loonext.android.features.contacts

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * #248 — the shape of the import flow, lint-checked in the `ImeContractLintTest`
 * idiom, because Compose UI is not unit-testable in this module.
 *
 * The wire tests prove the app CAN post an attestation and a declaration. These
 * prove it can only do so because somebody answered: one call opens the file
 * picker and the consent sheet gates it; a picked file becomes a QUESTION rather
 * than an upload; and neither declaration sheet will hand anything to the wire
 * while one column or one property is still unanswered.
 *
 * Guards the compiler cannot express, so they are written down as lints. The
 * failure they exist to prevent is not a crash — it is an import that quietly
 * answers on behalf of somebody who never saw the column.
 *
 * READ EACH ASSERTION AGAINST ONE COMPOSABLE, not the whole file (see
 * [composable]). The two declaration sheets are deliberately alike, and a
 * `contains` over the file was satisfied by the wrong one of them — proved by a
 * mutation that disabled the column sheet's gate while this class stayed green.
 */
class ImportConsentGateTest {

    private val source: String by lazy { readMainSource("features/contacts/ContactsTab.kt") }

    /**
     * The screen's CODE, with its comment lines removed.
     *
     * Every assertion here reads this rather than the raw file, because a lint a
     * COMMENT can satisfy is a lint that goes on passing over deleted code — and
     * this class exists precisely because the Compose it guards cannot be run.
     *
     * Proved by its own first run: `attested = true` appears in a docblock, and
     * counting the raw file found three places the consent claim is made where
     * the code makes it in two.
     */
    private val tab: String by lazy {
        source
            .lines()
            .filterNot { line ->
                val trimmed = line.trimStart()
                trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")
            }
            .joinToString("\n")
    }

    @Test
    fun `there is exactly one door to the file picker, and it is behind the sheet`() {
        val launches = Regex("""importLauncher\.launch\(""").findAll(tab).count()
        assertEquals(
            "ContactsTab must open the import picker from ONE place (pickFileFor). " +
                "A second launch site is a path from a menu tap to somebody else's " +
                "phone numbers that never asks the consent question (#248).",
            1,
            launches,
        )
        val gate = tab.indexOf("fun pickFileFor(")
        assertTrue("pickFileFor is gone — the single picker door", gate >= 0)
        assertTrue(
            "the picker launch must live inside pickFileFor",
            tab.indexOf("importLauncher.launch(") > gate,
        )
    }

    @Test
    fun `the attestation sheet is mounted and is what unlocks the picker`() {
        assertTrue(
            "ImportConsentSheet must be mounted, not merely defined",
            Regex("""ImportConsentSheet\(""").findAll(tab).count() >= 2,
        )
        // EVERY footer, not merely the first one found. The list renders one
        // ListFooter under a populated list and another under the empty state,
        // so a bypass wired into either is a bypass — and checking for the
        // string "is wired correctly somewhere" cannot see the other one.
        val handlers = Regex("""onImport = """).findAll(tab).count()
        val gated = Regex("""onImport = \{ attestingImport = it \}""").findAll(tab).count()
        assertTrue("no ListFooter is wired for import at all", handlers >= 1)
        assertEquals(
            "every import affordance must hand its KIND to the attestation " +
                "sheet — a footer that opens the picker itself makes the sheet " +
                "decoration (#248)",
            handlers,
            gated,
        )
        // And the picker opens from exactly ONE place: the sheet's confirm.
        val callSites = Regex("""(?<!fun )pickFileFor\(""").findAll(tab).count()
        assertEquals("pickFileFor must be called once, by the sheet", 1, callSites)
        assertTrue(
            "the sheet's confirm must be the thing that opens the picker",
            tab.contains("pickFileFor(kind)"),
        )
    }

    @Test
    fun `the consent box starts unticked and gates the confirm button`() {
        // A pre-ticked consent box is not an attestation. This is the one
        // control in the app where a smart default would be a claim made on
        // behalf of somebody who is not in the room.
        assertTrue(
            "the attestation checkbox must start unticked",
            tab.contains("var attested by remember(kind) { mutableStateOf(false) }"),
        )
        assertTrue(
            "Continue must be disabled until the box is ticked",
            tab.contains("Button(enabled = attested, onClick = onAttested)"),
        )
    }

    @Test
    fun `the report sheet says which rows the attestation could not cover`() {
        // #248: the server refuses the attestation over a standing STOP and
        // reports what it refused. A workspace that never sees that is back to
        // a silent refusal — which is the same defect as manufacturing the
        // consent, discovered a year later by somebody reading the audit row.
        // #228: the sentence takes the reader's language as a trailing argument
        // and the call now wraps, so the needle is a regex that stops at the
        // FIGURE — which is the half this assertion has always been about.
        assertTrue(
            "the refused COUNT must be shown, derived from the server's number",
            Regex("""ContactImport\.consentRefusedHeadline\(\s*result\.consent_refused""")
                .containsMatchIn(tab),
        )
        assertTrue(
            "the localized compliance sentence must reach the screen — it is " +
                "the only place the consequence is spelled out",
            tab.contains("contactsTasks.importConsentRefusedNote"),
        )
        assertTrue(
            "and WHICH rows: 'how many' without 'which of them' is a number " +
                "nobody can act on",
            tab.contains("result.consent_refusals"),
        )
    }

    @Test
    fun `refused rows are never reported as skipped`() {
        // These rows were IMPORTED. The server named the field separately for
        // exactly this reason, and either of the two easy mistakes here tells
        // the workspace those people never arrived.
        // #228: the screen reaches both of these sentences through catalogue
        // KEYS now, so the keys are the needles. Nothing about what this guard
        // watches has moved — the key appears exactly once, in the block it
        // names — only the spelling of the sentence has.
        val counts = tab
            .substringAfter(""""contactsTasks.importFinished"""")
            .substringBefore("""joinToString(" · ")""")
        assertFalse(
            "the refusal count must stay OUT of the imported/updated/skipped " +
                "line — those rows are already inside `imported` (#248)",
            counts.contains("consent_refused"),
        )
        val refusalAt = tab.indexOf("result.consent_refusals")
        val skippedAt = tab.indexOf(""""contactsTasks.importSkippedRows"""")
        assertTrue("the refusal block is gone", refusalAt > 0)
        assertTrue("the skipped list is gone", skippedAt > 0)
        assertTrue(
            "the refusal must read BEFORE the skipped list: a skipped row is " +
                "fixed by editing the file, a refusal is a standing carrier " +
                "fact about somebody now in the contact list",
            refusalAt < skippedAt,
        )
    }

    @Test
    fun `both row lists label rows the way their door labels them`() {
        // A .vcf reports CARD numbers. A refusal list that said "Row 12" over a
        // vCard import would point at a line that does not exist in the file —
        // and the vCard door is the one that produces the most refusals, because
        // a phone book cannot declare an opt-out at all.
        val lists = Regex("""ImportRowList\(\s*\r?\n?\s*rows = """).findAll(tab).count()
        val labelled = Regex("""rowWord = report\.kind\.rowWord""").findAll(tab).count()
        assertTrue("no per-row reason list is rendered at all", lists >= 2)
        assertEquals(
            "every row list must take its label from the KIND, never a " +
                "hardcoded word",
            lists,
            labelled,
        )
    }

    // ------------------------------------- #248 round 3: the declaration step

    @Test
    fun `there is one upload door, and one place the attestation is claimed`() {
        // Three ways now reach the import routes: a declared CSV, a declared
        // .vcf, and a file this app could not read going up undeclared. All of
        // them go through `upload`, and `attested = true` lives only inside it —
        // a second call site anywhere else is a second way to make somebody
        // else's consent claim, which is the whole of #226 and #248.
        val upload = tab.indexOf("suspend fun upload(")
        val afterUpload = tab.indexOf("val importLauncher", upload)
        assertTrue("the single upload door is gone", upload > 0)
        for (call in listOf("mutations.importCsv(", "mutations.importVcard(")) {
            val sites = Regex(Regex.escape(call)).findAll(tab).map { it.range.first }.toList()
            assertEquals("$call must be called from exactly one place", 1, sites.size)
            assertTrue(
                "$call must live inside upload()",
                sites.single() in (upload + 1) until afterUpload,
            )
        }
        val claims = Regex("""attested = true""").findAll(tab).map { it.range.first }.toList()
        assertEquals("one claim per door, and only inside upload()", 2, claims.size)
        assertTrue(claims.all { it in (upload + 1) until afterUpload })
    }

    @Test
    fun `a picked file becomes a question, not an upload`() {
        // THE round-3 change on this screen. Round two uploaded first and asked
        // afterwards, only about the columns a shape test had decided were
        // suspicious — and the shape test had an outside, which three verifiers
        // stood in while messages went out to people who had said stop.
        //
        // The picker's callback must hand a CSV to the column sheet. It may hand
        // it straight to `upload` only in the two cases where there is no
        // question to ask, and both of those end in a refusal the server writes.
        val picked = tab.substringAfter("val importLauncher").substringBefore("fun pickFileFor(")
        assertTrue(
            "a picked CSV must reach the per-column step",
            picked.contains("columnStep = ColumnStep("),
        )
        assertTrue(
            "and a picked .vcf must reach the property step",
            picked.contains("propertyStep = PropertyStep("),
        )
        assertTrue(
            "the columns must be read from the FILE, before anything is posted",
            picked.contains("ImportColumns.plan(bytes)"),
        )
        assertTrue(
            "and the vCard's properties likewise",
            picked.contains("VCardProperties.undeclared(bytes)"),
        )
        // Every upload straight from the picker must be an EMPTY declaration —
        // this app declaring something on a person's behalf is the one thing the
        // mechanism forbids, and `emptyList()` is refused by the server for any
        // file that has columns.
        // The whole tail of the line, not a bracket-bounded slice: `emptyList()`
        // contains a `)`, so a lazier capture stops inside the argument and would
        // read `upload(kind, name, bytes, everythingIgnored())` as a pass.
        val uploads = Regex("""upload\(kind, name, bytes, ([^\n]*)""").findAll(picked).toList()
        assertTrue("the picker no longer uploads at all", uploads.isNotEmpty())
        for (call in uploads) {
            assertEquals(
                "an upload straight from the picker must declare NOTHING (#248)",
                "emptyList())",
                call.groupValues[1].trim(),
            )
        }
    }

    @Test
    fun `the row cap is checked before the columns are`() {
        // The server refuses an over-cap file on its row count before it looks at
        // a single column, so asking about twelve columns first would collect
        // twelve answers and throw them away. A courtesy, never a gate: both
        // branches of this end at the server, and one of them cannot import.
        val picked = tab.substringAfter("val importLauncher").substringBefore("fun pickFileFor(")
        val cap = picked.indexOf("plan.rowCount > ContactImport.MAX_ROWS")
        val ask = picked.indexOf("columnStep = ColumnStep(")
        assertTrue("the row cap is not compared at all", cap > 0)
        assertTrue("the cap must be read before the sheet is opened", cap < ask)
        // Against the SHIPPED constant, never a literal — a phone enforcing a
        // different number from the server is the class #248 opened with.
        assertFalse(
            "the cap must not be typed into this screen",
            Regex("""rowCount > \d""").containsMatchIn(picked),
        )
    }

    /**
     * The body of ONE composable, so a guard cannot be satisfied by its neighbour.
     *
     * Written because it was: the two declaration sheets carry the same
     * `enabled = complete,` line, and a `tab.contains` of it passed happily while
     * the column sheet's own gate was replaced with `enabled = true`. A mutation
     * run is what turned that up, and it is the second time in this issue that a
     * guard has been satisfied by a copy of the thing it was watching.
     */
    private fun composable(name: String): String {
        val start = tab.indexOf("private fun $name(")
        assertTrue("$name is gone from this screen", start > 0)
        val next = tab.indexOf("\nprivate fun ", start + 1)
        return if (next == -1) tab.substring(start) else tab.substring(start, next)
    }

    @Test
    fun `every column is answered before the file can go up`() {
        // The sheet's confirm is gated on `complete`, and `complete` counts
        // answers against the file's own column count. Nothing may reach the wire
        // while a column is unanswered.
        val sheet = composable("ImportColumnsSheet")
        assertTrue(
            "the confirm must require every column, not merely some",
            sheet.contains("answered == columns.size"),
        )
        assertTrue(
            "the confirm button must be gated on that",
            sheet.contains("enabled = complete,"),
        )
        assertTrue(
            "the count must come from the file's columns",
            sheet.contains("columns.count { answers[it.index] != null }"),
        )
    }

    @Test
    fun `the vCard sheet explains a parameter when it lists one`() {
        // The server's enumeration widened to PARAMETERS, so `TEL;TYPE` is now on
        // this sheet for every phone export there is. It is not a word — somebody
        // meeting it cold cannot answer it, and the honest answer to a question
        // you do not understand is whichever one makes the sheet go away. Which,
        // here, is the one that texts everybody the label was protecting.
        val sheet = composable("ImportPropertiesSheet")
        assertTrue(
            "the `;` must be explained where it is read, not only in the refusal " +
                "that comes after",
            sheet.contains("ContactImport.Properties.PARAMETER_NOTE"),
        )
        assertTrue(
            "and only when one is actually in the list — a file carrying just " +
                "CATEGORIES needs no lesson about punctuation that is not on it",
            sheet.contains("step.properties.any { it.contains(';') }"),
        )
    }

    @Test
    fun `the vCard sheet is gated exactly as hard as the column sheet`() {
        // The door that had no gate at all is the one nobody thinks to guard, and
        // it survived a mutation for precisely that reason: `enabled = complete`
        // was asserted once, for the whole file, and the column sheet's copy of
        // the line answered for both.
        val sheet = composable("ImportPropertiesSheet")
        assertTrue(
            "every property the cards carry must be answered",
            sheet.contains("answers.size == step.properties.size"),
        )
        assertTrue("and the confirm gated on it", sheet.contains("enabled = complete,"))
    }

    @Test
    fun `an unanswered column is left out of the declaration, never ignored for them`() {
        // Defence behind the gate above, and the reason it is worth having: if
        // `complete` is ever wrong — which a mutation proved it can silently
        // become — an unanswered column must reach the server UNDECLARED, so the
        // file is refused. An `?: ignore` fallback would instead dismiss a column
        // nobody looked at, which is the whole defect of #248 rebuilt one layer
        // further in.
        for (sheet in listOf("ImportColumnsSheet", "ImportPropertiesSheet")) {
            val body = composable(sheet)
            assertTrue(
                "$sheet must drop unanswered entries rather than default them",
                body.contains("mapNotNull"),
            )
            assertFalse(
                "$sheet must not supply an answer on somebody's behalf",
                body.contains("?: ImportColumns.ACTION_IGNORE") ||
                    body.contains("?: VCardProperties.ACTION_IGNORE"),
            )
        }
    }

    @Test
    fun `nothing may answer a column except a person choosing one`() {
        // The round-2 defect rebuilt would look exactly like a second writer
        // here: a bulk "ignore the rest", or a retry that re-sends what the last
        // attempt said. There is ONE writer, and it takes one column's choice.
        val writes = Regex("""[^.\w]answers = """).findAll(tab).map { it.value }.toList()
        assertEquals(
            "exactly two writers — one per sheet — each setting ONE key from a " +
                "person's tap. A third is a select-all however it is labelled",
            2,
            writes.size,
        )
        assertTrue(
            "the column sheet's writer must set exactly one column, keyed by that " +
                "column's own index — never by its position in the sheet's order",
            tab.contains("answers = answers + (row.column.index to it)"),
        )
        assertTrue(
            "and the vCard sheet's exactly one property",
            tab.contains("answers = answers + (property to it)"),
        )
        // No bulk dismissal on this surface. The shared design allows one only
        // when every column and its values are on screen as it is pressed, and a
        // phone cannot put twelve columns and their values on one screen.
        for (bulk in listOf("ignoreAll", "selectAll", "answerAll", "ignoreRest")) {
            assertFalse("a bulk dismissal appeared: $bulk", tab.contains(bulk))
        }
    }

    @Test
    fun `the columns arrive pre-answered only where something was recognised`() {
        // A screen that arrives fully answered is a screen nobody reads, and
        // "nobody read it" is how a Do Not Call column was dropped in silence
        // twice. The detector's guesses are pre-filled — they are shown, beside
        // their values, and every one can be changed — and the rest are blank.
        assertTrue(
            "the sheet must seed from the plan's own guess",
            composable("ImportColumnsSheet")
                .contains("columns.associate { it.index to it.guess }"),
        )
        // The guess must not be laundered into an answer on the way in.
        assertFalse(
            "an unrecognised column must not arrive pre-ignored",
            tab.contains("it.guess ?: ImportColumns.ACTION_IGNORE"),
        )
    }

    @Test
    fun `every column of the file is drawn, from the one list that covers it`() {
        // THE SHIP BLOCKER, on this client. The web wizard rendered only the
        // columns nobody had answered, so a file the detector understood end to
        // end put NOTHING on the screen and posted `2:notes:Notes` for a column
        // reading "DO NOT CALL - asked us to stop".
        //
        // This screen drew both groups — until it did not. Deleting one of the
        // two `section(...)` calls reproduced that defect exactly and survived all
        // 1407 tests in this app, which is why the file's columns now reach the
        // cards through ONE function that a unit test can run over
        // (`ImportColumns.sheetRows`, proved in ImportColumnsTest) and through
        // ONE loop here.
        val sheet = composable("ImportColumnsSheet")
        assertEquals(
            "there must be exactly one place a column becomes a card — a second " +
                "one is a second thing that can be deleted",
            1,
            Regex("""ColumnDeclarationCard\(""").findAll(sheet).count(),
        )
        // THE WHOLE LOOP HEADER, closing brace included. A `contains` of just
        // `sheetRows(columns)` is satisfied by
        // `sheetRows(columns).filter { it.column.guess == null }`, which IS the
        // wizard's defect — the guard has to pin the end of the expression, not
        // its beginning.
        assertTrue(
            "the loop must run over the whole file and nothing narrower",
            sheet.contains("for (row in ImportColumns.sheetRows(columns)) {"),
        )
        // And the same at the other end: nothing may narrow `columns` before it
        // gets there either. `filter` is how the wizard's defect is spelled;
        // `take`/`drop` are how somebody shortening a long sheet would spell it.
        for (narrowing in listOf("filter", "take", "drop", "first", "distinctBy")) {
            assertFalse(
                "the sheet must not narrow the file's columns: columns.$narrowing",
                Regex("""columns\s*\.\s*$narrowing\s*[({]""").containsMatchIn(sheet),
            )
        }
    }

    @Test
    fun `the columns are read before the button that sends them`() {
        // Position is load-bearing and nothing else pins it. The sheet is one
        // scroll, so reaching Import on a wide file means the whole list has gone
        // past somebody's eyes; a confirm above the cards is a file sent by
        // somebody who never scrolled, and the single tap this screen allows for
        // a fully recognised file stops being defensible the moment that is true.
        val sheet = composable("ImportColumnsSheet")
        val cards = sheet.indexOf("ColumnDeclarationCard(")
        // #228: the sentence is assembled through the catalogue now — the
        // `{answer}` slot is filled from the control's own label — so the
        // identifier is `wrongColumn(`. Its POSITION is what this pins.
        val warning = sheet.indexOf("ContactImport.Columns.wrongColumn(")
        val confirm = sheet.indexOf("ContactImport.Columns.CONFIRM")
        assertTrue("the cards are gone from the sheet", cards > 0)
        assertTrue("the warning is gone from the sheet", warning > 0)
        assertTrue("the confirm is gone from the sheet", confirm > 0)
        assertTrue(
            "every column must be drawn before the sentence about getting it wrong",
            cards < warning,
        )
        assertTrue("and that sentence before the button", warning < confirm)
    }

    @Test
    fun `each column is shown with its values and its position`() {
        // The whole design rests on somebody SEEING "DO NOT CALL" before they
        // dismiss the column holding it. A sheet that showed only header names
        // would be asking the question without showing the answer.
        val card = composable("ColumnDeclarationCard")
        assertTrue(
            "a column's values must be on screen",
            card.contains("ContactImport.Columns.valuesLine(column.samples"),
        )
        // #228 note on the needles below: each of these builders takes the
        // reader's language as a trailing argument now, so the needles stop
        // before the closing bracket. What they pin is unchanged — which FACT
        // about the column reaches the card.
        // #528: and the ones it does not print must be COUNTED and REACHABLE.
        // "Values include: a, b, c" admitted there might be more without saying
        // how many or where, so a column with nine answers and one with four
        // hundred read identically — and a value at the sixth was on screen in the
        // sense that matters legally and invisible in the sense that matters to a
        // person about to dismiss the column.
        assertTrue(
            "the values it did not print must be counted",
            card.contains("column.total"),
        )
        assertTrue(
            "and reachable",
            card.contains("ContactImport.Columns.showAllValuesLabel(column.total") &&
                card.contains("column.values"),
        )
        assertTrue(
            "and its position, because the server names a column by position",
            card.contains("ContactImport.Columns.positionLabel(column.index"),
        )
        assertTrue(
            "and its header exactly as the file spelled it",
            card.contains("ContactImport.Columns.headerLabel(column.header"),
        )
        // The consequence of a wrong answer sits on the path to the button.
        val warning = tab.indexOf("ContactImport.Columns.wrongColumn(")
        val confirm = tab.indexOf("ContactImport.Columns.CONFIRM")
        assertTrue("the warning is gone", warning > 0)
        assertTrue("it must be read before the button, not after it", warning < confirm)
    }

    @Test
    fun `the declaration posted is built from the file, by index`() {
        // Built from the plan's own columns and their own headers, so the
        // declaration always describes the file actually attached — the server
        // checks that, and a mismatch refuses the whole upload.
        assertTrue(
            "the declaration must be formatted by the shared port",
            tab.contains("ImportColumns.format("),
        )
        assertTrue(tab.contains("index = column.index,"))
        assertTrue(tab.contains("header = column.header,"))
        assertTrue(
            "and the vCard door likewise",
            tab.contains("VCardProperties.format("),
        )
    }

    @Test
    fun `a refused file reaches a sheet, chosen by the error CODE`() {
        // The refusal is several sentences: what is wrong, why nothing was
        // imported, and the way out. A Snackbar truncates that to a line and a
        // half and takes it away again — so the one refusal in this product
        // somebody MUST read in full was the one they could not.
        assertTrue(
            "the refusal must be recognised by its structural code",
            tab.contains("ApiErrorCode.VALIDATION_FAILED"),
        )
        assertTrue(
            "a refused file must open the sheet",
            tab.contains("importRefusal = ImportRefusal("),
        )
        assertTrue(
            "ImportRefusedSheet must be mounted, not merely defined",
            Regex("""ImportRefusedSheet\(""").findAll(tab).count() >= 2,
        )
        assertTrue(
            "the server's own sentence must reach the screen verbatim",
            tab.contains("refusal.message,"),
        )
        // And everything that is NOT the server reading the file — no network,
        // signed out, too many imports — still takes the Snackbar it always had.
        assertTrue(
            "non-validation failures must not be swallowed by the sheet",
            // The OPENING of the call. #228 threads the reader's language into
            // `userMessage(locale)`, and pinning the empty parens would have
            // forced a refusal to stay English to keep this green. What this
            // asserts is the PATH — a non-validation failure takes the snackbar,
            // not the sheet — which an argument cannot change.
            tab.contains("snackbar.showSnackbar(cause.userMessage("),
        )
    }

    @Test
    fun `the refusal is never parsed, and the retry re-asks rather than re-sends`() {
        // Parsing column names back out of English would put a compliance gate at
        // the mercy of somebody rewording a sentence, and the file is right here
        // in memory.
        for (sniff in listOf(".message.contains(", ".message.startsWith(", ".message.split(")) {
            assertFalse("the refusal message must never be parsed: $sniff", tab.contains(sniff))
        }
        assertTrue(
            "the retry must re-open the per-column question",
            tab.contains("columnStep = ColumnStep(refusal.fileName, refusal.bytes, plan)"),
        )
        // Round two's shape: catch the 422, echo back what it named, post again.
        // Two round trips and no human. There must be no path from a refusal
        // straight to an upload.
        val refusalBlock = tab.substringAfter("importRefusal?.let { refusal ->")
        assertFalse(
            "a refusal must never re-post the same file by itself (#248)",
            refusalBlock.take(1200).contains("upload("),
        )
    }

    @Test
    fun `only the CSV door offers the column question`() {
        // A .vcf has no columns. An empty question is worse than none, and the
        // vCard door has its own sheet for its own shape.
        assertTrue(
            "the column plan must be CSV-only",
            tab.contains("if (kind == ContactImportKind.CSV)"),
        )
        assertTrue(
            "ImportColumnsSheet must be mounted, not merely defined",
            Regex("""ImportColumnsSheet\(""").findAll(tab).count() >= 2,
        )
        assertTrue(
            "ImportPropertiesSheet must be mounted, not merely defined",
            Regex("""ImportPropertiesSheet\(""").findAll(tab).count() >= 2,
        )
    }

    @Test
    fun `round two's classifier and its field are gone from this screen`() {
        // Deleted rather than kept "as a hint": a hint that is read is a
        // threshold, and a threshold has an outside.
        for (dead in listOf(
            "unmappedFlagColumns",
            "ReviewColumn",
            "reviewedColumns",
            "REVIEWED_COLUMN_FIELD",
            "ImportColumns.review(",
        )) {
            assertFalse("$dead survives on this screen", source.contains(dead))
        }
    }

    @Test
    fun `the refused-row overflow counts the server's number, not the list`() {
        // #248 round 2 (B5/B8): the count and the list are two facts, and until
        // the count stopped always being zero they could not disagree. The
        // screen that would print "40" over five rows is this one.
        assertTrue(
            "the refusal list must be bounded by the server's own count",
            tab.contains("total = result.consent_refused,"),
        )
        assertTrue(
            "and the overflow sentence must be the derived one",
            tab.contains("ContactImport.overflowLine(total, shown.size"),
        )
    }

    // ------------------------------------------------------------- plumbing

    private fun readMainSource(relative: String): String {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android",
            "app/src/main/kotlin/com/loonext/android",
            "apps/android/app/src/main/kotlin/com/loonext/android",
        )
        for (base in bases) {
            val file = File(File(base), relative)
            if (file.exists()) return file.readText()
        }
        fail("source not found: $relative (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
