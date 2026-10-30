package com.loonext.android.telephony

import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
 * Ring beacons on the wire. apps/api ring-beacons.test.ts checks the stage,
 * permission and bucket words RingBeacons.kt spells; this covers what a beacon
 * carries, that it carries nothing else, and that it can fail in every way
 * without the caller noticing.
 */
class RingBeaconsTest {

    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer().also { it.start() }
    }

    @After
    fun tearDown() {
        server.close()
    }

    private fun sender(
        token: String? = "token-1",
        baseUrl: String = server.url("/").toString(),
    ) = RingBeaconSender(
        http = OkHttpClient(),
        baseUrl = baseUrl,
        accessToken = { token },
        appVersion = "0.18.2",
    )

    private fun parse(body: String): JsonObject = Json.parseToJsonElement(body).jsonObject

    @Test
    fun `the body is the session, the stage and device state, and nothing else`() {
        val body = parse(
            ringBeaconBody(
                sessionId = "v3:sess-1",
                stage = RingBeaconStage.RINGING_SHOWN,
                occurredAt = "2026-10-30T12:00:00.123Z",
                device = RingBeaconDevice(
                    os = "android-34",
                    permissions = mapOf(
                        RingBeaconPermission.NOTIFICATIONS to true,
                        RingBeaconPermission.FULL_SCREEN_INTENT to false,
                    ),
                    standbyBucket = "rare",
                    powerSave = true,
                    deviceIdle = false,
                    screenLocked = true,
                ),
            ),
        )

        assertEquals(
            setOf(
                "call_session_id", "stage", "occurred_at", "os", "permissions",
                "standby_bucket", "power_save", "device_idle", "screen_locked",
            ),
            body.keys,
        )
        assertEquals("v3:sess-1", body["call_session_id"]!!.jsonPrimitive.content)
        assertEquals("ringing_shown", body["stage"]!!.jsonPrimitive.content)
        assertEquals("2026-10-30T12:00:00.123Z", body["occurred_at"]!!.jsonPrimitive.content)
        assertEquals("android-34", body["os"]!!.jsonPrimitive.content)
        val permissions = body["permissions"]!!.jsonObject
        assertEquals("granted", permissions["notifications"]!!.jsonPrimitive.content)
        assertEquals("denied", permissions["full_screen_intent"]!!.jsonPrimitive.content)
        assertEquals("rare", body["standby_bucket"]!!.jsonPrimitive.content)
        assertTrue(body["power_save"]!!.jsonPrimitive.boolean)
        assertFalse(body["device_idle"]!!.jsonPrimitive.boolean)
        assertTrue(body["screen_locked"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun `device facts the phone could not read are left out, not sent as guesses`() {
        val body = parse(
            ringBeaconBody(
                sessionId = "v3:sess-1",
                stage = RingBeaconStage.PUSH_RECEIVED,
                occurredAt = "2026-10-30T12:00:00Z",
                device = RingBeaconDevice(os = "android-28"),
            ),
        )
        assertEquals(setOf("call_session_id", "stage", "occurred_at", "os"), body.keys)
    }

    @Test
    fun `standby buckets are named by the framework's integers`() {
        assertEquals("exempted", standbyBucketName(5))
        assertEquals("active", standbyBucketName(10))
        assertEquals("working_set", standbyBucketName(20))
        assertEquals("frequent", standbyBucketName(30))
        assertEquals("rare", standbyBucketName(40))
        assertEquals("restricted", standbyBucketName(45))
        assertEquals("unknown", standbyBucketName(50))
    }

    @Test
    fun `each stage is sent once per session, and the memory stays bounded`() {
        val ledger = RingBeaconLedger(capacity = 2)
        assertTrue(ledger.firstTime("s1", RingBeaconStage.ANSWERED))
        assertFalse(ledger.firstTime("s1", RingBeaconStage.ANSWERED))
        assertTrue(ledger.firstTime("s1", RingBeaconStage.DECLINED))
        assertTrue(ledger.firstTime("s2", RingBeaconStage.ANSWERED))
        // s1/answered was the oldest of three and has been forgotten.
        assertTrue(ledger.firstTime("s1", RingBeaconStage.ANSWERED))
    }

    @Test
    fun `a beacon names the app, the build and the workspace like every other request`() = runTest {
        server.enqueue(MockResponse(code = 202, body = """{"recorded":true}"""))

        val sent = sender().send("company-1", """{"stage":"answered"}""")

        assertTrue(sent)
        val recorded = server.takeRequest()
        assertEquals("POST", recorded.method)
        assertEquals("/v1/ring-beacons", recorded.url.encodedPath)
        assertEquals("Bearer token-1", recorded.headers["Authorization"])
        assertEquals("android", recorded.headers["X-Client"])
        assertEquals("0.18.2", recorded.headers["X-App-Version"])
        assertEquals("company-1", recorded.headers["X-Company-Id"])
        assertEquals("""{"stage":"answered"}""", recorded.body?.utf8())
    }

    @Test
    fun `a refused beacon reports false and throws nothing`() = runTest {
        server.enqueue(MockResponse(code = 404, body = "{}"))
        assertFalse(sender().send("company-1", "{}"))
    }

    @Test
    fun `an unreachable server reports false and throws nothing`() = runTest {
        val gone = MockWebServer().also { it.start() }
        val baseUrl = gone.url("/").toString()
        gone.close()
        assertFalse(sender(baseUrl = baseUrl).send("company-1", "{}"))
    }

    @Test
    fun `a signed-out phone sends nothing`() = runTest {
        assertFalse(sender(token = null).send("company-1", "{}"))
        assertEquals(0, server.requestCount)
    }

    @Test
    fun `an absent permission map is not an empty object`() {
        val body = parse(
            ringBeaconBody(
                sessionId = "v3:sess-1",
                stage = RingBeaconStage.ANSWERED,
                occurredAt = "2026-10-30T12:00:00Z",
                device = RingBeaconDevice(os = "android-34", permissions = emptyMap()),
            ),
        )
        assertNull(body["permissions"])
    }
}
