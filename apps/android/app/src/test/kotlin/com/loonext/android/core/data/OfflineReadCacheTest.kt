package com.loonext.android.core.data

import javax.crypto.KeyGenerator
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class OfflineReadCacheTest {
    @get:Rule val temp = TemporaryFolder()

    private val viewer = "viewer-a"
    private val thread = "/v1/conversations/aaaa0000-0000-4000-8000-000000000001"

    @Test
    fun `only the default lists and first pages of record reads are retained`() {
        assertTrue(isOfflineRead("/v1/for-you", emptyMap(), viewer))
        assertTrue(isOfflineRead("/v1/conversations", mapOf("pinned" to "only", "status" to "open"), viewer))
        assertTrue(isOfflineRead("/v1/tasks", mapOf("assigned_user_id" to viewer, "status" to "open"), viewer))
        assertTrue(isOfflineRead(thread, emptyMap(), viewer))
        assertTrue(isOfflineRead("$thread/messages", mapOf("limit" to "50", "cursor" to null), viewer))

        assertFalse(isOfflineRead("/v1/conversations", mapOf("is_spam" to "true"), viewer))
        assertFalse(isOfflineRead("/v1/tasks", mapOf("assigned_user_id" to "viewer-b"), viewer))
        assertFalse(isOfflineRead("$thread/messages", mapOf("cursor" to "second-page"), viewer))
        assertFalse(isOfflineRead("$thread/messages", mapOf("anchor" to "message-id"), viewer))
        assertFalse(isOfflineRead("/v1/attachments/private/url", emptyMap(), viewer))
    }

    @Test
    fun `the encrypted response survives a new process and only its key opens it`() = runTest {
        val folder = temp.newFolder()
        val generator = KeyGenerator.getInstance("AES").apply { init(256) }
        val key = generator.generateKey()
        val writer = OfflineReadCache(folder, key)
        val response = """{"conversation":"Private address"}"""
        writer.write("member/workspace/thread", response) { true }
        writer.write("ended-session/thread", response) { false }

        val reader = OfflineReadCache(folder, key)
        assertEquals(response, reader.read("member/workspace/thread"))
        assertNull(reader.read("other/workspace/thread"))
        assertNull(reader.read("ended-session/thread"))
        assertNull(OfflineReadCache(folder, generator.generateKey()).read("member/workspace/thread"))
        reader.clear()
        assertNull(OfflineReadCache(folder, key).read("member/workspace/thread"))
    }
}
