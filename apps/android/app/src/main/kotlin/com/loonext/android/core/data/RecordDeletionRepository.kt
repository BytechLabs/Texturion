package com.loonext.android.core.data

import com.loonext.android.core.model.DeletedRecord
import com.loonext.android.core.model.TrashKind
import com.loonext.android.core.net.ApiClient
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * #691: delete to the Trash, and restore from it (which is what Undo calls).
 *
 * Every delete needs `records.delete` (403 otherwise) and answers 404 for a
 * record that is gone or a number the member cannot see. Trash management is
 * web-only; this client only deletes and undoes.
 */
class RecordDeletionRepository(private val api: ApiClient) {
    suspend fun deleteMessage(companyId: String, messageId: String): DeletedRecord =
        api.deleteReturning("/v1/messages/$messageId", companyId = companyId)

    suspend fun deleteConversation(companyId: String, conversationId: String): DeletedRecord =
        api.deleteReturning("/v1/conversations/$conversationId", companyId = companyId)

    /** [callId] is the call LIST row's `id`, not its `call_session_id`. */
    suspend fun deleteCall(companyId: String, callId: String): DeletedRecord =
        api.deleteReturning("/v1/calls/$callId", companyId = companyId)

    /** The recording and transcript only; the call row stays in the log. */
    suspend fun deleteVoicemail(companyId: String, callId: String): DeletedRecord =
        api.deleteReturning("/v1/calls/$callId/voicemail", companyId = companyId)

    /** 409 when the record's conversation is itself still in the Trash. */
    suspend fun restore(companyId: String, kind: String, id: String) {
        api.post<JsonObject, JsonObject>(
            "/v1/trash/restore",
            buildJsonObject {
                put("kind", kind)
                put("id", id)
            },
            companyId = companyId,
        )
    }

    suspend fun restoreMessage(companyId: String, id: String) =
        restore(companyId, TrashKind.MESSAGE, id)

    suspend fun restoreConversation(companyId: String, id: String) =
        restore(companyId, TrashKind.CONVERSATION, id)

    suspend fun restoreCall(companyId: String, id: String) =
        restore(companyId, TrashKind.CALL, id)

    suspend fun restoreVoicemail(companyId: String, id: String) =
        restore(companyId, TrashKind.VOICEMAIL, id)
}
