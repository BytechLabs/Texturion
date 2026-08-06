package com.loonext.android.core.contacts

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #248 ROUND 3 — the vCard door's declaration, and the port of the property
 * enumeration it rests on.
 *
 * This door had no gate of any kind. `CATEGORIES:DNC`, `NOTE:DO NOT CONTACT -
 * asked us to stop`, and a label like `X-ABLabel=DO NOT CALL` on the TEL line
 * are where a .vcf says do-not-text; they are what Apple and Google actually
 * export, and all three were dropped without a word while the file's consent
 * attestation was written over the top.
 *
 * THE ENUMERATION HAS TO BE EXACT, in both directions, and neither failure is
 * quiet. A property this app MISSES is a refusal nobody can answer from the
 * phone — the server names a property the sheet never showed. A property this
 * app INVENTS is a question about something that is not in their file. So the
 * parity tests read `apps/api/src/routes/core/vcard.ts` and the shared contract,
 * and the behaviour tests below run the same shapes that parser handles.
 */
class VCardPropertiesTest {

    private fun repoFile(relative: String): String {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, relative)
            if (candidate.exists()) return candidate.readText()
            dir = dir.parentFile
        }
        throw AssertionError("$relative not found walking up from ${File("").absolutePath}")
    }

    private fun contractSource(): String = repoFile("packages/shared/src/contact-import.ts")

    private fun stringConst(source: String, name: String): String =
        Regex("""const $name\s*=\s*\n?\s*"([^"]*)"""").find(source)?.groupValues?.get(1)
            ?: throw AssertionError("$name is not a string constant in the shared module")

    // ------------------------------------------------------------- parity

    @Test
    fun `the properties the importer reads match the shared module`() {
        // Everything NOT on this list has to be declared. A phone holding a
        // longer list than the server would skip asking about a property the
        // server then refuses the file over, with no control anywhere to answer
        // it — the file becomes unimportable from this device.
        val block = Regex("""VCARD_MAPPED_PROPERTIES: readonly string\[\] = \[([^\]]*)\]""")
            .find(contractSource())
            ?.groupValues?.get(1)
            ?: throw AssertionError("VCARD_MAPPED_PROPERTIES is not a list literal")
        val shared = Regex("\"([^\"]*)\"").findAll(block).map { it.groupValues[1] }.toList()
        assertEquals(shared, VCardProperties.MAPPED)
    }

    @Test
    fun `both answers match the shared module`() {
        val body = Regex("""const VCARD_ACTIONS = new Set<string>\(\[([^\]]*)\]\)""")
            .find(contractSource())
            ?.groupValues?.get(1)
            ?: throw AssertionError("VCARD_ACTIONS is not a Set literal")
        val shared = body
            .split(",")
            .map { it.trim() }
            .filter { it != "" }
            .map { if (it.startsWith("\"")) it.trim('"') else stringConst(contractSource(), it) }
            .toSet()
        assertEquals(shared, VCardProperties.ACTIONS.toSet())
        // TWO answers, not the CSV's eight. A vCard property is present on a card
        // or it is not — there is no field to route it into — so the answers that
        // mean anything are "says nothing" and "do not text these".
        assertEquals(2, VCardProperties.ACTIONS.size)
    }

    @Test
    fun `the wire form is the one the server parses`() {
        val template = Regex("""return `([^`]+)`;""")
            .find(contractSource().substringAfter("export function formatVCardProperty"))
            ?.groupValues?.get(1)
            ?: throw AssertionError("formatVCardProperty does not return a template")
        val expected = template
            .replace("\${declaration.property}", "CATEGORIES")
            .replace("\${declaration.action}", VCardProperties.ACTION_OPTED_OUT)
        assertEquals(
            expected,
            VCardProperties.format("CATEGORIES", VCardProperties.ACTION_OPTED_OUT),
        )
        assertFalse(expected, expected.contains("\${"))
    }

    @Test
    fun `the parameter token is spelled the way the server spells it`() {
        // Built by SUBSTITUTING into the shared template rather than by retyping
        // `$property;$parameter` here. These two strings have to match character
        // for character in a place nothing else checks: a phone asking about
        // `TEL/TYPE` while the server waits to hear about `TEL;TYPE` is a client
        // whose every .vcf import is refused, with the person having answered
        // every question the sheet put in front of them.
        val template = Regex("""return `([^`]+)`;""")
            .find(contractSource().substringAfter("export function vcardParameterProperty"))
            ?.groupValues?.get(1)
            ?: throw AssertionError("vcardParameterProperty does not return a template")
        val expected = template
            .replace("\${property}", "TEL")
            .replace("\${parameter}", "X-ABLABEL")
        assertEquals(expected, VCardProperties.parameterProperty("TEL", "X-ABLABEL"))
        assertFalse(expected, expected.contains("\${"))
        // And the wire form still round-trips one: the declaration splits on the
        // LAST colon, so a token carrying a `;` is unremarkable to it.
        assertEquals(
            "TEL;X-ABLABEL" to VCardProperties.ACTION_OPTED_OUT,
            VCardProperties.parse(
                VCardProperties.format(
                    VCardProperties.parameterProperty("TEL", "X-ABLABEL"),
                    VCardProperties.ACTION_OPTED_OUT,
                ),
            ),
        )
    }

    // --------------------------------------------------- the enumeration

    /**
     * One file exercising every branch of the walk at once (rule 3): a card with
     * properties we read and properties we do not, a grouped property, a
     * parameterised one, a folded value whose continuation contains a colon, a
     * second card carrying something the first did not, and a line outside any
     * card at all.
     */
    private val mixedCards =
        "X-EVOLUTION-JUNK:outside any card\r\n" +
            "BEGIN:VCARD\r\n" +
            "VERSION:3.0\r\n" +
            "FN:Ann Fischer\r\n" +
            "TEL;TYPE=CELL:+14165550100\r\n" +
            "CATEGORIES:DNC\r\n" +
            "NOTE:DO NOT CONTACT - asked us\r\n" +
            "  to stop: 2026-01-04\r\n" +
            "item1.X-ABLabel:Home\r\n" +
            "END:VCARD\r\n" +
            "BEGIN:VCARD\r\n" +
            "VERSION:3.0\r\n" +
            "FN:Bob Vance\r\n" +
            "TEL:+14165550101\r\n" +
            "BDAY:1980-04-01\r\n" +
            "END:VCARD\r\n"

    @Test
    fun `every property the cards carry that we do not read is reported`() {
        assertEquals(
            listOf("BDAY", "CATEGORIES", "NOTE", "TEL;TYPE", "X-ABLABEL"),
            VCardProperties.undeclared(mixedCards.toByteArray()),
        )
    }

    @Test
    fun `the two properties that can say do-not-text are both in the list`() {
        // The whole reason this door has a gate now. Named individually rather
        // than left to the list above, because the list changing for an unrelated
        // reason must not quietly take one of these two with it.
        val found = VCardProperties.undeclared(mixedCards.toByteArray())
        assertTrue("CATEGORIES:DNC must reach a person", found.contains("CATEGORIES"))
        assertTrue("a NOTE saying they asked us to stop must too", found.contains("NOTE"))
    }

    @Test
    fun `a folded line is not read as a second property`() {
        // THE trap in this port. The continuation `  to stop: 2026-01-04` carries
        // a colon, so a walk that did not unfold would invent a property called
        // "TO STOP" — a question about something that is not in their file — and
        // the real NOTE would still be there underneath it.
        val found = VCardProperties.undeclared(mixedCards.toByteArray())
        assertFalse(found.toString(), found.any { it.contains("TO STOP") })
        // And the unfolding must not swallow the property either: a file whose
        // only interesting line is folded still asks about it.
        assertEquals(
            listOf("NOTE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\nFN:Ann\nTEL:+14165550100\n" +
                        "NOTE:they asked us\n to stop texting\nEND:VCARD\n"
                    ).toByteArray(),
            ),
        )
    }

    @Test
    fun `a grouped or parameterised property is named the way the server names it`() {
        // `item1.X-ABLabel` is what Apple exports and the server strips the group
        // prefix and upper-cases it. A phone that sent `item1.X-ABLabel:ignore`
        // would be answering about a property the server does not have, and the
        // file would be refused with the person having answered correctly.
        assertTrue(
            VCardProperties.undeclared(mixedCards.toByteArray()).contains("X-ABLABEL"),
        )
        assertEquals(
            listOf("X-SOCIALPROFILE", "X-SOCIALPROFILE;TYPE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\nFN:Ann\nTEL:+1\n" +
                        "item2.X-socialProfile;TYPE=twitter:https://x.com/ann\nEND:VCARD\n"
                    ).toByteArray(),
            ),
        )
    }

    @Test
    fun `a parameter is its own question, qualified by the property it sits on`() {
        // APPLE'S INLINE SHAPE, and the reason parameters are enumerated at all.
        // The property is TEL, TEL is read, and everything after the first `;`
        // used to be thrown away — so the one sentence on the line saying not to
        // text this person was the one part nobody looked at. The grouped
        // `item1.X-ABLabel:` form was always caught, which is exactly what made
        // this one look covered.
        assertEquals(
            listOf("TEL;TYPE", "TEL;X-ABLABEL"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nFN:Ann Fischer\r\n" +
                        "TEL;TYPE=CELL;X-ABLabel=DO NOT CALL:+16135550100\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
        // Qualified by the PROPERTY, never bare: a TYPE on TEL and a TYPE on
        // EMAIL are different text on different lines, and one answer covering
        // both would dismiss a value nobody saw.
        assertEquals(
            listOf("EMAIL", "EMAIL;TYPE", "TEL;TYPE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nFN:Ann\r\nTEL;TYPE=CELL:+1416\r\n" +
                        "EMAIL;TYPE=WORK:ann@example.com\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
        // A MIX down one line: a valueless parameter (`PREF` is its own name,
        // there is no `=` to cut at), one that has a value, and a repeat that
        // must not be asked about twice. Three different branches of the segment
        // loop, on the line shape a real export writes.
        assertEquals(
            listOf("TEL;PREF", "TEL;TYPE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nFN:Ann\r\n" +
                        "TEL;PREF;TYPE=CELL;TYPE=VOICE:+1416\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
    }

    @Test
    fun `a line the format calls nonsense is still a line somebody wrote`() {
        // Two doors, both of which delivered a message. A line with NO colon is
        // not a content line by the RFC — a statement about the format, not about
        // what the file was trying to say. And a malformed parameter leaves no
        // unquoted colon either, so `CATEGORIES` (one of the two places a .vcf can
        // say stop) went unasked because of a typo.
        assertEquals(
            listOf("DO-NOT-CALL"),
            VCardProperties.undeclared(
                "BEGIN:VCARD\r\nFN:Ann\r\nTEL:+1416\r\nDO-NOT-CALL\r\nEND:VCARD\r\n".toByteArray(),
            ),
        )
        assertEquals(
            listOf("CATEGORIES", "CATEGORIES;TYPE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nFN:Ann\r\nTEL:+1416\r\n" +
                        "CATEGORIES;TYPE=\"a:DNC\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
    }

    @Test
    fun `a plain export asks about its parameters and nothing else`() {
        // THE ORDINARY CASE, AND IT IS NO LONGER SILENT. This test used to assert
        // that an FN/N/TEL export asked nothing, over a fixture whose TEL line
        // carries `TYPE=CELL` — which stopped being true the day a parameter
        // became something to declare, and would have held this port at last
        // month's answer while every .vcf import from this phone was refused.
        //
        // The cost is stated rather than exempted: a parameter is free text and
        // `TYPE=DNC` is a real export, so a rule letting the ubiquitous ones
        // through would be a vocabulary.
        assertEquals(
            listOf("TEL;TYPE"),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Fischer;Ann;;;\r\nFN:Ann Fischer\r\n" +
                        "TEL;TYPE=CELL:+14165550100\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
        // A card with no parameters on it still asks nothing, so the sheet only
        // appears when the file gives it something to say.
        assertEquals(
            emptyList<String>(),
            VCardProperties.undeclared(
                (
                    "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Fischer;Ann;;;\r\nFN:Ann Fischer\r\n" +
                        "TEL:+14165550100\r\nEND:VCARD\r\n"
                    ).toByteArray(),
            ),
        )
    }

    @Test
    fun `nothing outside a card is a property of one`() {
        // Only content lines INSIDE a BEGIN/END block count, exactly as the
        // server counts them — noise around the cards is not a question.
        assertFalse(
            VCardProperties.undeclared(mixedCards.toByteArray()).contains("X-EVOLUTION-JUNK"),
        )
    }

    // -------------------------------------------------------- format/parse

    @Test
    fun `a declaration round-trips, splitting on the last colon`() {
        val wire = VCardProperties.format("CATEGORIES", VCardProperties.ACTION_OPTED_OUT)
        assertEquals("CATEGORIES" to VCardProperties.ACTION_OPTED_OUT, VCardProperties.parse(wire))
        // The LAST colon, the mirror of the column format's first: a property name
        // may be grouped or parameterised, and the action is the fixed token, so
        // the fixed end is the safe end to split from.
        assertEquals(
            "ITEM1.X-ABLABEL" to VCardProperties.ACTION_IGNORE,
            VCardProperties.parse("item1.X-ABLabel:${VCardProperties.ACTION_IGNORE}"),
        )
        assertNull(VCardProperties.parse("CATEGORIES"))
        assertNull("an action nobody knows is not an answer", VCardProperties.parse("NOTE:maybe"))
        assertNull(VCardProperties.parse(":ignore"))
        // The CSV's field names are not answers here, and must not be smuggled in:
        // a vCard property routed to `notes` would be read as nothing.
        assertNull(VCardProperties.parse("NOTE:notes"))
    }
}
