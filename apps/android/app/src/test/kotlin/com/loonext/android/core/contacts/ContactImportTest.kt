package com.loonext.android.core.contacts

import com.loonext.android.core.i18n.AppStrings
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #248 — the Kotlin port of `packages/shared/src/contact-import.ts`, checked
 * against the TypeScript itself rather than against numbers typed in here.
 *
 * A test that pins `MAX_ROWS == 2000` proves the port has not changed. It does
 * not prove the port is RIGHT, and the day the shared cap moves it becomes a
 * ceiling holding the port at last month's value — which is exactly how the
 * attestation field came to exist on the server and nowhere else. So the
 * source of truth is read from the repo, the same way `ParityVectorsTest`
 * reads its vectors.
 */
class ContactImportTest {

    /**
     * #228 — the ENGLISH behind a catalogue key.
     *
     * Half of this class asks what a sentence SAYS, and since #228 the copy
     * objects hold keys rather than sentences. Reading the key's English back
     * out of the catalogue keeps every one of those questions intact, and
     * throwing on a missing key means a sentence deleted from the catalogue
     * fails here rather than quietly rendering its own key name on a phone.
     */
    private fun en(key: String): String =
        AppStrings.en[key] ?: throw AssertionError("no English for $key")

    /**
     * Walk UP to the repo root: Gradle runs unit tests from `apps/android/app`,
     * but that is a property of the runner, not a promise.
     */
    private fun sharedSource(): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/src/contact-import.ts")
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError(
            "packages/shared/src/contact-import.ts not found walking up from " +
                File("").absolutePath,
        )
    }

    /** `export const NAME = "literal";` */
    private fun stringConst(source: String, name: String): String {
        val match = Regex("""const $name\s*=\s*\n?\s*"([^"]*)"""").find(source)
            ?: throw AssertionError("$name is not a string constant in the shared module")
        return match.groupValues[1]
    }

    /**
     * `export const NAME = 2000;` or `= 2 * 1024 * 1024;` or `= OTHER_CONST;`.
     * Products and aliases are both in the shared file, and resolving them here
     * beats asserting against a flattened number nobody can trace back.
     */
    private fun numberConst(source: String, name: String): Long {
        val match = Regex("""const $name\s*=\s*([A-Z0-9_ *]+);""").find(source)
            ?: throw AssertionError("$name is not a numeric constant in the shared module")
        return match.groupValues[1]
            .split("*")
            .map { it.trim() }
            .fold(1L) { product, term ->
                product * (term.toLongOrNull() ?: numberConst(source, term))
            }
    }

    @Test
    fun `the attestation field and value match the shared module`() {
        val source = sharedSource()
        // If either drifts, every import from this app 422s against a field
        // name the UI has no control for — which is precisely what #226 did.
        assertEquals(
            stringConst(source, "CONTACT_IMPORT_CONSENT_FIELD"),
            ContactImport.CONSENT_FIELD,
        )
        assertEquals(
            stringConst(source, "CONTACT_IMPORT_CONSENT_VALUE"),
            ContactImport.CONSENT_VALUE,
        )
    }

    @Test
    fun `the bounds this app prints match the shared module`() {
        val source = sharedSource()
        assertEquals(
            numberConst(source, "CONTACT_IMPORT_MAX_ROWS"),
            ContactImport.MAX_ROWS.toLong(),
        )
        assertEquals(numberConst(source, "CONTACT_IMPORT_MAX_BYTES"), ContactImport.MAX_BYTES)
        assertEquals(
            numberConst(source, "VCARD_IMPORT_MAX_CARDS"),
            ContactImport.VCARD_MAX_CARDS.toLong(),
        )
        assertEquals(numberConst(source, "VCARD_IMPORT_MAX_BYTES"), ContactImport.VCARD_MAX_BYTES)
    }

    @Test
    fun `each import kind carries the bounds the server enforces for it`() {
        assertEquals(ContactImport.MAX_ROWS, ContactImportKind.CSV.maxEntries)
        assertEquals(ContactImport.MAX_BYTES, ContactImportKind.CSV.maxBytes)
        assertEquals(ContactImport.VCARD_MAX_CARDS, ContactImportKind.VCARD.maxEntries)
        assertEquals(ContactImport.VCARD_MAX_BYTES, ContactImportKind.VCARD.maxBytes)
    }

    @Test
    fun `an unattested import posts no consent field at all`() {
        // Fail CLOSED, and fail on the SERVER: the app never decides locally
        // that consent is unnecessary, it simply declines to make the claim.
        assertEquals(
            emptyList<Pair<String, String>>(),
            ContactImport.csvFields(false, emptyList()),
        )
        assertEquals(
            emptyList<Pair<String, String>>(),
            ContactImport.vcardFields(false, emptyList()),
        )
    }

    @Test
    fun `an attested import posts exactly the field the server demands`() {
        assertEquals(
            listOf(ContactImport.CONSENT_FIELD to ContactImport.CONSENT_VALUE),
            ContactImport.csvFields(true, emptyList()),
        )
        // The server accepts the literal "true" and nothing else — a value that
        // could also be "false" is a field, not an attestation.
        assertEquals("true", ContactImport.CONSENT_VALUE)
    }

    @Test
    fun `the two declaration fields match the shared module`() {
        // #248 round 3. If either drifts, every declaration is posted under a
        // name the server does not read — and since the gate is unconditional,
        // that is not a degraded import, it is no import at all.
        val source = sharedSource()
        assertEquals(
            stringConst(source, "CONTACT_IMPORT_COLUMN_FIELD"),
            ContactImport.COLUMN_FIELD,
        )
        assertEquals(
            stringConst(source, "CONTACT_IMPORT_VCARD_PROPERTY_FIELD"),
            ContactImport.VCARD_PROPERTY_FIELD,
        )
    }

    @Test
    fun `round two's acknowledgement field is gone from both sides`() {
        // It was sent only for the columns the server had just complained about,
        // so the shortest path to a 200 was: post, read the column names out of
        // the 422, post again. Two round trips and no human — demonstrated live.
        // A complete declaration removes the loop rather than policing it.
        assertFalse(sharedSource().contains("REVIEWED_COLUMN"))
        assertFalse(
            readMainSource("core/contacts/ContactImport.kt").contains("REVIEWED_COLUMN_FIELD"),
        )
    }

    @Test
    fun `a declaration is posted once per column, under a repeated name`() {
        // The field is REPEATED — a header may contain anything, commas and
        // colons included, so there is no delimiter to get wrong — and a Map
        // cannot say a name twice. That is why these are pairs: the shape this
        // app posted in until #248 could not have expressed the answer at all.
        val columns = listOf("0:phone:Phone", "1:ignore:Region, EU", "2:opted_out:Do: Not Call")
        val fields = ContactImport.csvFields(true, columns)
        assertEquals(
            listOf(ContactImport.CONSENT_FIELD to ContactImport.CONSENT_VALUE) +
                columns.map { ContactImport.COLUMN_FIELD to it },
            fields,
        )
        assertEquals(
            "every column must survive, under one repeated field name",
            3,
            fields.count { it.first == ContactImport.COLUMN_FIELD },
        )
    }

    @Test
    fun `the vCard door posts its properties under its own field`() {
        // Two field names because they are two different questions. A `column`
        // posted at the vCard door would be read by nothing and the cards'
        // CATEGORIES would go undeclared.
        val fields = ContactImport.vcardFields(true, listOf("CATEGORIES:opted_out", "NOTE:ignore"))
        assertEquals(
            listOf(
                ContactImport.CONSENT_FIELD to ContactImport.CONSENT_VALUE,
                ContactImport.VCARD_PROPERTY_FIELD to "CATEGORIES:opted_out",
                ContactImport.VCARD_PROPERTY_FIELD to "NOTE:ignore",
            ),
            fields,
        )
        assertTrue(fields.none { it.first == ContactImport.COLUMN_FIELD })
    }

    @Test
    fun `neither declaration can be defaulted`() {
        // THE safety property of these two functions, and it is enforced by the
        // compiler rather than by this assertion — there is no overload to call
        // without an answer. The assertion is on the SOURCE because a default
        // added later would compile, pass every other test here, and put the
        // silent case back: a caller reaching the import route with nobody
        // having said what the file contains.
        val source = readMainSource("core/contacts/ContactImport.kt")
        for (signature in listOf("columns: List<String>", "properties: List<String>")) {
            assertTrue("$signature is gone", source.contains(signature))
            assertFalse(
                "$signature must not gain a default — see the docblock",
                source.contains("$signature = "),
            )
        }
        assertFalse(
            "and neither may `attested`, for the same reason",
            source.contains("attested: Boolean = "),
        )
    }

    /** This module's own source, for the assertions a value cannot express. */
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
        throw AssertionError("source not found: $relative (cwd=${File(".").absolutePath})")
    }

    @Test
    fun `the overflow line counts what the server said, not what fitted`() {
        // #248 round 2 (B5/B8): the refusal count and the refusal list are two
        // facts, and until the count stopped always being zero they could never
        // disagree. A screen printing "40 refused" over five rows with nothing
        // saying the rest existed is the failure this closes, and every refused
        // row names a person this workspace must not text.
        assertEquals("…and 35 more.", ContactImport.overflowLine(total = 40, listed = 5))
        assertNull("a whole list needs no line", ContactImport.overflowLine(total = 5, listed = 5))
        // Never negative, never "…and -3 more." — a list longer than its count
        // is a server bug, and inventing an apology for it helps nobody.
        assertNull(ContactImport.overflowLine(total = 2, listed = 5))
        assertNull(ContactImport.overflowLine(total = 0, listed = 0))
    }

    @Test
    fun `a column's values are shown so it can be recognised`() {
        // THE reason this screen exists. A header alone is often not enough —
        // "Status" means nothing until you see it holds `active` and
        // `unsubscribed`, and at that point the answer is obvious and the
        // opposite of the one a skimmer would give.
        val line = ContactImport.Columns.valuesLine(listOf("active", "unsubscribed"))
        assertTrue(line, line.contains("active"))
        assertTrue(line, line.contains("unsubscribed"))
        // "include", never "holds": these are the first ImportColumns.SAMPLE_LIMIT
        // distinct values, and claiming to have listed the column would be a
        // claim nobody checked.
        assertTrue(line, line.contains("include"))
        assertFalse(line, line.lowercase().contains("holds"))
        // An empty column is still asked about, so it still needs a sentence —
        // and the sentence has to say it is empty rather than say nothing.
        assertTrue(
            ContactImport.Columns.valuesLine(emptyList()),
            ContactImport.Columns.valuesLine(emptyList()).contains("empty"),
        )
    }

    @Test
    fun `every answer a column may carry has a label of its own`() {
        // A control offering a raw `first_name` is a control nobody can read, and
        // two options sharing a label is a control nobody can use.
        val labels = ImportColumns.ACTIONS.map { ContactImport.Columns.actionLabel(it) }
        assertEquals("no two answers may read the same", labels.size, labels.toSet().size)
        for ((action, label) in ImportColumns.ACTIONS.zip(labels)) {
            assertTrue(action, label.isNotBlank())
            assertFalse("$action is printed raw", label == action)
        }
        // The two consequential ones say what they DO, in the words somebody
        // looking at a spreadsheet column would use.
        assertEquals("Do not text", ContactImport.Columns.actionLabel(ImportColumns.FIELD_OPTED_OUT))
        assertTrue(
            ContactImport.Columns.actionLabel(ImportColumns.ACTION_IGNORE)
                .lowercase()
                .contains("ignore"),
        )
    }

    @Test
    fun `the per-column step names the consequence of a wrong answer`() {
        // Somebody who ignores a do-not-call column here texts everybody it was
        // protecting, and that sentence has to be in front of them while they
        // answer — naming the outcome, not the procedure.
        // #228: built through the catalogue now, and the `{answer}` slot is
        // still filled from the control's own label rather than retyped.
        val warning = ContactImport.Columns.wrongColumn()
        assertTrue(warning, warning.contains(ContactImport.Columns.actionLabel("opted_out")))
        assertTrue(warning, warning.contains("texted"))
        assertTrue(warning, warning.contains("protecting"))
        // And the LEAD says why the question is being asked at all. "We did not
        // recognise these" invites "so skip them", which is the behaviour that
        // caused #248 twice.
        val lead = en(ContactImport.Columns.LEAD)
        assertTrue(lead, lead.contains("does not guess"))
    }

    @Test
    fun `a column is named by position as well as by header`() {
        // The server names a column at fault by position ("column 3"), and two
        // columns in one file are allowed to share a header — a name on its own
        // cannot always say which. 1-based, so the two agree.
        assertEquals("Column 3", ContactImport.Columns.positionLabel(2))
        assertEquals("Column 1", ContactImport.Columns.positionLabel(0))
        // A nameless column is asked about like any other. Round two withheld
        // these because its field matched columns BY NAME and no answer would
        // work; the declaration is by index, so there is now an answer — which is
        // what lets a cell past the end of the header row be accounted for.
        assertTrue(ContactImport.Columns.headerLabel("").contains("no header"))
        assertTrue(ContactImport.Columns.headerLabel("   ").contains("no header"))
        assertTrue(ContactImport.Columns.headerLabel("Do Not Call").contains("Do Not Call"))
    }

    @Test
    fun `the progress line counts what is answered, and does not start at zero`() {
        // It opens at whatever the detector recognised. A progress line reading
        // "0 of 7" on a screen that is four-sevenths finished is the reason
        // people abandon a flow — and it would also be a lie.
        assertEquals("4 of 7 answered", ContactImport.Columns.progressLine(4, 7))
        assertEquals("0 of 1 answered", ContactImport.Columns.progressLine(0, 1))
    }

    @Test
    fun `a field claimed twice is named before the server has to refuse it`() {
        // "a contact has one" — the server's own words. Catching it on the sheet
        // only ever SAVES a round trip; it cannot let anything through, which is
        // why a form check here is not a gate here.
        val hint = ContactImport.Columns.duplicateHint("phone")
        assertTrue(hint, hint.contains(ContactImport.Columns.actionLabel("phone")))
        assertTrue(hint, hint.contains("Two columns"))
    }

    @Test
    fun `the vCard sheet says how blunt its blocking answer is`() {
        // Declaring a property `opted_out` blocks EVERY card carrying it, whatever
        // it says — a CATEGORIES of "Friends" alongside one of "DNC". Genuinely
        // coarse, and somebody should know before they choose it rather than
        // after.
        val coarse = ContactImport.Properties.coarse()
        assertTrue(coarse, coarse.contains("every card"))
        assertTrue(
            coarse,
            coarse.contains(
                ContactImport.Properties.actionLabel(VCardProperties.ACTION_OPTED_OUT),
            ),
        )
        // And the lead says where a .vcf can say do-not-text at all, because
        // nobody knows that: it is a note or a category, and nothing else.
        val lead = en(ContactImport.Properties.LEAD)
        assertTrue(lead, lead.contains("note"))
        assertTrue(lead, lead.contains("categories"))
        val labels = VCardProperties.ACTIONS.map { ContactImport.Properties.actionLabel(it) }
        assertEquals(labels.size, labels.toSet().size)
        for ((action, label) in VCardProperties.ACTIONS.zip(labels)) {
            assertFalse("$action is printed raw", label == action)
        }
    }

    @Test
    fun `every printed figure is derived from the bounds, not typed`() {
        val csvMb = ContactImport.MAX_BYTES / (1024L * 1024L)
        val vcardMb = ContactImport.VCARD_MAX_BYTES / (1024L * 1024L)

        // The two doors have different caps, so the two sentences must differ —
        // a copy-paste that quoted the CSV cap at a vCard would promise a file
        // the server refuses, at the exact moment a new crew is least patient.
        assertTrue(
            ContactImport.tooLargeMessage(ContactImportKind.CSV).contains("$csvMb MB"),
        )
        assertTrue(
            ContactImport.tooLargeMessage(ContactImportKind.VCARD).contains("$vcardMb MB"),
        )
        assertTrue(
            ContactImport.limitsLine(ContactImportKind.CSV)
                .contains("${ContactImport.MAX_ROWS / 1000},000 rows"),
        )
        assertTrue(
            ContactImport.limitsLine(ContactImportKind.VCARD)
                .contains("${ContactImport.VCARD_MAX_CARDS / 1000},000 cards"),
        )
        assertTrue(
            ContactImport.limitsLine(ContactImportKind.VCARD).contains("$vcardMb MB"),
        )
    }

    @Test
    fun `neither door claims an import can lift a STOP`() {
        // The server can only ever ADD a block: the CSV path revives a REVOKED
        // opt-out and inserts new ones, the vCard path never touches opt_outs.
        // Copy that hinted otherwise would be the one promise about carrier
        // truth we are not allowed to get wrong.
        // #228: `optOutNote` is a catalogue key, so the sentence is read back
        // out of the English map. STOP is a carrier keyword and stays STOP in
        // both languages — a translated STOP is an opt-out nothing registers.
        for (kind in ContactImportKind.entries) {
            assertTrue(kind.name, en(kind.optOutNote).contains("STOP"))
            assertTrue(kind.name, AppStrings.frCA[kind.optOutNote]?.contains("STOP") == true)
        }
        assertTrue(en(ContactImportKind.CSV.optOutNote).contains("opted-out column"))
        // #248 round 3 changed the FACT this sentence reports, so the guard had
        // to change with it: a .vcf CAN now say do-not-text, through a property
        // somebody declared. The old wording ("a .vcf carries no opt-out column")
        // was true of the parser and false of the format, and that gap is how
        // CATEGORIES:DNC came to be dropped in silence.
        assertTrue(en(ContactImportKind.VCARD.optOutNote).contains("do-not-text"))
        for (kind in ContactImportKind.entries) {
            assertFalse(
                "${kind.name} must not claim a card cannot carry an opt-out",
                en(kind.optOutNote).contains("no opt-out"),
            )
        }
    }

    @Test
    fun `the refusal heading counts the rows it is about`() {
        // The server sends the number; the heading exists to say it. "Some
        // customers" over a list of forty is the count nobody can act on, and
        // this figure is the one a carrier audit actually asks for.
        assertTrue(ContactImport.consentRefusedHeadline(40).contains("40"))
        assertTrue(ContactImport.consentRefusedHeadline(1).contains("1"))
        // And it says what the count is OF — a bare number over a red panel
        // reads as a failure, which this is not.
        for (count in listOf(1, 2, 40)) {
            assertTrue(
                count.toString(),
                ContactImport.consentRefusedHeadline(count).contains("opted out"),
            )
        }
    }

    @Test
    fun `the refusal heading reads correctly for a single customer`() {
        // One refused row is the common case — a crew importing a book they
        // have texted before hits exactly one old STOP — so "1 customers" is
        // the version most people would see.
        assertFalse(
            ContactImport.consentRefusedHeadline(1),
            ContactImport.consentRefusedHeadline(1).contains("customers"),
        )
        assertTrue(ContactImport.consentRefusedHeadline(1).contains("customer"))
        assertTrue(ContactImport.consentRefusedHeadline(2).contains("customers"))
    }

    @Test
    fun `the sheet states what ticking the box actually records`() {
        // The server records the attestation ONLY where there is no basis yet
        // and leaves an existing one alone (importConsentColumns). Copy saying
        // "recorded for everyone" would describe the behaviour #248 removed.
        val recorded = en(ContactImport.Copy.RECORDED)
        assertTrue(recorded, recorded.contains("no consent recorded yet"))
        assertTrue(recorded, recorded.contains("keep it"))
    }
}
