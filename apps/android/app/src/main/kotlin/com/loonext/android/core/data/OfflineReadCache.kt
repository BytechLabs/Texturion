package com.loonext.android.core.data

import com.loonext.android.core.auth.WorkspaceCacheCipher
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import javax.crypto.SecretKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

private const val CAPACITY_BYTES = 5 * 1024 * 1024L
private const val RECORD_ID = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
private val DETAIL_PATH = Regex("(?i)/v1/(conversations/$RECORD_ID(?:/messages|/events)?|tasks/$RECORD_ID)")

@Serializable
private data class OfflineReadEntry(val key: String, val body: String)

class OfflineReadCache(private val directory: File, private val diskKey: SecretKey? = null) {
    private val lock = Mutex()

    suspend fun read(key: String): String? = withContext(Dispatchers.IO) {
        lock.withLock {
            runCatching {
                val file = fileFor(key)
                if (!file.isFile || file.length() !in 1..CAPACITY_BYTES) return@runCatching null
                val unsealed = WorkspaceCacheCipher.decrypt(file.readText(), diskKey) ?: return@runCatching null
                val entry = Json.decodeFromString<OfflineReadEntry>(unsealed)
                if (entry.key != key) return@runCatching null
                file.setLastModified(System.currentTimeMillis())
                entry.body
            }.getOrNull()
        }
    }

    suspend fun write(key: String, body: String, whileSignedIn: suspend () -> Boolean) = withContext(Dispatchers.IO) {
        lock.withLock {
            if (!whileSignedIn()) return@withLock
            runCatching {
                val encrypted = WorkspaceCacheCipher.encrypt(Json.encodeToString(OfflineReadEntry(key, body)), diskKey)
                if (encrypted.length > CAPACITY_BYTES) return@runCatching
                directory.mkdirs()
                directory.listFiles { file -> file.extension == "tmp" }.orEmpty().forEach { it.delete() }
                val temporary = File.createTempFile("offline-", ".tmp", directory)
                try {
                    temporary.writeText(encrypted)
                    Files.move(
                        temporary.toPath(), fileFor(key).toPath(),
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING,
                    )
                } finally {
                    temporary.delete()
                }
                prune()
            }
        }
        Unit
    }

    suspend fun remove(key: String) {
        withContext(Dispatchers.IO) {
            lock.withLock { runCatching { fileFor(key).delete() } }
        }
    }

    suspend fun clear() {
        withContext(NonCancellable + Dispatchers.IO) {
            lock.withLock { runCatching { directory.listFiles().orEmpty().forEach { it.delete() } } }
        }
    }

    private fun fileFor(key: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(key.encodeToByteArray())
        return File(directory, hash.joinToString("") { "%02x".format(it) } + ".read")
    }

    private fun prune() {
        val files = directory.listFiles { file -> file.isFile && file.extension == "read" }.orEmpty()
        var size = files.sumOf(File::length)
        for (file in files.sortedBy(File::lastModified)) {
            if (size <= CAPACITY_BYTES) break
            val length = file.length()
            if (file.delete()) size -= length
        }
    }
}

internal fun isOfflineRead(path: String, query: Map<String, String?>, userId: String): Boolean {
    val supplied = query.filterValues { it != null }
    return when (path) {
        "/v1/for-you" -> supplied.isEmpty()
        "/v1/conversations" -> supplied.keys.all { it in setOf("limit", "status", "pinned") } &&
            supplied["status"] in setOf(null, "open") &&
            supplied["pinned"] in setOf(null, "only", "exclude")
        "/v1/tasks" -> supplied.keys.all { it in setOf("limit", "status", "assigned_user_id") } &&
            supplied["assigned_user_id"] in setOf(null, "all", "me", userId)
        else -> DETAIL_PATH.matches(path) && supplied.keys.all { it == "limit" }
    }
}
