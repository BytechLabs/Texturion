package com.loonext.android.core.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull

/** One attributed setting that is off its default (#749). */
@Serializable
data class SettingChoice(
    val key: String,
    val value: JsonElement = JsonNull,
    val default_value: JsonElement = JsonNull,
    /** Null when the change predates the audit trail or the member is gone. */
    val chosen_by: String? = null,
    val chosen_at: String? = null,
)

/** GET /v1/company/setting-choices (settings.manage). */
@Serializable
data class SettingChoices(val data: List<SettingChoice> = emptyList())
