package com.loonext.android.features.contacts

import com.loonext.android.core.auth.await
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/**
 * Multipart/form-data POST for the /v1 upload endpoints (contact CSV/vCard
 * import, note file attachments). ApiClient only speaks JSON bodies, so this
 * helper reuses its OkHttp client + session refresh + SPEC §7 envelope
 * decoding for file uploads. Lives here because both upload doors (contacts
 * import, task-note files) belong to this feature pair.
 */
class MultipartClient(private val api: ApiClient, private val baseUrl: String) {

    /**
     * POST [path] with string [fields] plus one file part. Returns the raw
     * response body on 2xx; throws [ApiException] with the decoded envelope
     * code otherwise (unauthorized when the session can't be refreshed).
     */
    suspend fun postFile(
        path: String,
        companyId: String,
        fields: Map<String, String>,
        fileField: String,
        fileName: String,
        contentType: String,
        bytes: ByteArray,
    ): String {
        val session = api.freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
            fields.forEach { (name, value) -> addFormDataPart(name, value) }
            addFormDataPart(
                fileField,
                fileName,
                bytes.toRequestBody(contentType.toMediaTypeOrNull()),
            )
        }.build()
        val request = Request.Builder()
            .url(baseUrl + path)
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("X-Company-Id", companyId)
            .post(body)
            .build()
        val response = try {
            api.http.newCall(request).await()
        } catch (cause: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach Loonext. Check your connection.",
                0,
            )
        }
        val (status, text) = response.use { it.code to it.body?.string().orEmpty() }
        return ApiClient.RawResponse(status, text).expectSuccess(api.json)
    }
}

/**
 * Upload one staged file onto a posted note (D19): task/note files enter ONLY
 * through `owner_type='note'` — a direct task upload is a 422 by design.
 */
suspend fun MultipartClient.uploadNoteFile(
    companyId: String,
    noteId: String,
    fileName: String,
    contentType: String,
    bytes: ByteArray,
): String = postFile(
    path = "/v1/attachments",
    companyId = companyId,
    fields = mapOf("owner_type" to "note", "owner_id" to noteId),
    fileField = "file",
    fileName = fileName,
    contentType = contentType,
    bytes = bytes,
)
