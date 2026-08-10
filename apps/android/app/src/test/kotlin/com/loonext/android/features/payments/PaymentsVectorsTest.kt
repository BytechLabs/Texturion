package com.loonext.android.features.payments

import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * #224/#376 — the payment rules, asserted against the cases the TypeScript owns.
 *
 * `scripts/generate-parity-vectors.mjs` has emitted `payments.json` since the
 * feature shipped on web, and until this file nothing on Android read it: the
 * generator's own header says a divergence here "costs money", and the guard
 * that would have caught one had no consumer. A generated file nobody asserts
 * against is a guard that has never fired.
 *
 * Two cases in here are the whole reason the vectors exist, and both are ones a
 * reimplementation gets wrong by writing the obvious switch:
 *
 *   a request CANCELLED and then paid anyway must read PAID — the money is
 *   real, and reading it as cancelled is how a customer is chased for a bill
 *   they already settled;
 *   a request REFUNDED after being DISPUTED must read DISPUTED — a chargeback
 *   needs somebody, and a refund does not.
 *
 * Read from the repo rather than copied into test resources, for the reason
 * [com.loonext.android.core.model.ParityVectorsTest] gives: a copy is a fourth
 * place the cases live, which is the problem the vectors exist to solve.
 */
class PaymentsVectorsTest {

    private val json = Json { ignoreUnknownKeys = true }

    /**
     * Walk UP to the repo root rather than counting `../` from the working
     * directory. Gradle runs unit tests from `apps/android/app`, but that is a
     * detail of the runner rather than a promise.
     */
    private fun vectors(name: String): JsonArray {
        var dir: File? = File("").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "packages/shared/vectors/$name")
            if (candidate.exists()) {
                return json.parseToJsonElement(candidate.readText()) as JsonArray
            }
            dir = dir.parentFile
        }
        throw AssertionError(
            "parity vectors not found walking up from ${File("").absolutePath}. " +
                "Run: node scripts/generate-parity-vectors.mjs",
        )
    }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content

    private fun JsonObject.bool(key: String): Boolean =
        (this[key] as? JsonPrimitive)?.booleanOrNull == true

    private val cases by lazy { vectors("payments.json").map { it as JsonObject } }

    @Test
    fun `the six-state answer agrees with the TypeScript`() {
        val states = cases.filter { it.str("kind") == "state" }
        assertTrue("no state vectors", states.isNotEmpty())
        for (case in states) {
            val row = case["row"] as JsonObject
            val actual = Payments.state(
                status = row.str("status").orEmpty(),
                paidAt = row.str("paid_at"),
                refundedAt = row.str("refunded_at"),
                disputedAt = row.str("disputed_at"),
            )
            // The label names the INPUT rather than an index, so a failure says
            // which row diverged instead of which line of a JSON file.
            val label = "state for $row"
            assertEquals(label, case.str("state"), actual.wire)
            assertEquals("label for $row", case.str("label"), Payments.label(actual))
            assertEquals(
                "cancellable for $row",
                case.bool("cancellable"),
                Payments.cancellable(actual),
            )
        }
    }

    @Test
    fun `the amount bounds agree with the TypeScript`() {
        val amounts = cases.filter { it.str("kind") == "amount" }
        assertTrue("no amount vectors", amounts.isNotEmpty())
        var wholeCases = 0
        for (case in amounts) {
            val cents = case["cents"] as JsonPrimitive
            val asInt = cents.intOrNull
            if (asInt == null) {
                // A FRACTION OF A CENT, which TypeScript's `number` can hold and
                // an Int cannot. The port refuses it a step earlier — see
                // [PaymentsTest] — so what is asserted here is that the vector
                // agrees the value is unchargeable, not that Kotlin reproduces a
                // type it does not have.
                assertEquals(
                    "a fractional cent must be refused: $cents",
                    "not_whole",
                    case.str("problem"),
                )
                assertNotNull("$cents is not an integer", cents.doubleOrNull)
                continue
            }
            wholeCases += 1
            val problem = Payments.amountProblem(asInt)
            val expected = case.str("problem")
            val actual = when (problem) {
                null -> null
                PaymentAmountProblem.TOO_SMALL -> "too_small"
                PaymentAmountProblem.TOO_LARGE -> "too_large"
                PaymentAmountProblem.NOT_WHOLE -> "not_whole"
            }
            assertEquals("amountProblem($asInt)", expected, actual)
        }
        // The floor and the ceiling are the only two integers in this rule, and
        // a vector set that had lost its boundary cases would pass silently.
        assertTrue("no whole-cent amount vectors", wholeCases >= 6)
    }

    @Test
    fun `the readiness answer agrees with the TypeScript`() {
        val readiness = cases.filter { it.str("kind") == "readiness" }
        assertTrue("no readiness vectors", readiness.isNotEmpty())
        for (case in readiness) {
            val account = case["account"] as? JsonObject
            val actual = Payments.readinessOf(
                // A null account is a workspace that has never connected one.
                connected = account?.bool("connected") == true,
                chargesEnabled = account?.bool("charges_enabled") == true,
                detailsSubmitted = account?.bool("details_submitted") == true,
                disabledReason = account?.str("disabled_reason"),
            )
            assertEquals("readiness for $account", case.str("readiness"), actual.wire)
        }
    }

    @Test
    fun `charges_enabled outranks a disabled reason`() {
        // Called out on its own because it is the one that decides whether the
        // composer draws the ask at all. Stripe can carry a pending requirement
        // AND still take cards; a port that checked `disabled_reason` first would
        // hide the control from a workspace that can charge today.
        assertEquals(
            PayoutReadiness.READY,
            Payments.readinessOf(
                connected = true,
                chargesEnabled = true,
                detailsSubmitted = true,
                disabledReason = "requirements.pending_verification",
            ),
        )
    }
}
