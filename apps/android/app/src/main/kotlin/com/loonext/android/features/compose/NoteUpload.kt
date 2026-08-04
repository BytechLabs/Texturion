package com.loonext.android.features.compose

import com.loonext.android.core.auth.await
import com.loonext.android.core.model.Attachment
import com.loonext.android.core.net.ApiClient
import com.loonext.android.core.net.ApiErrorCode
import com.loonext.android.core.net.ApiException
import com.loonext.android.features.attachments.AttachmentPreview
import java.io.IOException
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Multipart POST /v1/attachments for note files (D19/D28). ApiClient only
 * speaks JSON bodies, so this helper borrows its OkHttp client + fresh-session
 * refresh + SPEC §7 envelope decoding for the one multipart door the composer
 * needs (owner_type='note' is the ONLY generic upload owner).
 */
class NoteFileUploader(private val api: ApiClient, private val baseUrl: String) {

    suspend fun upload(
        companyId: String,
        noteId: String,
        fileName: String,
        contentType: String,
        bytes: ByteArray,
    ): Attachment {
        val session = api.freshSession() ?: throw ApiException(
            ApiErrorCode.UNAUTHORIZED,
            "You're signed out.",
            401,
        )
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("owner_type", "note")
            .addFormDataPart("owner_id", noteId)
            .addFormDataPart(
                "file",
                fileName,
                bytes.toRequestBody(contentType.toMediaTypeOrNull()),
            )
            .apply {
                // #240: the thread renders a picture of the file, not the file.
                // This phone has just decoded the image to show it in the
                // staging strip, so the resize is nearly free here and saves
                // the whole crew re-fetching a 25 MB original on every scroll.
                AttachmentPreview.make(contentType, bytes)?.let {
                    addFormDataPart(
                        "preview",
                        AttachmentPreview.FILE_NAME,
                        it.toRequestBody("image/jpeg".toMediaTypeOrNull()),
                    )
                }
            }
            .build()
        val request = Request.Builder()
            .url("$baseUrl/v1/attachments")
            .header("Authorization", "Bearer ${session.accessToken}")
            .header("X-Company-Id", companyId)
            .post(body)
            .build()
        val response = try {
            api.http.newCall(request).await()
        } catch (_: IOException) {
            throw ApiException(
                ApiErrorCode.NETWORK,
                "Can't reach Loonext. Check your connection.",
                0,
            )
        }
        val (status, text) = response.use { it.code to it.body?.string().orEmpty() }
        val payload = ApiClient.RawResponse(status, text).expectSuccess(api.json)
        return api.json.decodeFromString(payload)
    }
}
