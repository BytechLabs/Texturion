package com.loonext.android.core.data

import com.loonext.android.core.model.Page
import com.loonext.android.core.model.TrashItem
import com.loonext.android.core.net.ApiClient

/**
 * #735: the Trash screen's reads and writes. All three routes need
 * `records.delete` (403 otherwise). Restore is the same call Undo makes, so it
 * is [RecordDeletionRepository.restore]; it answers 409 with a sentence when the
 * item's conversation is itself still in the Trash. Delete forever answers 204,
 * or 409 under a legal hold, and cannot be taken back.
 */
class TrashRepository(private val api: ApiClient) {
    private val deletion = RecordDeletionRepository(api)

    /** Newest deletion first, cursor-paged. */
    suspend fun list(companyId: String, cursor: String? = null, limit: Int = 50): Page<TrashItem> =
        api.get(
            "/v1/trash",
            query = mapOf("cursor" to cursor, "limit" to limit.toString()),
            companyId = companyId,
        )

    suspend fun restore(companyId: String, item: TrashItem) =
        deletion.restore(companyId, item.kind, item.id)

    suspend fun purge(companyId: String, item: TrashItem) {
        api.delete("/v1/trash/${item.kind}/${item.id}", companyId = companyId)
    }
}
