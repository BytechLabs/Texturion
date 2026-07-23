package com.loonext.android.telephony

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * #211: the outbound authorize response ([BrowserCallAuth]) gained a nullable
 * `call_session_id`. These decode tests pin the old-server tolerance the field
 * promises (its ABSENCE is never an error, its presence is carried through)
 * under the SAME Json config the production ApiClient uses (ignoreUnknownKeys +
 * explicitNulls=false + encodeDefaults=true).
 */
class BrowserCallAuthTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

    @Test
    fun `a v3 server's call_session_id is carried through`() {
        val body = """
            {"from":"+15550001111","to":"+15552223333",
             "client_state":"b64state","call_session_id":"S-outbound"}
        """.trimIndent()

        val auth = json.decodeFromString<BrowserCallAuth>(body)

        assertEquals("S-outbound", auth.call_session_id)
        assertEquals("b64state", auth.client_state)
    }

    @Test
    fun `a pre-211 server omitting the field decodes with a null session, never an error`() {
        // The exact shape today's server returns, with no call_session_id key.
        val body = """{"from":"+15550001111","to":"+15552223333","client_state":"b64state"}"""

        val auth = json.decodeFromString<BrowserCallAuth>(body)

        assertNull("its absence is never an authorize error", auth.call_session_id)
        assertEquals("+15552223333", auth.to)
    }

    @Test
    fun `an explicit null call_session_id decodes to null`() {
        val body = """
            {"from":"+15550001111","to":"+15552223333",
             "client_state":"b64state","call_session_id":null}
        """.trimIndent()

        assertNull(json.decodeFromString<BrowserCallAuth>(body).call_session_id)
    }
}
