package com.loonext.android.features.thread

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.loonext.android.core.model.ConversationDetail

/**
 * #726: the lead source of ONE conversation.
 *
 * Built from the conversation's own server value and held per conversation, so
 * opening another thread starts from that thread's answer and never from the
 * last thread's choice. A thread nobody asked about starts with nothing chosen.
 */
internal class LeadSourceChoice(sourceId: String?, origin: String?) {
    var sourceId by mutableStateOf(sourceId)
    var origin by mutableStateOf(origin)

    companion object {
        fun of(detail: ConversationDetail) =
            LeadSourceChoice(detail.lead_source_id, detail.lead_source_origin)
    }
}

/** What the source line says: an answer, or that nobody has asked. */
internal sealed interface LeadSourceView {
    data object Unasked : LeadSourceView

    /** [fromNumber]: the line they called named it, so nobody had to ask. */
    data class Chosen(val name: String, val fromNumber: Boolean) : LeadSourceView
}

internal fun leadSourceView(chosenName: String?, origin: String?): LeadSourceView =
    if (chosenName == null) LeadSourceView.Unasked
    else LeadSourceView.Chosen(chosenName, fromNumber = origin == "number")

/** #726: only someone who can manage settings is offered "Add a source". */
internal fun canAddLeadSource(role: String?): Boolean =
    com.loonext.android.core.model.MemberRole.has(role, com.loonext.android.core.model.Capability.SETTINGS_MANAGE)
