package com.loonext.android.core.model

import kotlinx.serialization.Serializable

@Serializable
data class ScheduleDecision(
    val id: String,
    val state: String,
    val provider_condition: String,
    val allowed_actions: List<String> = emptyList(),
    val task: ScheduleDecisionTask,
    val connection: ScheduleDecisionConnection,
    val ours: ScheduleDecisionSnapshot? = null,
    val theirs: ScheduleDecisionSnapshot? = null,
    val refusal: ScheduleDecisionRefusal? = null,
)

@Serializable
data class ScheduleDecisionTask(val id: String, val title: String, val due_at: String? = null)

@Serializable
data class ScheduleDecisionConnection(val time_zone: String, val provider: String)

@Serializable
data class ScheduleDecisionSnapshot(val start: String, val end: String, val time_zone: String, val title: String)

@Serializable
data class ScheduleDecisionRefusal(val code: String)

@Serializable
data class ScheduleDecisionsResponse(val attention: List<ScheduleDecision> = emptyList())

@Serializable
data class ScheduleDecisionRequest(val action: String, val new_due_at: String? = null)

@Serializable
data class ScheduleDecisionResult(val outcome: String)
