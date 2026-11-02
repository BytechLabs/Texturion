package com.loonext.android.core.model

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/**
 * The response-time and satisfaction cards sat on "Working out your response
 * time..." for good because their report classes lost `@Serializable` and the
 * decode threw "Serializer for class ... is not found". Nothing decoded them in a
 * test, and the repository reads them through a reified call, so only a device
 * showed it.
 */
class ReportModelsDecodeTest {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Test
    fun `a response-time report decodes`() {
        val report = json.decodeFromString<ResponseTimeReport>(
            """
            {"window":{"days":30},"leads":12,"answered":9,"unanswered":3,
             "median_seconds":84.5,"p90_seconds":600,
             "business_hours":{"leads":8,"answered":7,"median_seconds":60},
             "after_hours":{"leads":4,"answered":2,"median_seconds":null},
             "by_member":null,"by_number":[],"per_member_enabled":false,
             "baseline":{"leads":5,"answered":2,"median_seconds":900},
             "baseline_unavailable":null,"improved_by_seconds":815.5,
             "split_truncated":false,"split_row_limit":5000,"a_new_server_field":1}
            """,
        )
        assertEquals(12, report.leads)
        assertEquals(30, report.window.days)
        assertEquals(7, report.business_hours.answered)
        assertEquals(2, report.baseline?.answered)
        assertNull(report.by_member)
    }

    @Test
    fun `a satisfaction report decodes`() {
        val report = json.decodeFromString<SatisfactionReport>(
            """
            {"window":{"days":30},"asked":10,"answered":6,"average":4.5,
             "sample_too_small":false,"minimum_sample":5,
             "distribution":{"5":4,"4":1,"1":1},"poor":1,
             "by_member":[{"user_id":"u1","name":"Sam","answered":6,"average":4.5}],
             "per_member_enabled":true,
             "baseline":{"since":"2026-06-01","until":"2026-07-01","answered":4,"average":3.5},
             "improved_by":1.0,"truncated":false,"row_limit":5000}
            """,
        )
        assertEquals(6, report.answered)
        assertEquals(4, report.distribution["5"])
        assertEquals("Sam", report.by_member?.single()?.name)
        assertEquals(3.5, report.baseline?.average ?: 0.0, 0.0)
    }

    /**
     * Every class the app reads off the network is `@Serializable`; these are
     * the model types that are not, because nothing decodes them. A class added
     * to core/model without the annotation fails here instead of on a device.
     */
    @Test
    fun `a model class is either serializable or named as local-only`() {
        val localOnly = setOf(
            "VoicemailIntakeLine", "RegistrationProgress", "RegistrationStage",
            "RejectionGuidance", "RejectionDomain", "CarrierFailureReason",
            "TaskAddressInput", "CarrierStanding",
        )
        val declaration = Regex("""^(?:data class|enum class|sealed class|sealed interface|class)\s+(\w+)""")
        val offenders = mutableListOf<String>()
        for (file in modelFiles()) {
            val lines = file.readLines()
            lines.forEachIndexed { index, line ->
                val name = declaration.find(line)?.groupValues?.get(1) ?: return@forEachIndexed
                if (name in localOnly || hasSerializable(lines, index)) return@forEachIndexed
                offenders += "${file.name}:${index + 1} $name"
            }
        }
        if (offenders.isNotEmpty()) {
            fail(
                "These core/model classes are not @Serializable, so decoding one fails at runtime " +
                    "with 'Serializer for class ... is not found'. Annotate them, or list them as " +
                    "local-only in this test if nothing decodes them: $offenders",
            )
        }
    }

    /** Walks up over annotations and comments to the first blank or code line. */
    private fun hasSerializable(lines: List<String>, declaration: Int): Boolean {
        var i = declaration - 1
        var inComment = false
        while (i >= 0) {
            val line = lines[i].trim()
            when {
                line.endsWith("*/") && !inComment -> inComment = !line.startsWith("/*")
                inComment -> if (line.startsWith("/*")) inComment = false
                line.startsWith("@") -> if (line.startsWith("@Serializable")) return true
                line.startsWith("//") -> Unit
                else -> return false
            }
            i--
        }
        return false
    }

    private fun modelFiles(): List<File> {
        val bases = listOf(
            "src/main/kotlin/com/loonext/android/core/model",
            "app/src/main/kotlin/com/loonext/android/core/model",
            "apps/android/app/src/main/kotlin/com/loonext/android/core/model",
        )
        for (base in bases) {
            val dir = File(base)
            if (dir.isDirectory) return dir.listFiles { f -> f.extension == "kt" }!!.sortedBy { it.name }
        }
        fail("core/model not found (cwd=${File(".").absolutePath})")
        error("unreachable")
    }
}
