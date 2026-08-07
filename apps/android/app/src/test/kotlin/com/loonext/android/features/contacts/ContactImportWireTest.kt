package com.loonext.android.features.contacts

import com.loonext.android.core.auth.Session
import com.loonext.android.core.auth.SessionSource
import com.loonext.android.core.auth.SupabaseAuth
import com.loonext.android.core.contacts.ContactImport
import com.loonext.android.core.contacts.ImportColumns
import com.loonext.android.core.contacts.VCardProperties
import com.loonext.android.core.net.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.runTest
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * #248 — what the two bulk import doors actually put on the wire.
 *
 * This is the test whose absence let #226 ship broken for a week. The server
 * side of the attestation gate was covered from the first commit; nothing
 * anywhere exercised a CLIENT posting the form, so `fields = emptyMap()` sat in
 * `ContactMutations` and every CSV import on this app 422'd. A guard that only
 * ever proves the server refuses is half a guard.
 */
class ContactImportWireTest {

    private class FakeSessions : SessionSource {
        val flow = MutableStateFlow<Session?>(
            Session(
                accessToken = "token-1",
                refreshToken = "refresh-1",
                expiresAt = System.currentTimeMillis() / 1000 + 3600,
                userId = "user-1",
                email = "a@b.c",
            ),
        )
        override val session = flow
        override suspend fun current(): Session? = flow.value
        override suspend fun save(session: Session) {
            flow.value = session
        }

        override suspend fun clear() {
            flow.value = null
        }
    }

    private lateinit var server: MockWebServer
    private lateinit var mutations: ContactMutations

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
        val baseUrl = server.url("/").toString().trimEnd('/')
        val api = ApiClient(
            http = OkHttpClient(),
            baseUrl = baseUrl,
            sessionStore = FakeSessions(),
            supabaseAuth = SupabaseAuth(
                client = OkHttpClient(),
                supabaseUrl = server.url("/gotrue").toString(),
                publishableKey = "pk",
            ),
        )
        mutations = ContactMutations(api, baseUrl)
    }

    @After
    fun tearDown() {
        server.close()
    }

    private val importBody =
        """{"imported":2,"updated":0,"skipped":0,"errors":[]}"""

    /**
     * The server's sentence about a refused attestation, held in a val and
     * asserted against ITSELF.
     *
     * A round trip, deliberately, not a copy of the shipped wording: this app's
     * job is not to know the sentence — the server owns it and sends it — it is
     * to not lose it on the way to the screen.
     */
    private val refusedNote =
        "Some of these customers have already asked this business to stop " +
            "texting them. They were imported and their opt-out still stands."

    /** 400 rows landed; two of them were people who had already said stop. */
    private val refusedBody =
        """
        {"imported":400,"updated":0,"skipped":0,"errors":[],
         "consent_refused":2,
         "consent_refusals":[
          {"row":3,"reason":"already opted out, consent not recorded: +14163014444"},
          {"row":91,"reason":"already opted out, consent not recorded: +14165550199"}],
         "consent_refused_note":"$refusedNote"}
        """.trimIndent()

    private val csvBytes = "phone\n+14165550100\n".toByteArray()

    /**
     * A card carrying nothing this importer does not read — so the vCard door's
     * property declaration is legitimately empty for it, which is the ordinary
     * case a phone-book export produces.
     */
    private val plainCard =
        "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann\r\nTEL:+14165550100\r\nEND:VCARD\r\n".toByteArray()

    /** The one thing every assertion here is about: the posted form part. */
    private val consentPart =
        "name=\"${ContactImport.CONSENT_FIELD}\""

    @Test
    fun `an attested CSV import posts the consent field the server demands`() = runTest {
        server.enqueue(MockResponse(body = importBody))
        mutations.importCsv("c1", "contacts.csv", csvBytes, true, columns = emptyList())

        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/contacts/import", recorded.url.encodedPath)
        val body = recorded.body?.utf8().orEmpty()
        assertTrue("no $consentPart part in the body", body.contains(consentPart))
        // The VALUE matters as much as the field: the server accepts only the
        // literal, so a part carrying "1" or "yes" would 422 identically to
        // sending nothing.
        assertTrue(
            "consent part does not carry ${ContactImport.CONSENT_VALUE}",
            body.contains("$consentPart\r\n\r\n${ContactImport.CONSENT_VALUE}"),
        )
    }

    @Test
    fun `an attested vCard import spends the same attestation`() = runTest {
        server.enqueue(MockResponse(body = importBody))
        mutations.importVcard("c1", "cards.vcf", plainCard, true, properties = emptyList())

        val recorded = server.takeRequest()
        assertEquals("/v1/contacts/import-vcard", recorded.url.encodedPath)
        val body = recorded.body?.utf8().orEmpty()
        // The vCard door had NO consent question at all until #248, which made
        // the only working bulk import the one that asked nothing.
        assertTrue(
            "vCard import posts no attestation",
            body.contains("$consentPart\r\n\r\n${ContactImport.CONSENT_VALUE}"),
        )
    }

    @Test
    fun `an unattested import posts no attestation and lets the server refuse`() = runTest {
        server.enqueue(MockResponse(body = importBody))
        mutations.importCsv("c1", "contacts.csv", csvBytes, false, columns = emptyList())

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertFalse(
            "an unattested import must never manufacture the claim",
            body.contains(ContactImport.CONSENT_FIELD),
        )
    }

    @Test
    fun `the file part still arrives beside the attestation`() = runTest {
        // The attestation is an ADDITION. A regression that posted the fields
        // and dropped the file would fail on the server with a message about a
        // missing file, which reads like the user picked a bad document.
        server.enqueue(MockResponse(body = importBody))
        mutations.importCsv("c1", "book.csv", csvBytes, true, columns = emptyList())

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertTrue(body.contains("name=\"file\""))
        assertTrue(body.contains("filename=\"book.csv\""))
        assertTrue(body.contains("+14165550100"))
    }

    @Test
    fun `a refused attestation survives the trip from the server to the app`() = runTest {
        // #248: the server now reports the rows its attestation could not cover.
        // Every one of the three fields is load-bearing — the count is what a
        // carrier audit asks about, the rows are the workspace's next question,
        // and the note is the only place the consequence is spelled out. A
        // client that decoded two of the three would report a mystery number.
        server.enqueue(MockResponse(body = refusedBody))
        val result = mutations.importCsv("c1", "contacts.csv", csvBytes, true, emptyList())

        assertEquals(2, result.consent_refused)
        assertEquals(listOf(3, 91), result.consent_refusals.map { it.row })
        assertTrue(
            "the refusal reason must name WHO, verbatim as the server sent it",
            result.consent_refusals.first().reason.contains("+14163014444"),
        )
        assertEquals(refusedNote, result.consent_refused_note)
    }

    @Test
    fun `the vCard door carries the refusals too`() = runTest {
        // The .vcf path is the one that needs this MOST: a phone book has no
        // property for "this person told us to stop", so every standing opt-out
        // in it is a disagreement the file could not have declared. A door that
        // parsed the refusals on one route and dropped them on the other would
        // hide them from the import most likely to produce them.
        server.enqueue(MockResponse(body = refusedBody))
        val result = mutations.importVcard("c1", "cards.vcf", plainCard, true, emptyList())

        assertEquals(2, result.consent_refused)
        assertEquals(refusedNote, result.consent_refused_note)
    }

    /** The part name a column declaration travels under, asserted against itself. */
    private val columnPart = "name=\"${ContactImport.COLUMN_FIELD}\""

    @Test
    fun `every column of the file reaches the wire under one repeated name`() = runTest {
        // #248 round 3. The server takes a COMPLETE declaration — one field per
        // column, by index — and this app posted its form fields as a MAP until
        // #248, a shape that cannot say a name twice. Under a gate that refuses
        // any file with an unanswered column, that shape could not have expressed
        // a single legal import.
        server.enqueue(MockResponse(body = importBody))
        val declarations = ImportColumns
            .plan("Phone,Marketing Status,Region\n+14165550100,Subscribed,EU\n".toByteArray())!!
            .columns
            .map {
                ImportColumns.format(
                    ImportColumns.Declaration(
                        it.index,
                        it.guess ?: ImportColumns.ACTION_IGNORE,
                        it.header,
                    ),
                )
            }
        mutations.importCsv("c1", "contacts.csv", csvBytes, attested = true, columns = declarations)

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertEquals(
            "every column must arrive, under one repeated field name",
            3,
            Regex(Regex.escape(columnPart)).findAll(body).count(),
        )
        assertTrue(body.contains("$columnPart\r\n\r\n0:phone:Phone"))
        assertTrue(body.contains("$columnPart\r\n\r\n1:ignore:Marketing Status"))
        assertTrue(body.contains("$columnPart\r\n\r\n2:ignore:Region"))
        // The header goes up EXACTLY as the file spelled it: the server compares
        // it against the file's own header row, so a client that tidied it would
        // be describing a column that is in nobody's file, and the whole upload
        // would be refused as "the declaration does not describe this file".
        assertFalse(
            "the header must not be normalised on the way out",
            body.contains("marketingstatus"),
        )
    }

    @Test
    fun `a header carrying the separator survives the wire`() = runTest {
        // The header goes LAST in the wire form for exactly this reason, and this
        // is the assertion that proves the bytes make it: a column called
        // "Do: Not Call, really" is one column, whatever it is spelled with.
        server.enqueue(MockResponse(body = importBody))
        mutations.importCsv(
            "c1",
            "contacts.csv",
            csvBytes,
            attested = true,
            columns = listOf(
                ImportColumns.format(ImportColumns.Declaration(0, "phone", "Phone")),
                ImportColumns.format(
                    ImportColumns.Declaration(1, "opted_out", "Do: Not Call, really"),
                ),
            ),
        )

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertTrue(body.contains("$columnPart\r\n\r\n1:opted_out:Do: Not Call, really"))
    }

    @Test
    fun `an undeclared import posts no column field, and is refused for it`() = runTest {
        // The empty declaration is legal on the wire and rejected by the server
        // for any file that has columns — which is how a file this app could not
        // parse, or one over the row cap, gets the sentence that actually
        // explains it instead of a sentence this app made up.
        server.enqueue(MockResponse(body = importBody))
        mutations.importCsv("c1", "contacts.csv", csvBytes, attested = true, columns = emptyList())

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertFalse(
            "nothing may declare a column on a caller's behalf",
            body.contains(ContactImport.COLUMN_FIELD),
        )
    }

    /** The part name a vCard property declaration travels under. */
    private val propertyPart = "name=\"${ContactImport.VCARD_PROPERTY_FIELD}\""

    @Test
    fun `the vCard door declares the properties its cards carry`() = runTest {
        // The door that had NO gate at all. `CATEGORIES:DNC`, a `NOTE` saying they
        // asked us to stop, and a label like `X-ABLabel=DO NOT CALL` are where a
        // .vcf says do-not-text, and all three used to be uploaded in silence
        // under a consent attestation.
        server.enqueue(MockResponse(body = importBody))
        val vcf = (
            "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ann\r\nTEL:+14165550100\r\n" +
                "CATEGORIES:DNC\r\nNOTE:asked us to stop\r\nEND:VCARD\r\n"
            ).toByteArray()
        val properties = VCardProperties.undeclared(vcf).map {
            VCardProperties.format(
                it,
                if (it == "CATEGORIES") {
                    VCardProperties.ACTION_OPTED_OUT
                } else {
                    VCardProperties.ACTION_IGNORE
                },
            )
        }
        mutations.importVcard("c1", "cards.vcf", vcf, attested = true, properties = properties)

        val body = server.takeRequest().body?.utf8().orEmpty()
        assertEquals(2, Regex(Regex.escape(propertyPart)).findAll(body).count())
        assertTrue(body.contains("$propertyPart\r\n\r\nCATEGORIES:opted_out"))
        assertTrue(body.contains("$propertyPart\r\n\r\nNOTE:ignore"))
        // Two different questions, two different field names. A `column` posted
        // here would be read by nothing at all.
        assertFalse(body.contains("name=\"${ContactImport.COLUMN_FIELD}\""))
    }

    @Test
    fun `an API that predates the refusal fields still decodes`() = runTest {
        // The three fields are ADDITIONS. Required ones would make this app
        // throw on every import against a Worker that has not deployed yet, and
        // a decode failure reads to the user as "the import broke" — the worst
        // possible lie about an import that in fact worked.
        server.enqueue(MockResponse(body = importBody))
        val result = mutations.importCsv("c1", "contacts.csv", csvBytes, true, emptyList())

        assertEquals(0, result.consent_refused)
        assertTrue(result.consent_refusals.isEmpty())
        assertNull(result.consent_refused_note)
    }
}
